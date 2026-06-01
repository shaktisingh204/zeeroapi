use crate::error::AppError;
use crate::state::AppState;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,   // user id
    pub email: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hash error: {e}"))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn issue_token(
    secret: &str,
    expiry_hours: i64,
    user_id: Uuid,
    email: &str,
    role: &str,
) -> anyhow::Result<String> {
    let now = Utc::now();
    let exp = now + Duration::hours(expiry_hours);
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;
    Ok(token)
}

/// Authenticated user extracted from the Bearer token.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub role: String,
}

impl AuthUser {
    pub fn require_admin(&self) -> Result<(), AppError> {
        if self.role == "admin" {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }

    /// admin or editor may mutate data.
    pub fn require_editor(&self) -> Result<(), AppError> {
        if self.role == "admin" || self.role == "editor" {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }
}

fn decode_bearer(parts: &Parts, secret: &str) -> Result<Claims, AppError> {
    let header = parts
        .headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let token = header.strip_prefix("Bearer ").ok_or(AppError::Unauthorized)?;
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|d| d.claims)
    .map_err(|_| AppError::Unauthorized)
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let claims = decode_bearer(parts, &state.config.jwt_secret)?;
        let id = Uuid::parse_str(&claims.sub).map_err(|_| AppError::Unauthorized)?;
        Ok(AuthUser {
            id,
            email: claims.email,
            role: claims.role,
        })
    }
}

/// Authenticated API *customer* (self-serve portal), distinct from admin users.
#[derive(Debug, Clone)]
pub struct CustomerAuth {
    pub customer_id: Uuid,
    pub email: String,
}

#[async_trait]
impl FromRequestParts<AppState> for CustomerAuth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let claims = decode_bearer(parts, &state.config.jwt_secret)?;
        if claims.role != "customer" {
            return Err(AppError::Unauthorized);
        }
        let id = Uuid::parse_str(&claims.sub).map_err(|_| AppError::Unauthorized)?;
        Ok(CustomerAuth {
            customer_id: id,
            email: claims.email,
        })
    }
}
