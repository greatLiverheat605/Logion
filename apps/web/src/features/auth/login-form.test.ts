import type { components } from "@logion/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOnboardingAccess } from "@/features/onboarding/onboarding-access";
import { nextRoute } from "./login-form";

vi.mock("@/features/onboarding/onboarding-access", () => ({
  resolveOnboardingAccess: vi.fn(),
}));

const response: components["schemas"]["AuthResponse"] = {
  user: {
    id: "user-1",
    email: "user@example.com",
    status: "active",
    created_at: "2026-09-06T00:00:00Z",
    email_verified_at: "2026-09-06T00:00:00Z",
  },
  session_expires_at: "2026-09-07T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(resolveOnboardingAccess).mockReset().mockResolvedValue("complete");
});

describe("login next route", () => {
  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "%2f%2fevil.com",
    "javascript:alert(1)",
    "",
    "/%2fevil.com",
    "/%5cevil.com",
    "/%ZZ",
    "/\t/evil.com",
    "/%0a/evil.com",
    null,
  ])("rejects unsafe next %s", async (next) => {
    await expect(nextRoute(response, next)).resolves.toBe("/app/today");
  });

  it.each(["/app/data", "/app/today?tab=x"])(
    "accepts local next %s",
    async (next) => {
      await expect(nextRoute(response, next)).resolves.toBe(next);
    },
  );

  it("preserves the default route without next", async () => {
    await expect(nextRoute(response)).resolves.toBe("/app/today");
  });

  it("gives pending deletion priority over next and onboarding", async () => {
    await expect(
      nextRoute(
        { ...response, user: { ...response.user, status: "pending_deletion" } },
        "/app/data",
      ),
    ).resolves.toBe("/account/deletion");
    expect(resolveOnboardingAccess).not.toHaveBeenCalled();
  });

  it("does not bypass required onboarding", async () => {
    vi.mocked(resolveOnboardingAccess).mockResolvedValue("required");
    await expect(nextRoute(response, "/app/data")).resolves.toBe("/onboarding");
  });

  it("keeps settings failures available to the existing retry view", async () => {
    vi.mocked(resolveOnboardingAccess).mockRejectedValue(
      new Error("settings unavailable"),
    );
    await expect(nextRoute(response, "/app/data")).rejects.toThrow(
      "settings unavailable",
    );
  });
});
