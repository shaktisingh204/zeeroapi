# ---- Build stage ----
FROM rust:1.83-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

# ---- Runtime stage ----
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/melbet-saas-backend /usr/local/bin/app
COPY --from=builder /app/migrations ./migrations
EXPOSE 8080
CMD ["app"]
