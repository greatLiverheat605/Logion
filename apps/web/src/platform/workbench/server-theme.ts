import { apiOrigin } from "@/lib/api/api-origin";
import { parsePreference, type Theme } from "./preferences";

// Request-scoped only: never cache an authenticated preference across accounts.
export async function readServerTheme(cookie: string | null): Promise<Theme> {
  if (!cookie) return "system";
  try {
    const response = await fetch(
      `${apiOrigin()}/api/v1/users/me/settings?key=appearance.theme`,
      {
        headers: { cookie },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return "system";
    const body = (await response.json()) as {
      settings?: { key: string; value: string }[];
    };
    const setting = body.settings?.find((s) => s.key === "appearance.theme");
    return setting
      ? parsePreference("appearance.theme", setting.value)
      : "system";
  } catch {
    // Authentication and connection recovery remain with the existing session gate.
    return "system";
  }
}
