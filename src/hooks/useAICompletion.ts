import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAIStore } from "../stores/useAIStore";

export function useAICompletion() {
  const { appendStreamingText, setStreamingText, removePendingRequest } = useAIStore();

  useEffect(() => {
    const unsubscribe = listen<{ request_id: string; chunk: string; done: boolean }>(
      "ai_stream_chunk",
      (event) => {
        const { request_id, chunk, done } = event.payload;

        if (done) {
          removePendingRequest(request_id);
          // Dispatch custom event to signal active stream complete
          window.dispatchEvent(
            new CustomEvent(`ai-complete-${request_id}`, {
              detail: true,
            })
          );
        } else {
          appendStreamingText(chunk);
          // Dispatch custom event for token updates
          window.dispatchEvent(
            new CustomEvent(`ai-chunk-${request_id}`, {
              detail: chunk,
            })
          );
        }
      }
    );

    return () => {
      unsubscribe.then((unsub) => unsub());
    };
  }, []);
}
