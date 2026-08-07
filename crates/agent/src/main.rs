use std::path::PathBuf;

use clap::{Parser, Subcommand};
use remote_agent::{config::Config, credential::Credential, error::Result, link::Link, pair};
use tokio_util::sync::CancellationToken;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use url::Url;

#[derive(Parser)]
#[command(version, about = "Remote Terminal device agent")]
struct Cli {
    #[arg(long, env = "RT_AGENT_CONFIG")]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Pair {
        relay: Url,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        force: bool,
    },
    Run,
    Check,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "remote_agent=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();
    let cli = Cli::parse();
    let path = cli.config.unwrap_or_else(default_config);
    match cli.command {
        Command::Pair { relay, name, force } => {
            pair::run(relay, name.unwrap_or_else(device_name), &path, force).await?;
            println!("Device paired. Starting the agent; press Ctrl+C to stop.");
            run(&path).await
        }
        Command::Run => run(&path).await,
        Command::Check => check(&path).await,
    }
}

async fn run(path: &std::path::Path) -> Result<()> {
    let config = Config::load(path)?;
    let credential = Credential::load(&config).await?;
    let shutdown = CancellationToken::new();
    let signal = shutdown.clone();
    tokio::spawn(async move {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to install Ctrl+C handler");
        }
        signal.cancel();
    });
    Link::new(config, credential).run(shutdown).await
}

async fn check(path: &std::path::Path) -> Result<()> {
    let config = Config::load(path)?;
    let _credential = Credential::load(&config).await?;
    println!(
        "Configuration valid: device {}, relay {}, {} profile(s)",
        config.device,
        config.relay,
        config.profiles.len()
    );
    Ok(())
}

fn default_config() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "APPDATA" } else { "HOME" })
        .map(PathBuf::from)
        .map(|base| {
            if cfg!(windows) {
                base.join("RemoteTerminal").join("agent.toml")
            } else {
                base.join(".config")
                    .join("remote-terminal")
                    .join("agent.toml")
            }
        })
        .unwrap_or_else(|| PathBuf::from("agent.toml"))
}

fn device_name() -> String {
    std::env::var(if cfg!(windows) {
        "COMPUTERNAME"
    } else {
        "HOSTNAME"
    })
    .unwrap_or_else(|_| format!("{} device", std::env::consts::OS))
}
