import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useGitStore } from "../stores/useGitStore";
import { system } from "../lib/ipc";

interface GitChangedEvent {
  cwd: string;
  type: "index" | "refs" | "remote";
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, ms);
  };
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

    const handleIndexChange = debounce((dir: string) => {
      useGitStore.getState().invalidateStatus(dir);
      system
        .gitStatus(dir)
        .then((data) => useGitStore.getState().setStatus(dir, data))
        .catch(() => {});
    }, 300);

    const handleRefsChange = debounce((dir: string) => {
      useGitStore.getState().invalidateBranches(dir);
      system
        .gitBranchList(dir)
        .then((data) => useGitStore.getState().setBranches(dir, data))
        .catch(() => {});
      useGitStore.getState().invalidateStatus(dir);
      system
        .gitStatus(dir)
        .then((data) => useGitStore.getState().setStatus(dir, data))
        .catch(() => {});
    }, 300);

    const handleRemoteChange = debounce((dir: string) => {
      useGitStore.getState().invalidateAll(dir);
    }, 300);

    getCurrentWindow()
      .listen<GitChangedEvent>("git-changed", (event) => {
        if (event.payload.cwd !== cwdRef.current) return;
        const dir = cwdRef.current!;
        const type = event.payload.type;
        if (type === "index") handleIndexChange(dir);
        else if (type === "refs") handleRefsChange(dir);
        else if (type === "remote") handleRemoteChange(dir);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      if (unlisten) unlisten();
      invoke<void>("unwatch_git", { cwd }).catch(() => {});
    };
  }, [cwd]);
}
