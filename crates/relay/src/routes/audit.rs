use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;

use crate::{browser::Principal, error::Result, model::AuditEvent, state::App};

const DEFAULT_LIMIT: u16 = 100;
const MAX_LIMIT: u16 = 500;

#[derive(Debug, Deserialize)]
pub struct List {
    limit: Option<u16>,
}

pub async fn list(
    State(app): State<App>,
    principal: Principal,
    Query(query): Query<List>,
) -> Result<Json<Vec<AuditEvent>>> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    Ok(Json(
        app.store.audit_events(principal.user.id, limit).await?,
    ))
}
