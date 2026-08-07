# syntax=docker/dockerfile:1.7

FROM rust:1.97.1-bookworm AS relay-builder
WORKDIR /workspace
RUN apt-get update \
    && apt-get install --yes --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY proto ./proto
RUN cargo build --locked --release --package remote-relay

FROM node:24.7.0-bookworm-slim AS web-builder
WORKDIR /workspace/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/web ./
RUN npm run build

FROM debian:bookworm-slim AS relay
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 remote \
    && useradd --uid 10001 --gid remote --home-dir /nonexistent --shell /usr/sbin/nologin remote \
    && install --directory --owner remote --group remote /data
COPY --from=relay-builder /workspace/target/release/remote-relay /usr/local/bin/remote-relay
USER remote
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD ["curl", "--fail", "--silent", "http://127.0.0.1:8080/health/ready"]
ENTRYPOINT ["remote-relay"]
CMD ["serve"]

FROM caddy:2.10.2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-builder /workspace/apps/web/dist /srv
EXPOSE 80 443 443/udp
