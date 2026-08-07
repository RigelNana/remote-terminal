use std::{sync::Arc, time::Duration};

use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use dashmap::DashMap;
use remote_proto::id::UserId;
use serde::Serialize;
use tokio::task;
use uuid::Uuid;
use webauthn_rs::{
    Webauthn, WebauthnBuilder,
    prelude::{
        CreationChallengeResponse, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential,
        RegisterPublicKeyCredential, RequestChallengeResponse,
    },
};

use crate::{
    config::Config,
    error::{Error, Result},
    model::{Credential, User},
    secret,
    store::Store,
};

const CEREMONY_TTL: Duration = Duration::from_secs(300);

pub struct Registration {
    pub ceremony: Uuid,
    pub options: CreationChallengeResponse,
}

pub struct Authentication {
    pub ceremony: Uuid,
    pub options: RequestChallengeResponse,
}

#[derive(Serialize)]
pub struct Registered {
    pub user: UserView,
    pub recovery_codes: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct UserView {
    pub id: UserId,
    pub username: String,
    pub display_name: String,
}

impl From<User> for UserView {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
        }
    }
}

struct RegisterState {
    created: tokio::time::Instant,
    user: UserId,
    username: String,
    display_name: String,
    credential_name: String,
    state: PasskeyRegistration,
}

struct LoginState {
    created: tokio::time::Instant,
    user: User,
    credentials: Vec<Credential>,
    state: PasskeyAuthentication,
}

#[derive(Clone)]
pub struct Auth {
    webauthn: Arc<Webauthn>,
    registration: Arc<DashMap<Uuid, RegisterState>>,
    authentication: Arc<DashMap<Uuid, LoginState>>,
}

impl Auth {
    pub fn new(config: &Config) -> Result<Self> {
        let webauthn = WebauthnBuilder::new(&config.rp_id, &config.origin)
            .map_err(|error| Error::Config(error.to_string()))?
            .rp_name(&config.rp_name)
            .build()
            .map_err(|error| Error::Config(error.to_string()))?;
        Ok(Self {
            webauthn: Arc::new(webauthn),
            registration: Arc::new(DashMap::new()),
            authentication: Arc::new(DashMap::new()),
        })
    }

    pub async fn begin_registration(
        &self,
        store: &Store,
        bootstrap: &str,
        username: String,
        display_name: String,
        credential_name: String,
    ) -> Result<Registration> {
        validate_name(&username, 64)?;
        validate_name(&display_name, 100)?;
        validate_name(&credential_name, 100)?;
        store.claim_bootstrap(&secret::hash(bootstrap)).await?;
        let user = UserId::new();
        let (options, state) = self
            .webauthn
            .start_passkey_registration(user.value(), &username, &display_name, None)
            .map_err(|error| Error::Webauthn(error.to_string()))?;
        let ceremony = Uuid::now_v7();
        self.registration.insert(
            ceremony,
            RegisterState {
                created: tokio::time::Instant::now(),
                user,
                username,
                display_name,
                credential_name,
                state,
            },
        );
        Ok(Registration { ceremony, options })
    }

    pub async fn finish_registration(
        &self,
        store: &Store,
        ceremony: Uuid,
        credential: RegisterPublicKeyCredential,
    ) -> Result<Registered> {
        let (_, state) = self.registration.remove(&ceremony).ok_or(Error::Expired)?;
        if state.created.elapsed() > CEREMONY_TTL {
            return Err(Error::Expired);
        }
        let passkey = self
            .webauthn
            .finish_passkey_registration(&credential, &state.state)
            .map_err(|error| Error::Webauthn(error.to_string()))?;
        let codes = recovery_codes();
        let to_hash = codes.clone();
        let hashes = task::spawn_blocking(move || hash_recovery(&to_hash))
            .await
            .map_err(|error| Error::Internal(error.to_string()))??;
        let user = store
            .create_user(
                state.user,
                &state.username,
                &state.display_name,
                &state.credential_name,
                &passkey,
                &hashes,
            )
            .await?;
        Ok(Registered {
            user: user.into(),
            recovery_codes: codes,
        })
    }

    pub async fn begin_authentication(
        &self,
        store: &Store,
        username: &str,
    ) -> Result<Authentication> {
        let user = store.user_by_name(username).await?;
        let credentials = store.credentials(user.id).await?;
        if credentials.is_empty() {
            return Err(Error::Authentication);
        }
        let passkeys = credentials
            .iter()
            .map(|credential| credential.passkey.clone())
            .collect::<Vec<_>>();
        let (options, state) = self
            .webauthn
            .start_passkey_authentication(&passkeys)
            .map_err(|error| Error::Webauthn(error.to_string()))?;
        let ceremony = Uuid::now_v7();
        self.authentication.insert(
            ceremony,
            LoginState {
                created: tokio::time::Instant::now(),
                user,
                credentials,
                state,
            },
        );
        Ok(Authentication { ceremony, options })
    }

    pub async fn finish_authentication(
        &self,
        store: &Store,
        ceremony: Uuid,
        credential: PublicKeyCredential,
    ) -> Result<User> {
        let (_, mut state) = self
            .authentication
            .remove(&ceremony)
            .ok_or(Error::Expired)?;
        if state.created.elapsed() > CEREMONY_TTL {
            return Err(Error::Expired);
        }
        let result = self
            .webauthn
            .finish_passkey_authentication(&credential, &state.state)
            .map_err(|error| Error::Webauthn(error.to_string()))?;
        let stored = state
            .credentials
            .iter_mut()
            .find(|stored| stored.passkey.cred_id() == result.cred_id())
            .ok_or(Error::Authentication)?;
        if result.needs_update() {
            stored.passkey.update_credential(&result);
        }
        store.save_credential(stored).await?;
        Ok(state.user)
    }
}

fn validate_name(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
    {
        return Err(Error::Invalid(
            "name is empty, too long, or contains control characters".into(),
        ));
    }
    Ok(())
}

fn recovery_codes() -> Vec<String> {
    (0..10).map(|_| secret::short()).collect()
}

fn hash_recovery(codes: &[String]) -> Result<Vec<String>> {
    let argon = Argon2::default();
    codes
        .iter()
        .map(|code| {
            let salt =
                SaltString::encode_b64(&rand::random::<[u8; 16]>()).map_err(|_| Error::Password)?;
            argon
                .hash_password(code.as_bytes(), &salt)
                .map(|hash| hash.to_string())
                .map_err(|_| Error::Password)
        })
        .collect()
}
