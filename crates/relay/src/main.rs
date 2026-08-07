use std::path::PathBuf;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use clap::{Parser, Subcommand};
use remote_relay::{
    api,
    auth::Auth,
    config::Config,
    error::{Error, Result},
    model::now,
    secret,
    state::App,
    store::Store,
};
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser)]
#[command(version, about = "Remote Terminal public relay")]
struct Cli {
    #[arg(long, env = "RT_CONFIG")]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve,
    Bootstrap,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "remote_relay=info".into()))
        .with(tracing_subscriber::fmt::layer().json())
        .init();
    let cli = Cli::parse();
    let config = Config::load(cli.config.as_deref())?;
    match cli.command {
        Command::Serve => serve(config).await,
        Command::Bootstrap => bootstrap(config).await,
    }
}

async fn serve(config: Config) -> Result<()> {
    let store = Store::connect(&config.database).await?;
    let auth = Auth::new(&config)?;
    let bind = config.bind;
    let app = App::new(config, store, auth);
    let listener = TcpListener::bind(bind).await?;
    tracing::info!(%bind, "relay listening");
    axum::serve(listener, api::router(app))
        .with_graceful_shutdown(shutdown())
        .await
        .map_err(|error| Error::Io(std::io::Error::other(error)))
}

async fn bootstrap(config: Config) -> Result<()> {
    let store = Store::connect(&config.database).await?;
    let token = secret::token();
    store
        .create_bootstrap(&secret::hash(&token), now() + 600)
        .await?;
    let mut url = config
        .public_url
        .join("/onboard")
        .map_err(|error| Error::Config(error.to_string()))?;
    url.query_pairs_mut().append_pair("bootstrap", &token);
    let encoded = URL_SAFE_NO_PAD.encode(url.as_str());
    println!("Bootstrap URL (valid for 10 minutes): {url}");
    println!("Encoded URL for copy-safe transport: {encoded}");
    Ok(())
}

async fn shutdown() {
    let interrupt = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to install Ctrl+C handler");
        }
    };
    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut signal) = signal(SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
}
