//! Thin Redis layer: caches hot read payloads (live snapshot, stats), keeps
//! live counters, and publishes update pings for the SSE live stream. All
//! operations are best-effort — if Redis is down the app still works off
//! Postgres, just without the cache fast-path.

use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::Serialize;

#[derive(Clone)]
pub struct Cache {
    conn: ConnectionManager,
}

impl Cache {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn })
    }

    /// Cache a JSON-serializable value with a TTL (seconds).
    pub async fn set_json<T: Serialize>(&self, key: &str, val: &T, ttl_secs: u64) {
        if let Ok(s) = serde_json::to_string(val) {
            let mut c = self.conn.clone();
            let _: Result<(), _> = c.set_ex(key, s, ttl_secs).await;
        }
    }

    /// Read a raw cached string.
    pub async fn get_raw(&self, key: &str) -> Option<String> {
        let mut c = self.conn.clone();
        c.get(key).await.ok()
    }

    /// Increment a counter by `n` (returns the new value).
    pub async fn incr(&self, key: &str, n: i64) -> Option<i64> {
        let mut c = self.conn.clone();
        c.incr(key, n).await.ok()
    }

    pub async fn get_i64(&self, key: &str) -> i64 {
        let mut c = self.conn.clone();
        c.get(key).await.unwrap_or(0)
    }

    /// Increment a counter, setting a TTL the first time it's created. Returns
    /// the new value (used for fixed-window rate limiting + monthly quota).
    pub async fn incr_ex(&self, key: &str, ttl_secs: u64) -> i64 {
        let mut c = self.conn.clone();
        let v: i64 = c.incr(key, 1).await.unwrap_or(0);
        if v == 1 {
            let _: Result<(), _> = c.expire(key, ttl_secs as i64).await;
        }
        v
    }

    /// Publish a small message to a channel (live-update ping for SSE).
    pub async fn publish(&self, channel: &str, msg: &str) {
        let mut c = self.conn.clone();
        let _: Result<(), _> = c.publish(channel, msg).await;
    }

    /// Push an entry onto a capped list (newest first) with a TTL.
    pub async fn log_push(&self, key: &str, entry: &str, cap: isize, ttl_secs: u64) {
        let mut c = self.conn.clone();
        let _: Result<(), _> = c.lpush(key, entry).await;
        let _: Result<(), _> = c.ltrim(key, 0, cap - 1).await;
        let _: Result<(), _> = c.expire(key, ttl_secs as i64).await;
    }

    /// Read up to `count` newest entries from a list.
    pub async fn list_recent(&self, key: &str, count: isize) -> Vec<String> {
        let mut c = self.conn.clone();
        c.lrange(key, 0, count - 1).await.unwrap_or_default()
    }

    /// Liveness check for the status page.
    pub async fn ping(&self) -> bool {
        let mut c = self.conn.clone();
        redis::cmd("PING").query_async::<String>(&mut c).await.is_ok()
    }
}
