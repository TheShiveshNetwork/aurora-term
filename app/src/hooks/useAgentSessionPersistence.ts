import { useEffect, useRef } from "react";

import { useAgentStore, type SessionAgentState } from "../stores/useAgentStore";
import { useAppShellStore } from "../stores/useAppShellStore";
import { agentSessionRepository, requestModelTitle } from "../lib/agentSessions";
import { system } from "../lib/ipc";

/**
 * Composition root for agent session persistence. The store stays a pure
 * in-memory model and the repository stays a dumb mirror, so the wiring that
 * needs both — project scoping, hydration, and requesting a better title —
 * lives here.
 */
export function useAgentSessionPersistence(): void {
  const projectDir = useAppShellStore((s) => s.projectDir);
  const projectDirLabel = useAppShellStore((s) => s.projectDirLabel);
  const hydrateSessions = useAgentStore((s) => s.hydrateSessions);
  const applyGeneratedTitle = useAgentStore((s) => s.applyGeneratedTitle);
  const setTitlePending = useAgentStore((s) => s.setTitlePending);
  const markTitleAttempted = useAgentStore((s) => s.markTitleAttempted);

  const titleRequested = useRef(new Set<string>());

  useEffect(() => {
    agentSessionRepository.start(
      (listener) => useAgentStore.subscribe(listener as never),
      () => useAgentStore.getState().sessions,
    );
    return () => agentSessionRepository.stop();
  }, []);

  useEffect(() => {
    // The sidecar resolves relative tool paths against this, so it must be told
    // which project is open — otherwise the agent writes into its own package
    // folder and the app cannot locate the result.
    if (!projectDir) return;
    system.agentSetWorkspace(projectDir).catch((error) => {
      console.warn("Failed to set agent workspace root:", error);
    });
  }, [projectDir]);

  useEffect(() => {
    return useAgentStore.subscribe((state) => {
      const projectId = agentSessionRepository.getProjectId();
      if (!projectId) return;

      for (const [id, session] of Object.entries(state.sessions)) {
        const needsName =
          session.isAgentViewSession &&
          session.titleSource === "placeholder" &&
          !session.titleAttempted &&
          !!session.originalGoal &&
          session.titlePending !== true;

        if (!needsName || titleRequested.current.has(id)) continue;
        titleRequested.current.add(id);
        markTitleAttempted(id);
        setTitlePending(id, true);

        void requestModelTitle(id, projectId, session.originalGoal, session.model)
          .then((title) => {
            if (title) applyGeneratedTitle(id, title);
          })
          .finally(() => setTitlePending(id, false));
      }
    });
  }, [applyGeneratedTitle, setTitlePending, markTitleAttempted]);

  useEffect(() => {
    let cancelled = false;

    if (!projectDir) {
      void agentSessionRepository.useProject("");
      return;
    }

    void (async () => {
      let stored;
      try {
        stored = await agentSessionRepository.useProject(projectDir, projectDirLabel);
        await agentSessionRepository.prune([useAgentStore.getState().activeAgentSessionId ?? ""]);
      } catch (error) {
        console.warn("Failed to load agent session history:", error);
        return;
      }
      if (cancelled) return;

      const restored: Record<string, SessionAgentState> = {};
      for (const item of stored) {
        const state = agentSessionRepository.rehydrate(item);
        if (state) restored[item.id] = state;
      }
      if (cancelled) return;

      hydrateSessions(restored);
      for (const [id, state] of Object.entries(restored)) {
        agentSessionRepository.markSynced(id, state);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectDir, projectDirLabel, hydrateSessions]);

  useEffect(() => {
    const onUnload = () => agentSessionRepository.flush();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      agentSessionRepository.flush();
    };
  }, []);
}
