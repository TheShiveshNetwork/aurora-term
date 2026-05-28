import { useState } from "react";
import { history } from "../lib/ipc";

export function useCommandHistory() {
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const searchHistory = async (query: string, limit: number = 20) => {
    setLoading(true);
    try {
      const items = await history.search(query, limit);
      setHistoryItems(items);
      return items;
    } catch (err) {
      console.error("Failed to query command history:", err);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const addHistoryEntry = async (entry: { session_id: string; command: string; cwd: string; exit_code?: number; duration_ms?: number }) => {
    try {
      await history.add(entry);
    } catch (err) {
      console.error("Failed to add command history entry:", err);
    }
  };

  return {
    historyItems,
    loading,
    searchHistory,
    addHistoryEntry,
  };
}
