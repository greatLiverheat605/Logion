import { userSettingService } from "@/features/settings/user-setting-service";

const ONBOARDING_KEY = "onboarding_completed";

interface OnboardingSetting {
  value: string;
}

export interface OnboardingSettingReader {
  get: (key: string) => Promise<OnboardingSetting | null>;
  set: (key: string, value: string) => Promise<OnboardingSetting>;
}

export type OnboardingAccess = "complete" | "required";

export async function loadOnboardingSettingWithRetry(
  service: OnboardingSettingReader = userSettingService,
): Promise<OnboardingSetting | null> {
  try {
    return await service.get(ONBOARDING_KEY);
  } catch {
    return service.get(ONBOARDING_KEY);
  }
}

export async function resolveOnboardingAccess(
  service: OnboardingSettingReader = userSettingService,
): Promise<OnboardingAccess> {
  const setting = await loadOnboardingSettingWithRetry(service);
  if (setting === null) {
    await service.set(ONBOARDING_KEY, "true");
    return "complete";
  }
  return setting.value === "true" ? "complete" : "required";
}
