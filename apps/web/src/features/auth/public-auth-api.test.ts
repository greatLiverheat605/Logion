import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@/lib/api/client";

import { createPublicAuthApi } from "./public-auth-api";

function client(response: unknown) {
  const request = vi.fn().mockResolvedValue(response);
  return { api: createPublicAuthApi({ request } as ApiClient), request };
}

describe("public authentication API", () => {
  it("validates uniform registration success", async () => {
    const { api } = client({ status: "ok" });
    await expect(
      api.startRegistration({ email: "a@example.com" }),
    ).resolves.toBeUndefined();
    const malformed = client({ status: "maybe" });
    await expect(
      malformed.api.startRegistration({ email: "a@example.com" }),
    ).rejects.toMatchObject({ code: "WEB_API_RESPONSE_INVALID" });
  });

  it("distinguishes authenticated and MFA outcomes", async () => {
    const user = {
      id: "u",
      email: "a@example.com",
      status: "active",
      created_at: "2026-01-01",
    };
    await expect(
      client({ user, session_expires_at: "2026-01-02" }).api.login({
        email: "a@example.com",
        password: "x",
        device_name: "web",
        platform: "web",
      }),
    ).resolves.toMatchObject({ kind: "authenticated" });
    await expect(
      client({
        status: "mfa_required",
        challenge_token: "secret",
        expires_at: "2026-01-02",
        methods: ["totp"],
      }).api.login({
        email: "a@example.com",
        password: "x",
        device_name: "web",
        platform: "web",
      }),
    ).resolves.toMatchObject({ kind: "mfa_required" });
  });

  it("fails closed for malformed successful responses", async () => {
    await expect(
      client({ user: {} }).api.login({
        email: "a@example.com",
        password: "x",
        device_name: "web",
        platform: "web",
      }),
    ).rejects.toMatchObject({ code: "WEB_API_RESPONSE_INVALID" });
  });

  it("uses CSRF for logout and expected recovery payloads", async () => {
    const { api, request } = client({ status: "ok" });
    await api.startPasswordRecovery({ email: "a@example.com" });
    await api.completePasswordRecovery({
      token: "a".repeat(32),
      new_password: "a".repeat(12),
    });
    await api.logout();
    expect(request.mock.calls[0]?.[0]).toBe(
      "/api/v1/auth/password-recovery/requests",
    );
    expect(request.mock.calls[1]?.[0]).toBe(
      "/api/v1/auth/password-recovery/completions",
    );
    expect(request.mock.calls[2]?.[1]).toMatchObject({
      csrf: true,
      method: "POST",
    });
  });
});
