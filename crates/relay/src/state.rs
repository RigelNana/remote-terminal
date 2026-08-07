use std::sync::Arc;

use crate::{auth::Auth, config::Config, hub::Hub, store::Store, ticket::Tickets};

#[derive(Clone)]
pub struct App {
    pub config: Arc<Config>,
    pub store: Store,
    pub auth: Auth,
    pub hub: Hub,
    pub tickets: Tickets,
}

impl App {
    pub fn new(config: Config, store: Store, auth: Auth) -> Self {
        let hub = Hub::new(config.queue);
        Self {
            config: Arc::new(config),
            store,
            auth,
            hub,
            tickets: Tickets::default(),
        }
    }
}
