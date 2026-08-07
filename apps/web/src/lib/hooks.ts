import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { api } from "./api";
import type { CreateSession, Device, Me, Review, Session, Started } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/v1/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => api.get<Device[]>("/v1/devices"),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/v1/sessions"),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ["sessions", id],
    queryFn: () => api.get<Session>(`/v1/sessions/${id}`),
    enabled: id.length > 0,
    retry: false,
  });
}

function useInvalidate(keys: string[][]) {
  const client = useQueryClient();
  return useCallback(() => {
    for (const key of keys) void client.invalidateQueries({ queryKey: key });
  }, [client, keys]);
}

export function useRenameDevice() {
  const invalidate = useInvalidate([["devices"]]);
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/v1/devices/${id}`, { name }),
    onSuccess: invalidate,
  });
}

export function useRevokeDevice() {
  const invalidate = useInvalidate([["devices"]]);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/v1/devices/${id}`),
    onSuccess: invalidate,
  });
}

export function useStopSession() {
  const invalidate = useInvalidate([["sessions"]]);
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      api.post(`/v1/sessions/${id}/stop`, { force }),
    onSuccess: invalidate,
  });
}

export function useCreateSession() {
  const invalidate = useInvalidate([["sessions"]]);
  return useMutation({
    mutationFn: (request: CreateSession) =>
      api.post<Session>("/v1/sessions", request, {
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: invalidate,
  });
}

/** Poll until the session reaches `running`, then issue an attach grant. */
export function useWaitForRunning() {
  return useCallback(async (id: string, timeoutMs = 15_000): Promise<Session> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Polling depends on the prior state and delay; parallel requests would amplify load.
      // oxlint-disable-next-line no-await-in-loop
      const session = await api.get<Session>(`/v1/sessions/${id}`);
      if (session.state === "running") return session;
      if (session.state === "exited" || session.state === "lost") return session;
      if (Date.now() > deadline) return session;
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, []);
}

export function usePairReview() {
  return useMutation({
    mutationFn: (userCode: string) => api.post<Review>("/v1/pair/review", { user_code: userCode }),
  });
}

export function usePairAuthorize() {
  const invalidate = useInvalidate([["devices"]]);
  return useMutation({
    mutationFn: (userCode: string) =>
      api.post<Review>("/v1/pair/authorize", { user_code: userCode }),
    onSuccess: invalidate,
  });
}

export function useStartPairing() {
  return useMutation({
    mutationFn: (request: {
      name: string;
      platform: string;
      version: string;
      fingerprint: string;
    }) => api.post<Started>("/v1/pair/device", request),
  });
}

export function useLogout() {
  const invalidate = useInvalidate([["me"]]);
  return useMutation({
    mutationFn: () => api.post("/v1/auth/logout"),
    onSuccess: invalidate,
  });
}
