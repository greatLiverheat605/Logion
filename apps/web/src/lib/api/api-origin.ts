export function apiOrigin(): string {
  const configured =
    process.env.LOGION_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
  const parsed = new URL(configured);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "LOGION_PUBLIC_API_URL must be an HTTP(S) origin without credentials or a path.",
    );
  }
  return parsed.origin;
}
