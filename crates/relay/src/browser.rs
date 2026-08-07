use axum::{
    extract::FromRequestParts,
    http::{HeaderMap, HeaderValue, header, request::Parts},
};
use cookie::{Cookie, SameSite};
use remote_proto::id::UserId;
use uuid::Uuid;

use crate::{
    config::Config,
    error::{Error, Result},
    model::{User, now},
    secret,
    state::App,
    store::BrowserGrant,
};

const SESSION: &str = "rt_session";
const CSRF: &str = "rt_csrf";

#[derive(Clone, Debug)]
pub struct Principal {
    pub browser: Uuid,
    pub user: User,
    csrf_hash: String,
}

impl Principal {
    pub fn csrf(&self, headers: &HeaderMap) -> Result<()> {
        let header = headers
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or(Error::Forbidden)?;
        let cookie = cookie(headers, CSRF).ok_or(Error::Forbidden)?;
        if header != cookie || secret::hash(header) != self.csrf_hash {
            return Err(Error::Forbidden);
        }
        Ok(())
    }
}

impl FromRequestParts<App> for Principal {
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &App) -> Result<Self> {
        let token = cookie(&parts.headers, SESSION).ok_or(Error::Authentication)?;
        let browser = state.store.browser(&secret::hash(&token)).await?;
        Ok(Self {
            browser: browser.id,
            csrf_hash: browser.csrf_hash,
            user: browser.user,
        })
    }
}

pub struct SessionCookies {
    pub browser: Uuid,
    pub headers: HeaderMap,
}

impl SessionCookies {
    pub async fn issue(
        store: &crate::store::Store,
        config: &Config,
        user: UserId,
        user_agent: &str,
    ) -> Result<Self> {
        let token = secret::token();
        let csrf = secret::token();
        let expires = now() + config.session_hours * 60 * 60;
        let browser = store
            .create_browser(BrowserGrant {
                user,
                token_hash: &secret::hash(&token),
                csrf_hash: &secret::hash(&csrf),
                user_agent,
                expires_at: expires,
            })
            .await?;
        let age = cookie::time::Duration::hours(config.session_hours);
        let session = Cookie::build((SESSION, token))
            .path("/")
            .http_only(true)
            .secure(config.cookie_secure)
            .same_site(SameSite::Strict)
            .max_age(age)
            .build();
        let csrf = Cookie::build((CSRF, csrf))
            .path("/")
            .http_only(false)
            .secure(config.cookie_secure)
            .same_site(SameSite::Strict)
            .max_age(age)
            .build();
        let mut headers = HeaderMap::new();
        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&session.to_string())
                .map_err(|error| Error::Internal(error.to_string()))?,
        );
        headers.append(
            header::SET_COOKIE,
            HeaderValue::from_str(&csrf.to_string())
                .map_err(|error| Error::Internal(error.to_string()))?,
        );
        Ok(Self { browser, headers })
    }

    pub fn clear(config: &Config) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        for name in [SESSION, CSRF] {
            let cookie = Cookie::build((name, ""))
                .path("/")
                .http_only(name == SESSION)
                .secure(config.cookie_secure)
                .same_site(SameSite::Strict)
                .max_age(cookie::time::Duration::ZERO)
                .build();
            headers.append(
                header::SET_COOKIE,
                HeaderValue::from_str(&cookie.to_string())
                    .map_err(|error| Error::Internal(error.to_string()))?,
            );
        }
        Ok(headers)
    }
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|value| Cookie::parse(value.trim()).ok())
        .find(|cookie| cookie.name() == name)
        .map(|cookie| cookie.value().to_owned())
}
