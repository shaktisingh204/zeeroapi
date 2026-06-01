use crate::config::Config;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// Create the Postgres connection pool and run migrations.
pub async fn init_pool(config: &Config) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("database migrations applied");

    Ok(pool)
}

/// Seed the first admin user if the users table is empty.
pub async fn bootstrap_admin(pool: &PgPool, config: &Config) -> anyhow::Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    if count > 0 {
        return Ok(());
    }

    let hash = crate::auth::hash_password(&config.bootstrap_admin_password)?;
    sqlx::query(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
    )
    .bind(&config.bootstrap_admin_email)
    .bind(&hash)
    .execute(pool)
    .await?;

    tracing::warn!(
        email = %config.bootstrap_admin_email,
        "seeded bootstrap admin user (change the password!)"
    );
    Ok(())
}
