import type { components } from "@logion/contracts";

import { type ApiClient, LogionApiError } from "@/lib/api/client";

type AuthResponse = components["schemas"]["AuthResponse"];
export type SessionUser = components["schemas"]["UserResponse"];

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
  me(): Promise<SessionUser>;
  refresh(): Promise<AuthResponse>;
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

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    async me(): Promise<SessionUser> {
      const response = await client.request<unknown>("/api/v1/auth/me");
      if (!isSessionUser(response)) throw invalidSuccessResponse();
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

export function createSessionCoordinator(authApi: AuthApi): SessionCoordinator {
  let refreshInFlight: Promise<SessionState> | null = null;

  const refresh = (): Promise<SessionState> => {
    if (refreshInFlight !== null) return refreshInFlight;
    const request: Promise<SessionState> = authApi
      .refresh()
      .then(authenticated)
      .catch((error: unknown) =>
        isAnonymousError(error)
          ? ({ status: "anonymous" } satisfies SessionState)
          : errorState(error),
      );
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
        const user = await authApi.me();
        return { status: "authenticated", sessionExpiresAt: null, user };
      } catch (error) {
        if (!isAnonymousError(error)) return errorState(error);
        return refresh();
      }
    },
    refresh,
  };
}
