use aurora_core::AppError;
use crate::db::{HistoryDb, HistoryEntry};
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
    scored_entries.sort_by_key(|b| std::cmp::Reverse(b.0));

    let results = scored_entries
        .into_iter()
        .map(|(_, entry)| entry)
        .take(limit)
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuzzy_search() {
        let db = HistoryDb::new(None).unwrap();
        db.add_entry(&HistoryEntry {
            id: None,
            session_id: "test-session".to_string(),
            command: "git commit -m \"first commit\"".to_string(),
            cwd: "/".to_string(),
            exit_code: Some(0),
            duration_ms: Some(15),
            created_at: None,
        }).unwrap();
        db.add_entry(&HistoryEntry {
            id: None,
            session_id: "test-session".to_string(),
            command: "cargo check".to_string(),
            cwd: "/".to_string(),
            exit_code: Some(0),
            duration_ms: Some(25),
            created_at: None,
        }).unwrap();

        let results = fuzzy_search_history(&db, "git com", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].command, "git commit -m \"first commit\"");
    }
}

