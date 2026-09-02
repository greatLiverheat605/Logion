import type { components } from "@logion/contracts";
import { describe, expect, it, vi } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import {
  createAuthApi,
  createSessionCoordinator,
  sessionRefreshDelay,
} from "./session";

type AuthResponse = components["schemas"]["AuthResponse"];
type UserResponse = components["schemas"]["UserResponse"];

const user: UserResponse = {
  created_at: "2026-07-20T00:00:00Z",
  email: "learner@example.com",
  email_verified_at: "2026-07-20T00:00:00Z",
  id: "01900000-0000-7000-8000-000000000001",
  status: "active",
};

const authResponse: AuthResponse = {
  session_expires_at: "2026-07-20T00:15:00Z",
  user,
};

function unauthorized(): LogionApiError {
  return new LogionApiError({
    code: "AUTH_INVALID_SESSION",
    message: "The session is no longer valid.",
    requestId: "request-unauthorized",
    status: 401,
  });
}

describe("session coordinator", () => {
  it("fails closed when a successful authentication response is malformed", async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValue({ status: "ok", token: "must-not-survive" }),
    };
    const authApi = createAuthApi(client);

    await expect(authApi.current()).rejects.toMatchObject({
      code: "WEB_API_RESPONSE_INVALID",
      status: 200,
    });
  });

  it("uses the current session expiry without rotating during bootstrap", async () => {
    const authApi = {
      current: vi.fn().mockResolvedValue(authResponse),
      refresh: vi.fn().mockResolvedValue(authResponse),
    };
    const coordinator = createSessionCoordinator(authApi);

    await expect(coordinator.bootstrap()).resolves.toEqual({
      status: "authenticated",
      sessionExpiresAt: authResponse.session_expires_at,
      user,
    });
    expect(authApi.current).toHaveBeenCalledTimes(1);
    expect(authApi.refresh).not.toHaveBeenCalled();
  });

  it("refreshes once after access expiry and returns the rotated session", async () => {
    const authApi = {
      current: vi.fn().mockRejectedValue(unauthorized()),
      refresh: vi.fn().mockResolvedValue(authResponse),
    };
    const coordinator = createSessionCoordinator(authApi);

    await expect(coordinator.bootstrap()).resolves.toEqual({
      status: "authenticated",
      sessionExpiresAt: authResponse.session_expires_at,
      user,
    });
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent refresh rotation", async () => {
    let resolveRefresh: ((value: AuthResponse) => void) | undefined;
    const pending = new Promise<AuthResponse>((resolve) => {
      resolveRefresh = resolve;
    });
    const authApi = {
      current: vi.fn().mockRejectedValue(unauthorized()),
      refresh: vi.fn().mockReturnValue(pending),
    };
    const coordinator = createSessionCoordinator(authApi);

    const first = coordinator.refresh();
    const second = coordinator.refresh();
    expect(first).toBe(second);
    await vi.waitFor(() => {
      expect(authApi.refresh).toHaveBeenCalledTimes(1);
    });
    resolveRefresh?.(authResponse);
    await expect(first).resolves.toMatchObject({ status: "authenticated" });
  });

  it("routes refresh rotation through the cross-tab coordinator", async () => {
    const authApi = {
      current: vi.fn().mockRejectedValue(unauthorized()),
      refresh: vi.fn().mockResolvedValue(authResponse),
    };
    const run = vi.fn();
    const crossTab = {
      async run<T>(operation: () => Promise<T>): Promise<T> {
        run();
        return operation();
      },
    };
    const coordinator = createSessionCoordinator(authApi, crossTab);

    await expect(coordinator.refresh()).resolves.toMatchObject({
      status: "authenticated",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });

  it("lets only one coordinator rotate an expiring shared session", async () => {
    const nextAuthResponse: AuthResponse = {
      ...authResponse,
      session_expires_at: "2026-07-20T00:30:00Z",
    };
    let activeSession = authResponse;
    let lockTail: Promise<void> = Promise.resolve();
    const crossTab = {
      run<T>(operation: () => Promise<T>): Promise<T> {
        const result = lockTail.then(operation);
        lockTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    const authApi = {
      current: vi.fn().mockImplementation(async () => activeSession),
      refresh: vi.fn().mockImplementation(async () => {
        activeSession = nextAuthResponse;
        return activeSession;
      }),
    };
    const firstCoordinator = createSessionCoordinator(authApi, crossTab);
    const secondCoordinator = createSessionCoordinator(authApi, crossTab);

    await Promise.all([
      firstCoordinator.bootstrap(),
      secondCoordinator.bootstrap(),
    ]);
    const [first, second] = await Promise.all([
      firstCoordinator.refresh(),
      secondCoordinator.refresh(),
    ]);

    expect(first).toMatchObject({
      sessionExpiresAt: nextAuthResponse.session_expires_at,
      status: "authenticated",
    });
    expect(second).toMatchObject({
      sessionExpiresAt: nextAuthResponse.session_expires_at,
      status: "authenticated",
    });
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });

  it("treats rejected refresh credentials as anonymous", async () => {
    const authApi = {
      current: vi.fn().mockRejectedValue(unauthorized()),
      refresh: vi.fn().mockRejectedValue(unauthorized()),
    };
    const coordinator = createSessionCoordinator(authApi);

    await expect(coordinator.bootstrap()).resolves.toEqual({
      status: "anonymous",
    });
  });

  it("redacts unexpected failures into a minimal public error state", async () => {
    const authApi = {
      current: vi
        .fn()
        .mockRejectedValue(new Error("database credentials leaked")),
      refresh: vi.fn(),
    };
    const coordinator = createSessionCoordinator(authApi);

    const state = await coordinator.bootstrap();
    expect(state).toEqual({
      status: "error",
      error: {
        code: "WEB_SESSION_UNAVAILABLE",
        requestId: "unavailable",
        retryable: true,
      },
    });
    expect(JSON.stringify(state)).not.toContain("database credentials leaked");
  });

  it("schedules refresh one minute before access expiry", () => {
    expect(
      sessionRefreshDelay(
        "2026-07-20T00:15:00Z",
        Date.parse("2026-07-20T00:10:00Z"),
      ),
    ).toBe(240_000);
    expect(
      sessionRefreshDelay(
        "2026-07-20T00:15:00Z",
        Date.parse("2026-07-20T00:14:30Z"),
      ),
    ).toBe(0);
    expect(sessionRefreshDelay("not-a-date", 0)).toBeNull();
  });
});
