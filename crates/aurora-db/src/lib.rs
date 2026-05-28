pub mod db;
pub mod search;

pub use db::{HistoryDb, HistoryEntry, Snippet};
pub use search::fuzzy_search_history;
