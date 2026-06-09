//! Outbound email.
//!
//! In dev (the default — no `SMTP_URL`), messages are appended to
//! `config.mail_log_path` instead of being sent, so signup / password-reset /
//! usage-alert flows work with zero configuration locally. To send for real,
//! point `SMTP_URL` at a relay and wire a transport in [`send`] (e.g. the
//! `lettre` crate) — the call sites don't change.

use crate::config::Config;
use std::io::Write;

/// Send an email. This never fails the caller: delivery problems are logged, not
/// returned, so user flows (signup, reset) succeed regardless of mail health.
pub async fn send(config: &Config, to: &str, subject: &str, body: &str) {
    if !config.smtp_url.is_empty() {
        // A real SMTP transport is intentionally not compiled into this build to
        // keep the dev binary light. When SMTP_URL is set, implement delivery
        // here; until then we still record the message so nothing is lost.
        tracing::warn!(%to, "SMTP_URL is set but no SMTP transport is built — writing to the mail log instead");
    }

    let line = format!(
        "----- {ts} -----\nFrom: {from}\nTo: {to}\nSubject: {subject}\n\n{body}\n\n",
        ts = chrono::Utc::now().to_rfc3339(),
        from = config.email_from,
    );
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&config.mail_log_path)
    {
        Ok(mut f) => {
            let _ = f.write_all(line.as_bytes());
        }
        Err(e) => tracing::warn!(error = %e, path = %config.mail_log_path, "could not write mail log"),
    }
    tracing::info!(%to, %subject, "email queued (dev file-log transport)");
}

/// Welcome email sent right after a customer signs up.
pub async fn send_welcome(config: &Config, to: &str, name: Option<&str>) {
    let who = name.unwrap_or("there");
    let body = format!(
        "Hi {who},\n\nWelcome to {app}! Your account is ready.\n\n\
         Next steps:\n\
         1. Create an API key in your dashboard: {base}/portal\n\
         2. Try it in the playground: {base}/portal/playground\n\
         3. Read the docs: {base}/docs\n\n\
         Happy building,\nThe {app} team",
        app = config.app_name,
        base = config.portal_base_url,
    );
    send(config, to, &format!("Welcome to {}", config.app_name), &body).await;
}

/// Password-reset email carrying the one-time link.
pub async fn send_password_reset(config: &Config, to: &str, token: &str) {
    let link = format!("{}/reset?token={}", config.portal_base_url, token);
    let body = format!(
        "We received a request to reset your {app} password.\n\n\
         Reset it here (valid for 1 hour):\n{link}\n\n\
         If you didn't request this, you can safely ignore this email.",
        app = config.app_name,
        link = link,
    );
    send(config, to, &format!("{} — reset your password", config.app_name), &body).await;
}

/// Usage-alert email when a customer crosses their quota threshold.
pub async fn send_usage_alert(config: &Config, to: &str, pct: i64, used: i64, quota: i64) {
    let body = format!(
        "Heads up — you've used {pct}% of your monthly {app} request quota \
         ({used} of {quota} requests).\n\n\
         To avoid interruptions, consider upgrading your plan: {base}/portal/billing\n\n\
         — {app}",
        app = config.app_name,
        base = config.portal_base_url,
    );
    send(config, to, &format!("{} — {}% of your quota used", config.app_name, pct), &body).await;
}
