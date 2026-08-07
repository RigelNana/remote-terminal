import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import { useCreateSession, useWaitForRunning } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";
import { zh as zhKeys } from "@/lib/i18n/zh";
import { usePreferences } from "@/stores/preferences";
import { useWorkspace } from "@/stores/workspace";

function errorKey(code: string): string {
  const key = `error.${code}` as keyof typeof zhKeys;
  return key in zhKeys ? key : "error.UNKNOWN";
}

function estimateSize(): { cols: number; rows: number; pixel_width: number; pixel_height: number } {
  const { fontSize, lineHeight } = usePreferences.getState().preferences;
  const cellW = Math.max(1, Math.round(fontSize * 0.6));
  const cellH = Math.max(1, Math.round(fontSize * lineHeight));
  const cols = Math.min(1000, Math.max(2, Math.floor(window.innerWidth / cellW)));
  const rows = Math.min(1000, Math.max(1, Math.floor(window.innerHeight / cellH)));
  return { cols, rows, pixel_width: 0, pixel_height: 0 };
}

/**
 * Create a session, wait for the PTY to be ready on the home machine, open a
 * terminal tab, and navigate to the workspace. Errors surface as typed toasts.
 */
export function useOpenSession() {
  const router = useRouter();
  const { t } = useI18n();
  const create = useCreateSession();
  const wait = useWaitForRunning();

  return useCallback(
    async (device: string, profile: string, cwd?: string): Promise<string> => {
      try {
        const session = await create.mutateAsync({
          device,
          profile,
          size: estimateSize(),
          ...(cwd && cwd.trim() ? { cwd: cwd.trim() } : {}),
        });
        const settled = await wait(session.id);
        if (settled.state !== "running") {
          toast.error(t("error.SESSION_LOST"));
          throw new Error(`session did not start: ${settled.state}`);
        }
        const tab = useWorkspace.getState().addTerminalTab(settled.id, profile);
        await router.navigate({ to: "/workspace" });
        return tab.id;
      } catch (error) {
        if (error instanceof ApiError) {
          toast.error(t(errorKey(error.code) as never));
        }
        throw error;
      }
    },
    [create, wait, router, t],
  );
}
