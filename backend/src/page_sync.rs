//! Supervises the Python page scraper (scraper-py/realtime.py) as a managed
//! child process. It auto-starts on boot and is turned on/off at runtime by the
//! `page_sync_enabled` setting (editable from the dashboard Settings tab). The
//! cadence comes from `page_sync_interval`. If the scraper crashes it is
//! restarted automatically.

use crate::state::AppState;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, Command};

pub fn spawn_supervisor(state: AppState) {
    tokio::spawn(async move {
        let mut child: Option<Child> = None;
        let mut current_interval = String::new();

        loop {
            let enabled = setting(&state, "page_sync_enabled").await
                .map(|v| v == "true")
                .unwrap_or(true);
            let interval = setting(&state, "page_sync_interval").await
                .unwrap_or_else(|| "1".to_string());

            let running = matches!(child.as_mut().map(|c| c.try_wait()), Some(Ok(None)));

            if enabled && (!running || interval != current_interval) {
                if let Some(c) = child.take() {
                    stop_child(c).await;
                }
                match spawn_scraper(&state, &interval) {
                    Ok(c) => {
                        tracing::info!(interval = %interval, pid = ?c.id(), "page sync scraper started");
                        child = Some(c);
                        current_interval = interval.clone();
                    }
                    Err(e) => tracing::error!(error = %e, "failed to start page scraper"),
                }
            } else if !enabled && running {
                if let Some(c) = child.take() {
                    stop_child(c).await;
                    tracing::info!("page sync scraper stopped (toggle off)");
                }
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

fn spawn_scraper(state: &AppState, interval: &str) -> std::io::Result<Child> {
    let cfg = &state.config;
    let backend_url = format!("http://{}", cfg.bind_addr.replace("0.0.0.0", "127.0.0.1"));

    let mut cmd = Command::new(&cfg.page_scraper_python);
    cmd.arg(&cfg.page_scraper_script)
        .arg("--interval")
        .arg(interval)
        .env("BACKEND_URL", &backend_url)
        .env("INGEST_KEY", &cfg.ingest_key)
        .kill_on_drop(true);

    // Pipe output to a log file so it doesn't clutter the backend log.
    if let Ok(f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/page-sync.log")
    {
        if let Ok(f2) = f.try_clone() {
            cmd.stdout(Stdio::from(f)).stderr(Stdio::from(f2));
        }
    }

    cmd.spawn()
}

/// Stop a child gracefully (SIGTERM so it closes Chrome), then SIGKILL if it
/// doesn't exit within a few seconds.
async fn stop_child(mut child: Child) {
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    match tokio::time::timeout(Duration::from_secs(6), child.wait()).await {
        Ok(_) => {}
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
    }
}

async fn setting(state: &AppState, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = $1")
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
}
