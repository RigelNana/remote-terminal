import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { AuditPage } from "@/features/audit/audit-page";
import { DevicesPage } from "@/features/devices/devices-page";
import { PairPage } from "@/features/pair/pair-page";
import { SessionsPage } from "@/features/sessions/sessions-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { LoginPage } from "@/features/auth/login-page";
import { OnboardPage } from "@/features/auth/onboard-page";
import { RecoverPage } from "@/features/auth/recover-page";
import { Shell } from "./shell";
import { RootLayout } from "./root-layout";

export interface RouterContext {
  queryClient: QueryClient;
}

async function requireAuth({ context }: { context: RouterContext }) {
  try {
    await context.queryClient.ensureQueryData({
      queryKey: ["me"],
      queryFn: () => api.get<Me>("/v1/auth/me"),
      retry: false,
      staleTime: 60_000,
    });
  } catch {
    throw redirect({ to: "/login", search: {} });
  }
}

async function skipAuth({ context }: { context: RouterContext }) {
  try {
    await context.queryClient.ensureQueryData({
      queryKey: ["me"],
      queryFn: () => api.get<Me>("/v1/auth/me"),
      retry: false,
    });
  } catch {
    return;
  }
  throw redirect({ to: "/devices" });
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
  beforeLoad: skipAuth,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
});

const onboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboard",
  component: OnboardPage,
  beforeLoad: skipAuth,
  validateSearch: (search: Record<string, unknown>): { bootstrap?: string } =>
    typeof search.bootstrap === "string" ? { bootstrap: search.bootstrap } : {},
});

const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover",
  component: RecoverPage,
  beforeLoad: skipAuth,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Shell,
  beforeLoad: requireAuth,
});

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: DevicesPage,
});

const devicesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/devices",
  component: DevicesPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/sessions",
  component: SessionsPage,
  validateSearch: (search: Record<string, unknown>): { create?: 1 } =>
    search.create === 1 || search.create === "1" ? { create: 1 } : {},
});

const pairRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/pair",
  component: PairPage,
  validateSearch: (search: Record<string, unknown>): { user_code?: string } =>
    typeof search.user_code === "string" && search.user_code.length > 0
      ? { user_code: search.user_code }
      : {},
});

const auditRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/audit",
  component: AuditPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: SettingsPage,
});

function WorkspaceSlot() {
  return null;
}

const workspaceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/workspace",
  component: WorkspaceSlot,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardRoute,
  recoverRoute,
  shellRoute.addChildren([
    indexRoute,
    devicesRoute,
    sessionsRoute,
    pairRoute,
    auditRoute,
    settingsRoute,
    workspaceRoute,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: false,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
