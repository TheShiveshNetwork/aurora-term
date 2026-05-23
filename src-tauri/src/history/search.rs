use crate::error::AppError;
use crate::history::db::{HistoryDb, HistoryEntry};
use nucleo::{Matcher, Utf32Str};

pub fn fuzzy_search_history(
    db: &HistoryDb,
    query: &str,
    limit: usize,
) -> Result<Vec<HistoryEntry>, AppError> {
    let entries = db.get_recent(1000)?; // Pull last 1000 entries for fuzzy search context
    
    if query.is_empty() {
        return Ok(entries.into_iter().take(limit).collect());
    }

    let mut matcher = Matcher::default();
    let mut scored_entries: Vec<(u32, HistoryEntry)> = entries
        .into_iter()
        .filter_map(|entry| {
            let mut haystack_buf = Vec::new();
            let mut needle_buf = Vec::new();
            let haystack = Utf32Str::new(&entry.command, &mut haystack_buf);
            let needle = Utf32Str::new(query, &mut needle_buf);
            matcher.fuzzy_match(haystack, needle)
                .map(|score| (score as u32, entry))
        })
        .collect();

    // Sort by score descending
    scored_entries.sort_by(|a, b| b.0.cmp(&a.0));

    let results = scored_entries
        .into_iter()
        .map(|(_, entry)| entry)
        .take(limit)
        .collect();

    Ok(results)
}
