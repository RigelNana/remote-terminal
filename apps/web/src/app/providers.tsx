import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { I18nProvider } from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resolveTheme, usePreferences } from "@/stores/preferences";
import { createAppRouter } from "./router";

export function AppProviders() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 5_000,
          },
        },
      }),
    [],
  );
  const router = useMemo(() => createAppRouter(queryClient), [queryClient]);

  const preferences = usePreferences((state) => state.preferences);
  const setPreferences = usePreferences((state) => state.set);

  // Theme application, including live system-preference switching.
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(preferences.theme);
    };
    apply();
    if (preferences.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  useEffect(() => {
    document.documentElement.lang = preferences.locale;
    document.title = "Remote Terminal";
  }, [preferences.locale]);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider
        locale={preferences.locale}
        onLocaleChange={(locale) => setPreferences({ locale })}
      >
        <TooltipProvider delayDuration={400}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
