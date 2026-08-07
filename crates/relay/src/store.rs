use std::{str::FromStr, time::Duration};

use remote_proto::{
    id::{DeviceId, EventId, SessionId, UserId},
    wire::Profile,
};
use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use uuid::Uuid;
use webauthn_rs::prelude::Passkey;

use crate::{
    error::{Error, Result},
    model::{
        Audit, AuditEvent, Browser, Credential, Device, DeviceFlow, DeviceState, FlowState,
        Session, SessionState, User, device, now, session, user, uuid,
    },
};

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
}

pub struct BrowserGrant<'a> {
    pub user: UserId,
    pub token_hash: &'a str,
    pub csrf_hash: &'a str,
    pub user_agent: &'a str,
    pub expires_at: i64,
}

pub struct FlowGrant<'a> {
    pub device_hash: &'a str,
    pub token_hash: &'a str,
}

impl Store {
    pub async fn connect(database: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(database)
            .map_err(|error| Error::Config(error.to_string()))?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await?;
        sqlx::migrate!()
            .run(&pool)
            .await
            .map_err(|error| Error::Internal(format!("database migration failed: {error}")))?;
        Ok(Self { pool })
    }

    pub async fn ready(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    pub async fn user_count(&self) -> Result<i64> {
        Ok(sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await?)
    }

    pub async fn create_bootstrap(&self, token_hash: &str, expires_at: i64) -> Result<Uuid> {
        if self.user_count().await? != 0 {
            return Err(Error::Conflict);
        }
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO bootstraps(id, token_hash, expires_at) VALUES (?, ?, ?)")
            .bind(id.to_string())
            .bind(token_hash)
            .bind(expires_at)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    pub async fn claim_bootstrap(&self, token_hash: &str) -> Result<()> {
        if self.user_count().await? != 0 {
            return Err(Error::Conflict);
        }
        let result = sqlx::query(
            "UPDATE bootstraps SET used_at = ? \
             WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
        )
        .bind(now())
        .bind(token_hash)
        .bind(now())
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::Expired);
        }
        Ok(())
    }

    pub async fn create_user(
        &self,
        id: UserId,
        username: &str,
        display_name: &str,
        credential_name: &str,
        passkey: &Passkey,
        recovery_hashes: &[String],
    ) -> Result<User> {
        let mut tx = self.pool.begin().await?;
        let user = User {
            id,
            username: username.into(),
            display_name: display_name.into(),
        };
        sqlx::query(
            "INSERT INTO users(id, username, display_name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(user.id.to_string())
        .bind(&user.username)
        .bind(&user.display_name)
        .bind(now())
        .execute(&mut *tx)
        .await?;
        self.insert_credential(&mut tx, user.id, credential_name, passkey)
            .await?;
        for hash in recovery_hashes {
            sqlx::query(
                "INSERT INTO recovery_codes(id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(user.id.to_string())
            .bind(hash)
            .bind(now())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(user)
    }

    async fn insert_credential(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        user: UserId,
        name: &str,
        passkey: &Passkey,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO credentials(id, user_id, name, passkey, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(user.to_string())
        .bind(name)
        .bind(serde_json::to_string(passkey)?)
        .bind(now())
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    pub async fn user_by_name(&self, username: &str) -> Result<User> {
        let row = sqlx::query("SELECT id, username, display_name FROM users WHERE username = ?")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(Error::Authentication)?;
        Self::user_row(&row)
    }

    pub async fn credentials(&self, owner: UserId) -> Result<Vec<Credential>> {
        let rows = sqlx::query(
            "SELECT id, user_id, name, passkey FROM credentials WHERE user_id = ? ORDER BY created_at",
        )
        .bind(owner.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(Credential {
                    id: uuid(row.try_get("id")?)?,
                    user: user(row.try_get("user_id")?)?,
                    name: row.try_get("name")?,
                    passkey: serde_json::from_str(row.try_get("passkey")?)?,
                })
            })
            .collect()
    }

    pub async fn save_credential(&self, credential: &Credential) -> Result<()> {
        sqlx::query(
            "UPDATE credentials SET passkey = ?, last_used_at = ? WHERE id = ? AND user_id = ?",
        )
        .bind(serde_json::to_string(&credential.passkey)?)
        .bind(now())
        .bind(credential.id.to_string())
        .bind(credential.user.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn create_browser(&self, grant: BrowserGrant<'_>) -> Result<Uuid> {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO browser_sessions(\
                 id, user_id, token_hash, csrf_hash, user_agent, created_at, last_used_at, expires_at\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(grant.user.to_string())
        .bind(grant.token_hash)
        .bind(grant.csrf_hash)
        .bind(grant.user_agent)
        .bind(now())
        .bind(now())
        .bind(grant.expires_at)
        .execute(&self.pool)
        .await?;
        Ok(id)
    }

    pub async fn browser(&self, token_hash: &str) -> Result<Browser> {
        let row = sqlx::query(
            "SELECT s.id, s.csrf_hash, s.expires_at, u.id AS user_id, u.username, u.display_name \
             FROM browser_sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?",
        )
        .bind(token_hash)
        .bind(now())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::Authentication)?;
        let browser = Browser {
            id: uuid(row.try_get("id")?)?,
            user: User {
                id: user(row.try_get("user_id")?)?,
                username: row.try_get("username")?,
                display_name: row.try_get("display_name")?,
            },
            csrf_hash: row.try_get("csrf_hash")?,
            expires_at: row.try_get("expires_at")?,
        };
        sqlx::query("UPDATE browser_sessions SET last_used_at = ? WHERE id = ?")
            .bind(now())
            .bind(browser.id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(browser)
    }

    pub async fn revoke_browser(&self, id: Uuid, user_id: UserId) -> Result<()> {
        let result = sqlx::query(
            "UPDATE browser_sessions SET revoked_at = ? \
             WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        )
        .bind(now())
        .bind(id.to_string())
        .bind(user_id.to_string())
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    pub async fn recover(&self, username: &str, code: &str) -> Result<User> {
        let user = self.user_by_name(username).await?;
        let rows = sqlx::query(
            "SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
        )
        .bind(user.id.to_string())
        .fetch_all(&self.pool)
        .await?;
        for row in rows {
            let hash: String = row.try_get("code_hash")?;
            let parsed =
                argon2::password_hash::PasswordHash::new(&hash).map_err(|_| Error::Password)?;
            if argon2::PasswordVerifier::verify_password(
                &argon2::Argon2::default(),
                code.as_bytes(),
                &parsed,
            )
            .is_ok()
            {
                sqlx::query(
                    "UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
                )
                .bind(now())
                .bind(row.try_get::<String, _>("id")?)
                .execute(&self.pool)
                .await?;
                return Ok(user);
            }
        }
        Err(Error::Authentication)
    }

    pub async fn create_flow(&self, flow: &DeviceFlow, device_hash: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO device_flows(\
                 id, device_hash, user_code, name, platform, version, fingerprint, expires_at, \
                 interval_secs, status, created_at\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(flow.id.to_string())
        .bind(device_hash)
        .bind(&flow.user_code)
        .bind(&flow.name)
        .bind(&flow.platform)
        .bind(&flow.version)
        .bind(&flow.fingerprint)
        .bind(flow.expires_at)
        .bind(flow.interval_secs)
        .bind(flow.state.as_str())
        .bind(now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn authorize_flow(&self, user_id: UserId, user_code: &str) -> Result<DeviceFlow> {
        let result = sqlx::query(
            "UPDATE device_flows SET status = 'approved', user_id = ? \
             WHERE user_code = ? AND status = 'pending' AND expires_at > ?",
        )
        .bind(user_id.to_string())
        .bind(user_code)
        .bind(now())
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::Expired);
        }
        self.flow_by_code(user_code).await
    }

    pub async fn poll_flow(&self, device_hash: &str) -> Result<DeviceFlow> {
        let flow = self.flow_by_hash(device_hash).await?;
        let current = now();
        if current >= flow.expires_at {
            return Err(Error::Expired);
        }
        if let Some(last) = flow.last_poll_at
            && current < last + flow.interval_secs
        {
            return Err(Error::RateLimited);
        }
        sqlx::query("UPDATE device_flows SET last_poll_at = ? WHERE id = ?")
            .bind(current)
            .bind(flow.id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(flow)
    }

    pub async fn grant_flow(&self, grant: FlowGrant<'_>) -> Result<(DeviceId, UserId)> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, user_id, name, platform, version, fingerprint, expires_at, status \
             FROM device_flows WHERE device_hash = ?",
        )
        .bind(grant.device_hash)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Error::Authentication)?;
        let state = FlowState::from_str(row.try_get("status")?)?;
        let expires_at: i64 = row.try_get("expires_at")?;
        if expires_at <= now() {
            return Err(Error::Expired);
        }
        if state != FlowState::Approved {
            return Err(Error::Conflict);
        }
        let owner = user(row.try_get("user_id")?)?;
        let device_id = DeviceId::new();
        sqlx::query(
            "INSERT INTO devices(\
                 id, user_id, name, platform, version, fingerprint, status, created_at\
             ) VALUES (?, ?, ?, ?, ?, ?, 'offline', ?)",
        )
        .bind(device_id.to_string())
        .bind(owner.to_string())
        .bind(row.try_get::<String, _>("name")?)
        .bind(row.try_get::<String, _>("platform")?)
        .bind(row.try_get::<String, _>("version")?)
        .bind(row.try_get::<String, _>("fingerprint")?)
        .bind(now())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO device_keys(id, device_id, token_hash, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(device_id.to_string())
        .bind(grant.token_hash)
        .bind(now())
        .execute(&mut *tx)
        .await?;
        let result = sqlx::query(
            "UPDATE device_flows SET status = 'consumed' WHERE id = ? AND status = 'approved'",
        )
        .bind(row.try_get::<String, _>("id")?)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        tx.commit().await?;
        Ok((device_id, owner))
    }

    async fn flow_by_hash(&self, device_hash: &str) -> Result<DeviceFlow> {
        let row = sqlx::query(
            "SELECT id, user_code, name, platform, version, fingerprint, expires_at, \
                    interval_secs, last_poll_at, status, user_id \
             FROM device_flows WHERE device_hash = ?",
        )
        .bind(device_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::Authentication)?;
        Self::flow_row(&row)
    }

    pub async fn flow_by_code(&self, user_code: &str) -> Result<DeviceFlow> {
        let row = sqlx::query(
            "SELECT id, user_code, name, platform, version, fingerprint, expires_at, \
                    interval_secs, last_poll_at, status, user_id \
             FROM device_flows WHERE user_code = ?",
        )
        .bind(user_code)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::NotFound)?;
        Self::flow_row(&row)
    }

    pub async fn authenticate_device(&self, id: DeviceId, token_hash: &str) -> Result<UserId> {
        let row = sqlx::query(
            "SELECT d.user_id FROM devices d JOIN device_keys k ON k.device_id = d.id \
             WHERE d.id = ? AND k.token_hash = ? AND d.revoked_at IS NULL \
                   AND k.revoked_at IS NULL",
        )
        .bind(id.to_string())
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::Authentication)?;
        user(row.try_get("user_id")?)
    }

    pub async fn device(&self, owner: UserId, id: DeviceId) -> Result<Device> {
        let row = sqlx::query(
            "SELECT id, name, platform, version, fingerprint, profiles, status, \
                    created_at, last_seen_at \
             FROM devices WHERE id = ? AND user_id = ?",
        )
        .bind(id.to_string())
        .bind(owner.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::NotFound)?;
        Self::device_row(&row)
    }

    pub async fn devices(&self, owner: UserId) -> Result<Vec<Device>> {
        let rows = sqlx::query(
            "SELECT id, name, platform, version, fingerprint, profiles, status, \
                    created_at, last_seen_at \
             FROM devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 200",
        )
        .bind(owner.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::device_row).collect()
    }

    pub async fn online_device(
        &self,
        id: DeviceId,
        version: &str,
        profiles: &[Profile],
    ) -> Result<()> {
        let result = sqlx::query(
            "UPDATE devices SET status = 'online', version = ?, profiles = ?, last_seen_at = ? \
             WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(version)
        .bind(serde_json::to_string(profiles)?)
        .bind(now())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    pub async fn seen_device(&self, id: DeviceId) -> Result<()> {
        sqlx::query(
            "UPDATE devices SET status = 'online', last_seen_at = ? \
             WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(now())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn offline_device(&self, id: DeviceId) -> Result<()> {
        sqlx::query(
            "UPDATE devices SET status = 'offline', last_seen_at = ? \
             WHERE id = ? AND revoked_at IS NULL",
        )
        .bind(now())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE sessions SET state = 'lost', ended_at = ?, reason = 'agent_disconnected' \
             WHERE device_id = ? AND state IN ('starting', 'running')",
        )
        .bind(now())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn rename_device(&self, owner: UserId, id: DeviceId, name: &str) -> Result<()> {
        let result = sqlx::query(
            "UPDATE devices SET name = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        )
        .bind(name)
        .bind(id.to_string())
        .bind(owner.to_string())
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    pub async fn revoke_device(&self, owner: UserId, id: DeviceId) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let revoked_at = now();
        let result = sqlx::query(
            "UPDATE devices SET status = 'revoked', revoked_at = ? \
             WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        )
        .bind(revoked_at)
        .bind(id.to_string())
        .bind(owner.to_string())
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::NotFound);
        }
        sqlx::query(
            "UPDATE device_keys SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL",
        )
        .bind(revoked_at)
        .bind(id.to_string())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE sessions SET state = 'exited', ended_at = ?, exit_code = NULL, \
             reason = 'device_revoked' \
             WHERE device_id = ? AND state IN ('starting', 'running', 'lost')",
        )
        .bind(revoked_at)
        .bind(id.to_string())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn create_session(
        &self,
        owner: UserId,
        device_id: DeviceId,
        profile: &str,
        cwd: &str,
        idempotency: &str,
    ) -> Result<(Session, bool)> {
        if let Some(row) = sqlx::query(
            "SELECT id, device_id, profile, cwd, state, pid, started_at, ended_at, exit_code, reason \
             FROM sessions WHERE user_id = ? AND idempotency_key = ?",
        )
        .bind(owner.to_string())
        .bind(idempotency)
        .fetch_optional(&self.pool)
        .await?
        {
            return Self::session_row(&row).map(|session| (session, false));
        }
        let id = SessionId::new();
        sqlx::query(
            "INSERT INTO sessions(\
                 id, user_id, device_id, profile, cwd, state, started_at, idempotency_key\
             ) VALUES (?, ?, ?, ?, ?, 'starting', ?, ?)",
        )
        .bind(id.to_string())
        .bind(owner.to_string())
        .bind(device_id.to_string())
        .bind(profile)
        .bind(cwd)
        .bind(now())
        .bind(idempotency)
        .execute(&self.pool)
        .await?;
        self.session(owner, id).await.map(|session| (session, true))
    }

    pub async fn session(&self, owner: UserId, id: SessionId) -> Result<Session> {
        let row = sqlx::query(
            "SELECT id, device_id, profile, cwd, state, pid, started_at, ended_at, exit_code, reason \
             FROM sessions WHERE id = ? AND user_id = ?",
        )
        .bind(id.to_string())
        .bind(owner.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::NotFound)?;
        Self::session_row(&row)
    }

    pub async fn session_device(&self, id: SessionId, device_id: DeviceId) -> Result<Session> {
        let row = sqlx::query(
            "SELECT id, device_id, profile, cwd, state, pid, started_at, ended_at, exit_code, reason \
             FROM sessions WHERE id = ? AND device_id = ?",
        )
        .bind(id.to_string())
        .bind(device_id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::NotFound)?;
        Self::session_row(&row)
    }

    pub async fn sessions(&self, owner: UserId) -> Result<Vec<Session>> {
        let rows = sqlx::query(
            "SELECT id, device_id, profile, cwd, state, pid, started_at, ended_at, exit_code, reason \
             FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 200",
        )
        .bind(owner.to_string())
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::session_row).collect()
    }

    pub async fn running_session(&self, id: SessionId, pid: u32) -> Result<()> {
        let result = sqlx::query(
            "UPDATE sessions SET state = 'running', pid = ?, ended_at = NULL, reason = NULL \
             WHERE id = ? AND state IN ('starting', 'lost')",
        )
        .bind(i64::from(pid))
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        Ok(())
    }

    pub async fn exit_session(&self, id: SessionId, code: Option<i32>, reason: &str) -> Result<()> {
        sqlx::query(
            "UPDATE sessions SET state = 'exited', ended_at = ?, exit_code = ?, reason = ? \
             WHERE id = ? AND state IN ('starting', 'running', 'lost')",
        )
        .bind(now())
        .bind(code)
        .bind(reason)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn audit(&self, event: Audit<'_>) -> Result<EventId> {
        let mut tx = self.pool.begin().await?;
        let previous: Option<String> = sqlx::query_scalar(
            "SELECT event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1",
        )
        .fetch_optional(&mut *tx)
        .await?
        .flatten();
        let previous = previous.unwrap_or_else(|| "0".repeat(64));
        let id = EventId::new();
        let occurred = now();
        let mut digest = blake3::Hasher::new();
        for part in [
            previous.as_str(),
            &id.to_string(),
            &event
                .user
                .map(|value| value.to_string())
                .unwrap_or_default(),
            event.actor,
            event.kind,
            event.target,
            event.result,
            &occurred.to_string(),
        ] {
            digest.update(part.as_bytes());
            digest.update(&[0]);
        }
        let hash = digest.finalize().to_hex().to_string();
        sqlx::query(
            "INSERT INTO audit_events(\
                 id, user_id, actor, kind, target, result, occurred_at, previous_hash, event_hash\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(event.user.map(|value| value.to_string()))
        .bind(event.actor)
        .bind(event.kind)
        .bind(event.target)
        .bind(event.result)
        .bind(occurred)
        .bind(previous)
        .bind(hash)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(id)
    }
    pub async fn audit_events(&self, user: UserId, limit: u16) -> Result<Vec<AuditEvent>> {
        let rows = sqlx::query(
            "SELECT id, actor, kind, target, result, occurred_at \
             FROM audit_events WHERE user_id = ? ORDER BY sequence DESC LIMIT ?",
        )
        .bind(user.to_string())
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(AuditEvent {
                    id: EventId::from_str(row.try_get("id")?)
                        .map_err(|_| Error::Internal("invalid event ID in store".into()))?,
                    actor: row.try_get("actor")?,
                    kind: row.try_get("kind")?,
                    target: row.try_get("target")?,
                    result: row.try_get("result")?,
                    occurred_at: row.try_get("occurred_at")?,
                })
            })
            .collect()
    }

    fn user_row(row: &sqlx::sqlite::SqliteRow) -> Result<User> {
        Ok(User {
            id: user(row.try_get("id")?)?,
            username: row.try_get("username")?,
            display_name: row.try_get("display_name")?,
        })
    }

    fn flow_row(row: &sqlx::sqlite::SqliteRow) -> Result<DeviceFlow> {
        let owner: Option<String> = row.try_get("user_id")?;
        Ok(DeviceFlow {
            id: uuid(row.try_get("id")?)?,
            user_code: row.try_get("user_code")?,
            name: row.try_get("name")?,
            platform: row.try_get("platform")?,
            version: row.try_get("version")?,
            fingerprint: row.try_get("fingerprint")?,
            expires_at: row.try_get("expires_at")?,
            interval_secs: row.try_get("interval_secs")?,
            last_poll_at: row.try_get("last_poll_at")?,
            state: FlowState::from_str(row.try_get("status")?)?,
            user: owner.as_deref().map(user).transpose()?,
        })
    }

    fn device_row(row: &sqlx::sqlite::SqliteRow) -> Result<Device> {
        Ok(Device {
            id: device(row.try_get("id")?)?,
            name: row.try_get("name")?,
            platform: row.try_get("platform")?,
            version: row.try_get("version")?,
            fingerprint: row.try_get("fingerprint")?,
            profiles: serde_json::from_str(row.try_get("profiles")?)?,
            state: DeviceState::from_str(row.try_get("status")?)?,
            created_at: row.try_get("created_at")?,
            last_seen_at: row.try_get("last_seen_at")?,
        })
    }

    fn session_row(row: &sqlx::sqlite::SqliteRow) -> Result<Session> {
        let pid: Option<i64> = row.try_get("pid")?;
        Ok(Session {
            id: session(row.try_get("id")?)?,
            device: device(row.try_get("device_id")?)?,
            profile: row.try_get("profile")?,
            cwd: row.try_get("cwd")?,
            state: SessionState::from_str(row.try_get("state")?)?,
            pid: pid.and_then(|value| u32::try_from(value).ok()),
            started_at: row.try_get("started_at")?,
            ended_at: row.try_get("ended_at")?,
            exit_code: row.try_get("exit_code")?,
            reason: row.try_get("reason")?,
        })
    }
}
