const destinations: Record<string, string> = {
  today: "/today",
  research: "/library",
  planning: "/plan",
  records: "/records",
  review: "/review",
  search: "/search",
  settings: "/settings",
  ai: "/settings/ai",
  security: "/settings/security",
  audit: "/settings/audit",
  data: "/settings/data",
  integrations: "/settings",
  workspaces: "/settings",
  spaces: "/settings/spaces",
};

export function legacyDestination(path: string): string {
  const name = /^\/app\/([^/]+)\/?$/.exec(path)?.[1];
  return (
    (name && Object.hasOwn(destinations, name) && destinations[name]) ||
    "/today"
  );
}

export function checkedDestination(value: string | null): string {
  return value && Object.values(destinations).includes(value)
    ? value
    : "/today";
}
