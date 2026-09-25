// Per-tab workbench context. Only opaque IDs and a view name are kept; never
// note text, form input, search queries or anything else a user typed.
const KEY_PREFIX = "logion:workbench-context:";
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const viewPattern = /^[a-z][a-z0-9-]{0,39}$/u;

export type WorkbenchContextMode =
  | "collaboration"
  | "exam"
  | "planning"
  | "records"
  | "research"
  | "review"
  | "search"
  | "self-study"
  | "templates"
  | "today";

export interface WorkbenchContextSelection {
  selectedId: string;
  spaceId: string;
  view: string;
  workspaceId: string;
}

const emptySelection: WorkbenchContextSelection = {
  selectedId: "",
  spaceId: "",
  view: "",
  workspaceId: "",
};

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function sanitize(value: unknown): WorkbenchContextSelection {
  if (typeof value !== "object" || value === null) return { ...emptySelection };
  const record = value as Record<string, unknown>;
  const id = (key: string) =>
    typeof record[key] === "string" && idPattern.test(record[key])
      ? record[key]
      : "";
  return {
    selectedId: id("selectedId"),
    spaceId: id("spaceId"),
    view:
      typeof record.view === "string" && viewPattern.test(record.view)
        ? record.view
        : "",
    workspaceId: id("workspaceId"),
  };
}

export function readWorkbenchContext(
  mode: WorkbenchContextMode,
): WorkbenchContextSelection {
  try {
    const raw = sessionStore()?.getItem(`${KEY_PREFIX}${mode}`);
    return raw ? sanitize(JSON.parse(raw)) : { ...emptySelection };
  } catch {
    return { ...emptySelection };
  }
}

export function writeWorkbenchContext(
  mode: WorkbenchContextMode,
  patch: Partial<WorkbenchContextSelection>,
) {
  const next = sanitize({ ...readWorkbenchContext(mode), ...patch });
  try {
    sessionStore()?.setItem(`${KEY_PREFIX}${mode}`, JSON.stringify(next));
  } catch {
    // Storage may be unavailable; the workbench still works without restore.
  }
}

export function clearWorkbenchContexts() {
  const store = sessionStore();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
