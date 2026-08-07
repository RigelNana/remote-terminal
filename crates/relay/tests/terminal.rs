use std::{collections::BTreeMap, error::Error, path::PathBuf, str::FromStr, time::Duration};

use futures_util::{SinkExt, StreamExt};
use http::header::{COOKIE, ORIGIN, SEC_WEBSOCKET_PROTOCOL};
use remote_agent::{
    config::{Config as AgentConfig, Profile},
    credential::Credential,
    link::Link,
};
use remote_proto::{
    id::{DeviceId, SessionId, UserId},
    wire::{Ack, Envelope, Input, envelope::Body},
};
use remote_relay::{
    api,
    auth::Auth,
    config::Config,
    model::{SessionState, now},
    secret,
    state::App,
    store::Store,
};
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tokio::{net::TcpListener, sync::oneshot, time};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

const SESSION_TOKEN: &str = "browser-test-token";
const CSRF_TOKEN: &str = "browser-test-csrf";
const DEVICE_TOKEN: &str = "device-test-token";
const SENTINEL: &[u8] = b"__REMOTE_TERMINAL_E2E_OK__";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shell_round_trip_through_relay() -> Result<(), Box<dyn Error>> {
    let root = std::env::temp_dir().join(format!("remote-terminal-{}", Uuid::now_v7()));
    tokio::fs::create_dir_all(&root).await?;
    let database = format!("sqlite://{}", root.join("relay.db").display());
    let store = Store::connect(&database).await?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?;
    let origin = Url::parse(&format!("http://localhost:{}", address.port()))?;
    let config = Config {
        bind: address,
        database: database.clone(),
        origin: origin.clone(),
        public_url: origin.clone(),
        rp_id: "localhost".into(),
        rp_name: "Remote Terminal Test".into(),
        cookie_secure: false,
        session_hours: 1,
        ticket_seconds: 30,
        body_limit: 64 * 1024,
        queue: 256,
    };
    let auth = Auth::new(&config)?;
    let app = App::new(config, store, auth);
    let pool = SqlitePool::connect(&database).await?;
    let user = UserId::new();
    let device = DeviceId::new();
    seed(&pool, user, device).await?;

    let (server_stop, server_stopped) = oneshot::channel();
    let server = tokio::spawn(async move {
        axum::serve(listener, api::router(app))
            .with_graceful_shutdown(async {
                let _ = server_stopped.await;
            })
            .await
    });

    let token_file = root.join("device.token");
    tokio::fs::write(&token_file, DEVICE_TOKEN).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&token_file, std::fs::Permissions::from_mode(0o600)).await?;
    }
    let agent_config = AgentConfig {
        relay: origin.clone(),
        device,
        name: "test device".into(),
        fingerprint: "test fingerprint".into(),
        journal_bytes: 1024 * 1024,
        token_file: Some(token_file),
        profiles: vec![Profile {
            id: "shell".into(),
            name: "Test shell".into(),
            shell: "/bin/sh".into(),
            args: Vec::new(),
            cwd: PathBuf::from_str("/")?,
            env: BTreeMap::new(),
        }],
    };
    let credential = Credential::load(&agent_config).await?;
    let agent_stop = CancellationToken::new();
    let stopped = agent_stop.clone();
    let agent = tokio::spawn(Link::new(agent_config, credential).run(stopped));

    let client = reqwest::Client::new();
    let cookies = format!("rt_session={SESSION_TOKEN}; rt_csrf={CSRF_TOKEN}");
    let devices = time::timeout(Duration::from_secs(10), async {
        loop {
            let response = client
                .get(origin.join("/v1/devices")?)
                .header(COOKIE, &cookies)
                .send()
                .await?;
            if response.status().is_success() {
                let devices: Value = response.json().await?;
                if devices.as_array().is_some_and(|devices| {
                    devices.iter().any(|entry| {
                        entry["id"] == device.to_string()
                            && entry["state"] == "online"
                            && entry["profiles"][0]["id"] == "shell"
                    })
                }) {
                    break Ok::<Value, Box<dyn Error>>(devices);
                }
            }
            time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await??;
    assert!(
        devices
            .as_array()
            .is_some_and(|devices| !devices.is_empty())
    );

    let response = client
        .post(origin.join("/v1/sessions")?)
        .header(COOKIE, &cookies)
        .header("x-csrf-token", CSRF_TOKEN)
        .header("idempotency-key", "terminal-e2e-session")
        .json(&json!({
            "device": device,
            "profile": "shell",
            "cwd": "/",
            "size": { "cols": 80, "rows": 24, "pixel_width": 0, "pixel_height": 0 }
        }))
        .send()
        .await?;
    assert_eq!(
        response.status(),
        reqwest::StatusCode::OK,
        "{}",
        response.text().await?
    );
    let session: Value = response.json().await?;
    let session_id = SessionId::from_str(session["id"].as_str().ok_or("missing session ID")?)?;

    time::timeout(Duration::from_secs(10), async {
        loop {
            let response = client
                .get(origin.join(&format!("/v1/sessions/{session_id}"))?)
                .header(COOKIE, &cookies)
                .send()
                .await?;
            let state: Value = response.json().await?;
            if state["state"] == "running" {
                break Ok::<(), Box<dyn Error>>(());
            }
            time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await??;

    let response = client
        .post(origin.join(&format!("/v1/sessions/{session_id}/attach"))?)
        .header(COOKIE, &cookies)
        .header("x-csrf-token", CSRF_TOKEN)
        .json(&json!({}))
        .send()
        .await?;
    assert_eq!(
        response.status(),
        reqwest::StatusCode::OK,
        "{}",
        response.text().await?
    );
    let grant: Value = response.json().await?;
    let attach = grant["attach"].as_str().ok_or("missing attachment ID")?;
    let mut websocket = Url::parse(grant["url"].as_str().ok_or("missing attachment URL")?)?;
    websocket.query_pairs_mut().append_pair(
        "ticket",
        grant["ticket"]
            .as_str()
            .ok_or("missing attachment ticket")?,
    );
    let mut request = websocket.as_str().into_client_request()?;
    request.headers_mut().insert(COOKIE, cookies.parse()?);
    request
        .headers_mut()
        .insert(ORIGIN, origin.as_str().parse()?);
    request
        .headers_mut()
        .insert(SEC_WEBSOCKET_PROTOCOL, "remote-terminal.v1".parse()?);
    let (mut terminal, _) = connect_async(request).await?;

    let first = time::timeout(Duration::from_secs(5), terminal.next())
        .await?
        .ok_or("terminal websocket closed")??;
    let Message::Binary(first) = first else {
        return Err("terminal websocket did not start with a binary role frame".into());
    };
    let role = Envelope::decode_frame(&first)?;
    assert!(matches!(role.body, Some(Body::Role(_))));
    let snapshot = time::timeout(Duration::from_secs(5), async {
        loop {
            let message = terminal.next().await.ok_or("terminal websocket closed")??;
            let Message::Binary(bytes) = message else {
                continue;
            };
            let frame = Envelope::decode_frame(&bytes)?;
            if let Some(Body::Snapshot(snapshot)) = frame.body {
                break Ok::<_, Box<dyn Error>>(snapshot);
            }
        }
    })
    .await??;
    assert_eq!(snapshot.target, attach);
    let input = Envelope::frame(
        session_id.to_string(),
        Body::Input(Input {
            attach: attach.into(),
            sequence: 1,
            data: bytes::Bytes::from_static(
                b"i=1; while [ \"$i\" -le 2000 ]; do printf 'history-%04d\\n' \"$i\"; i=$((i + 1)); done; printf '\\137\\137REMOTE_TERMINAL_E2E_OK\\137\\137\\n'\n",
            ),
        }),
    );
    terminal
        .send(Message::Binary(input.encode_frame()?))
        .await?;

    let output = time::timeout(Duration::from_secs(10), async {
        let mut output = Vec::new();
        while let Some(message) = terminal.next().await {
            let Message::Binary(bytes) = message? else {
                continue;
            };
            let frame = Envelope::decode_frame(&bytes)?;
            if let Some(Body::Output(chunk)) = frame.body {
                output.extend_from_slice(&chunk.data);
                let ack = Envelope::frame(
                    session_id.to_string(),
                    Body::Ack(Ack {
                        attach: attach.into(),
                        end: chunk.end,
                    }),
                );
                terminal.send(Message::Binary(ack.encode_frame()?)).await?;
                if output
                    .windows(SENTINEL.len())
                    .any(|window| window == SENTINEL)
                {
                    break;
                }
            }
        }
        Ok::<Vec<u8>, Box<dyn Error>>(output)
    })
    .await??;
    assert!(
        output
            .windows(SENTINEL.len())
            .any(|window| window == SENTINEL),
        "terminal output did not contain sentinel: {}",
        String::from_utf8_lossy(&output)
    );

    terminal.close(None).await?;
    let response = client
        .post(origin.join(&format!("/v1/sessions/{session_id}/attach"))?)
        .header(COOKIE, &cookies)
        .header("x-csrf-token", CSRF_TOKEN)
        .json(&json!({}))
        .send()
        .await?;
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let grant: Value = response.json().await?;
    let reattach = grant["attach"].as_str().ok_or("missing reattachment ID")?;
    let mut websocket = Url::parse(grant["url"].as_str().ok_or("missing reattachment URL")?)?;
    websocket.query_pairs_mut().append_pair(
        "ticket",
        grant["ticket"]
            .as_str()
            .ok_or("missing reattachment ticket")?,
    );
    let mut request = websocket.as_str().into_client_request()?;
    request.headers_mut().insert(COOKIE, cookies.parse()?);
    request
        .headers_mut()
        .insert(ORIGIN, origin.as_str().parse()?);
    request
        .headers_mut()
        .insert(SEC_WEBSOCKET_PROTOCOL, "remote-terminal.v1".parse()?);
    let (mut terminal, _) = connect_async(request).await?;

    let current = time::timeout(Duration::from_secs(5), async {
        let mut targeted_history_bytes = 0;
        loop {
            let Some(message) = terminal.next().await else {
                break Err::<_, Box<dyn Error>>("terminal websocket closed before snapshot".into());
            };
            let Message::Binary(bytes) = message? else {
                continue;
            };
            let frame = Envelope::decode_frame(&bytes)?;
            match frame.body {
                Some(Body::Output(chunk)) if chunk.target == reattach => {
                    targeted_history_bytes += chunk.data.len();
                }
                Some(Body::Snapshot(snapshot)) => {
                    break Ok::<_, Box<dyn Error>>((snapshot, targeted_history_bytes));
                }
                _ => {}
            }
        }
    })
    .await??;
    assert_eq!(current.0.target, reattach);
    assert_eq!(current.1, 0, "reattachment replayed targeted journal bytes");
    assert!(current.0.data.len() < output.len());
    assert!(
        !current
            .0
            .data
            .windows(b"history-0001".len())
            .any(|window| window == b"history-0001")
    );
    assert!(
        current
            .0
            .data
            .windows(SENTINEL.len())
            .any(|window| window == SENTINEL)
    );

    let exit = Envelope::frame(
        session_id.to_string(),
        Body::Input(Input {
            attach: reattach.into(),
            sequence: 1,
            data: bytes::Bytes::from_static(b"exit\n"),
        }),
    );
    terminal.send(Message::Binary(exit.encode_frame()?)).await?;

    time::timeout(Duration::from_secs(10), async {
        loop {
            let response = client
                .get(origin.join(&format!("/v1/sessions/{session_id}"))?)
                .header(COOKIE, &cookies)
                .send()
                .await?;
            let state: Value = response.json().await?;
            if state["state"] == "exited" {
                break Ok::<(), Box<dyn Error>>(());
            }
            time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await??;

    agent_stop.cancel();
    agent.await??;
    let _ = server_stop.send(());
    server.await??;
    pool.close().await;
    tokio::fs::remove_dir_all(root).await?;
    Ok(())
}

#[tokio::test]
async fn revoking_device_exits_active_sessions() -> Result<(), Box<dyn Error>> {
    let root = std::env::temp_dir().join(format!("remote-terminal-{}", Uuid::now_v7()));
    tokio::fs::create_dir_all(&root).await?;
    let database = format!("sqlite://{}", root.join("relay.db").display());
    let store = Store::connect(&database).await?;
    let pool = SqlitePool::connect(&database).await?;
    let user = UserId::new();
    let device = DeviceId::new();
    seed(&pool, user, device).await?;

    let mut sessions = Vec::new();
    for state in ["starting", "running", "lost"] {
        let id = SessionId::new();
        sqlx::query(
            "INSERT INTO sessions(\
                 id, user_id, device_id, profile, cwd, state, started_at, idempotency_key\
             ) VALUES (?, ?, ?, 'shell', '', ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(user.to_string())
        .bind(device.to_string())
        .bind(state)
        .bind(now())
        .bind(Uuid::now_v7().to_string())
        .execute(&pool)
        .await?;
        sessions.push(id);
    }

    store.revoke_device(user, device).await?;

    for id in sessions {
        let session = store.session(user, id).await?;
        assert_eq!(session.state, SessionState::Exited);
        assert_eq!(session.reason.as_deref(), Some("device_revoked"));
        assert!(session.ended_at.is_some());
    }
    Ok(())
}

async fn seed(pool: &SqlitePool, user: UserId, device: DeviceId) -> Result<(), sqlx::Error> {
    let timestamp = now();
    sqlx::query(
        "INSERT INTO users (id, username, display_name, created_at) VALUES (?, 'test', 'Test', ?)",
    )
    .bind(user.to_string())
    .bind(timestamp)
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO browser_sessions (id, user_id, token_hash, csrf_hash, user_agent, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, 'test', ?, ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(user.to_string())
    .bind(secret::hash(SESSION_TOKEN))
    .bind(secret::hash(CSRF_TOKEN))
    .bind(timestamp)
    .bind(timestamp)
    .bind(timestamp + 3600)
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO devices (id, user_id, name, platform, version, fingerprint, profiles, status, created_at) VALUES (?, ?, 'test device', 'linux', 'test', 'test fingerprint', '[]', 'offline', ?)",
    )
    .bind(device.to_string())
    .bind(user.to_string())
    .bind(timestamp)
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO device_keys (id, device_id, token_hash, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(device.to_string())
    .bind(secret::hash(DEVICE_TOKEN))
    .bind(timestamp)
    .execute(pool)
    .await?;
    Ok(())
}
