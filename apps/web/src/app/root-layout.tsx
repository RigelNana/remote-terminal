import { Outlet } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { resolveTheme, usePreferences } from "@/stores/preferences";

export function RootLayout() {
  const preferences = usePreferences((state) => state.preferences);
  const { locale } = useI18n();
  const theme = resolveTheme(preferences.theme);
  return (
    <>
      <Outlet />
      <Toaster
        position="bottom-right"
        theme={theme === "light" ? "light" : "dark"}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-[var(--radius-panel)] !border !border-line2 !bg-panel3 !text-ink !shadow-[var(--shadow-pop)]",
            description: "!text-ink2",
          },
        }}
      />
      <span className="sr-only" lang={locale}>
        Remote Terminal
      </span>
    </>
  );
}

export function RootError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-dvh items-center justify-center bg-bg p-6">
      <div
        role="alert"
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-[var(--radius-dialog)] border border-bad/30 bg-bad/5 px-6 py-10 text-center"
      >
        <div className="flex size-10 items-center justify-center rounded-full border border-bad/30 bg-bad/10 text-bad">
          <AlertTriangle className="size-5" />
        </div>
        <p className="text-sm font-medium text-ink">{t("error.INTERNAL")}</p>
        <p className="readout max-w-full truncate text-xs text-ink3" title={error.message}>
          {error.message}
        </p>
        <Button variant="secondary" size="sm" onClick={reset} className="mt-1">
          {t("common.retry")}
        </Button>
      </div>
    </div>
  );
}
