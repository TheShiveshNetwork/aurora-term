import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useGitStore } from "../stores/useGitStore";
import { system } from "../lib/ipc";

interface GitChangedEvent {
  cwd: string;
  type: "index" | "refs" | "remote";
}

export function useGitWatcher(cwd: string | null) {
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  useEffect(() => {
    if (!cwd) return;

    let unlisten: (() => void) | undefined;

    invoke<void>("watch_git", { cwd }).catch(() => {
      // not a git repo or watcher failed — ignore
    });

    getCurrentWindow()
      .listen<GitChangedEvent>("git-changed", (event) => {
        if (event.payload.cwd !== cwdRef.current) return;

        const type = event.payload.type;
        if (type === "index") {
          useGitStore.getState().invalidateStatus(cwdRef.current!);
          system
            .gitStatus(cwdRef.current!)
            .then((data) => useGitStore.getState().setStatus(cwdRef.current!, data))
            .catch(() => {});
        } else if (type === "refs") {
          useGitStore.getState().invalidateBranches(cwdRef.current!);
          system
            .gitBranchList(cwdRef.current!)
            .then((data) => useGitStore.getState().setBranches(cwdRef.current!, data))
            .catch(() => {});
          useGitStore.getState().invalidateStatus(cwdRef.current!);
          system
            .gitStatus(cwdRef.current!)
            .then((data) => useGitStore.getState().setStatus(cwdRef.current!, data))
            .catch(() => {});
        } else if (type === "remote") {
          useGitStore.getState().invalidateAll(cwdRef.current!);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [cwd]);
}
