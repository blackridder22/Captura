import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/api";

export type UpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "upToDate" }
  | { phase: "available"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; message: string };

type UpdaterDeps = {
  notify: (text: string, tone?: "info" | "error") => void;
};

export function useUpdater({ notify }: UpdaterDeps) {
  const [status, setStatus] = useState<UpdateStatus>({ phase: "idle" });
  const checkedOnLaunchRef = useRef(false);

  const checkForUpdates = useCallback(
    async (silent: boolean) => {
      if (!isTauriRuntime()) {
        if (!silent) setStatus({ phase: "upToDate" });
        return;
      }
      setStatus({ phase: "checking" });
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update) {
          setStatus({ phase: "available", version: update.version });
          if (silent) {
            notify(`Captura ${update.version} is available — see Settings`);
          }
        } else {
          setStatus({ phase: "upToDate" });
        }
      } catch (error) {
        const message =
          typeof error === "string" ? error : "Could not check for updates.";
        setStatus({ phase: "error", message });
        if (!silent) {
          notify(message, "error");
        }
      }
    },
    [notify],
  );

  const installUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setStatus({ phase: "upToDate" });
        return;
      }
      setStatus({ phase: "installing", version: update.version });
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      const message =
        typeof error === "string" ? error : "Could not install the update.";
      setStatus({ phase: "error", message });
      notify(message, "error");
    }
  }, [notify]);

  // One silent check shortly after launch; failures stay quiet (offline,
  // rate limits) — the user can always check manually from Settings.
  useEffect(() => {
    if (checkedOnLaunchRef.current || !isTauriRuntime()) return;
    checkedOnLaunchRef.current = true;
    const timer = window.setTimeout(() => {
      void checkForUpdates(true);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  return { status, checkForUpdates, installUpdate };
}
