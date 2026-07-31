import { describe, expect, it, vi } from "vitest";

import {
  loadOnboardingSettingWithRetry,
  resolveOnboardingAccess,
  type OnboardingSettingReader,
} from "../onboarding-access";

function reader(
  implementation: OnboardingSettingReader["get"],
): OnboardingSettingReader {
  return { get: vi.fn(implementation) };
}

describe("onboarding access", () => {
  it("retries one failed setting read", async () => {
    const service = reader(
      vi
        .fn<OnboardingSettingReader["get"]>()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce({ value: "true" }),
    );

    await expect(loadOnboardingSettingWithRetry(service)).resolves.toEqual({
      value: "true",
    });
    expect(service.get).toHaveBeenCalledTimes(2);
    expect(service.get).toHaveBeenNthCalledWith(1, "onboarding_completed");
    expect(service.get).toHaveBeenNthCalledWith(2, "onboarding_completed");
  });

  it("fails closed after the retry also fails", async () => {
    const service = reader(() => Promise.reject(new Error("unavailable")));

    await expect(loadOnboardingSettingWithRetry(service)).rejects.toThrow(
      "unavailable",
    );
    expect(service.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ value: "true" }, "complete"],
    [{ value: "false" }, "required"],
    [null, "required"],
  ] as const)("maps %j to %s", async (setting, expected) => {
    const service = reader(() => Promise.resolve(setting));
    await expect(resolveOnboardingAccess(service)).resolves.toBe(expected);
  });
});
