import type { ApiErrorBody } from "./errors";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly detail: string;

  constructor(status: number, code: string, retryable: boolean, detail: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const CSRF_COOKIE = "rt_csrf";

function csrfToken(): string | null {
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: Method;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}
type RequestSettings = Pick<RequestOptions, "headers" | "signal">;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  let body: BodyInit | null = null;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body) ?? null;
  }
  // Double-submit CSRF: state-changing requests echo the rt_csrf cookie.
  if (method !== "GET") {
    const token = csrfToken();
    if (token) headers["x-csrf-token"] = token;
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: "include",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw new ApiError(0, "NETWORK", true, error instanceof Error ? error.message : "");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const errorBody = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      errorBody.code ?? "INTERNAL",
      errorBody.retryable ?? false,
      errorBody.detail ?? "",
    );
  }
  return payload as T;
}

export const api = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>(path, signal ? { signal } : {});
  },
  post<T>(path: string, body?: unknown, settings: RequestSettings = {}): Promise<T> {
    return request<T>(path, {
      method: "POST",
      ...settings,
      ...(body !== undefined ? { body } : {}),
    });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};
