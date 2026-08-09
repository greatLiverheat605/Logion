import type { components } from "@logion/contracts";

import { type ApiClient, LogionApiError } from "@/lib/api/client";

type AuthResponse = components["schemas"]["AuthResponse"];
export type SessionUser = components["schemas"]["UserResponse"];

const REFRESH_EARLY_MS = 60_000;

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | {
      status: "authenticated";
      sessionExpiresAt: string | null;
      user: SessionUser;
    }
  | {
      status: "error";
      error: { code: string; requestId: string; retryable: boolean };
    };

interface AuthApi {
  current(): Promise<AuthResponse>;
  refresh(): Promise<AuthResponse>;
}

export interface RefreshCoordinator {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export const immediateRefreshCoordinator: RefreshCoordinator = {
  run: (operation) => operation(),
};

export function createWebLockRefreshCoordinator(): RefreshCoordinator {
  return {
    run: async (operation) => {
      if (typeof navigator === "undefined" || navigator.locks === undefined) {
        return operation();
      }
      return navigator.locks.request("logion-session-refresh", operation);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionUser(value: unknown): value is SessionUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.status === "string" &&
    typeof value.created_at === "string" &&
    (value.email_verified_at === null ||
      typeof value.email_verified_at === "string")
  );
}

function isAuthResponse(value: unknown): value is AuthResponse {
  return (
    isRecord(value) &&
    typeof value.session_expires_at === "string" &&
    isSessionUser(value.user)
  );
}

function invalidSuccessResponse(): LogionApiError {
  return new LogionApiError({
    code: "WEB_API_RESPONSE_INVALID",
    message: "The server returned an invalid authentication response.",
    status: 200,
  });
}

export interface SessionCoordinator {
  bootstrap(): Promise<SessionState>;
  refresh(): Promise<SessionState>;
}

export function sessionRefreshDelay(
  sessionExpiresAt: string,
  nowMs = Date.now(),
): number | null {
  const expiresAtMs = Date.parse(sessionExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return Math.max(0, expiresAtMs - nowMs - REFRESH_EARLY_MS);
}

function isAnonymousError(error: unknown): boolean {
  return (
    error instanceof LogionApiError &&
    (error.status === 401 || error.code === "WEB_CSRF_MISSING")
  );
}

function errorState(error: unknown): SessionState {
  if (error instanceof LogionApiError) {
    return {
      status: "error",
      error: {
        code: error.code,
        requestId: error.requestId,
        retryable: error.retryable,
      },
    };
  }
  return {
    status: "error",
    error: {
      code: "WEB_SESSION_UNAVAILABLE",
      requestId: "unavailable",
      retryable: true,
    },
  };
}

function authenticated(response: AuthResponse): SessionState {
  return {
    status: "authenticated",
    sessionExpiresAt: response.session_expires_at,
    user: response.user,
  };
}

function sessionExpiryAdvanced(
  candidate: string,
  observed: string | null,
): boolean {
  if (observed === null) return true;
  const candidateMs = Date.parse(candidate);
  const observedMs = Date.parse(observed);
  return (
    Number.isFinite(candidateMs) &&
    Number.isFinite(observedMs) &&
    candidateMs > observedMs
  );
}

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    async current(): Promise<AuthResponse> {
      const response = await client.request<unknown>("/api/v1/auth/session");
      if (!isAuthResponse(response)) throw invalidSuccessResponse();
      return response;
    },
    async refresh(): Promise<AuthResponse> {
      const response = await client.request<unknown>("/api/v1/auth/refresh", {
        csrf: true,
        method: "POST",
      });
      if (!isAuthResponse(response)) throw invalidSuccessResponse();
      return response;
    },
  };
}

export function createSessionCoordinator(
  authApi: AuthApi,
  crossTab: RefreshCoordinator = immediateRefreshCoordinator,
): SessionCoordinator {
  let refreshInFlight: Promise<SessionState> | null = null;
  let observedSessionExpiresAt: string | null = null;

  const track = (state: SessionState): SessionState => {
    observedSessionExpiresAt =
      state.status === "authenticated" ? state.sessionExpiresAt : null;
    return state;
  };

  const refresh = (): Promise<SessionState> => {
    if (refreshInFlight !== null) return refreshInFlight;
    const expectedExpiresAt = observedSessionExpiresAt;
    const request: Promise<SessionState> = crossTab
      .run(async () => {
        try {
          const current = await authApi.current();
          if (
            sessionExpiryAdvanced(current.session_expires_at, expectedExpiresAt)
          ) {
            return authenticated(current);
          }
        } catch (error) {
          if (!isAnonymousError(error)) throw error;
        }
        return authenticated(await authApi.refresh());
      })
      .catch((error: unknown) =>
        isAnonymousError(error)
          ? ({ status: "anonymous" } satisfies SessionState)
          : errorState(error),
      )
      .then(track);
    const tracked = request.finally(() => {
      if (refreshInFlight === tracked) {
        refreshInFlight = null;
      }
    });
    refreshInFlight = tracked;
    return tracked;
  };

  return {
    async bootstrap(): Promise<SessionState> {
      try {
        return track(authenticated(await authApi.current()));
      } catch (error) {
        if (!isAnonymousError(error)) return errorState(error);
        return refresh();
      }
    },
    refresh,
  };
}
