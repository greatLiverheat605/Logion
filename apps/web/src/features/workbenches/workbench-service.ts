import type { components } from "@logion/contracts";
import { canonicalize } from "json-canonicalize";

import {
  browserApiClient,
  type ApiClient,
  LogionApiError,
} from "@/lib/api/client";

export type WorkbenchDefinition =
  components["schemas"]["WorkbenchDefinitionResponse"];
export type WorkbenchSummary =
  components["schemas"]["WorkbenchDefinitionSummary"];
export type WorkbenchDocument =
  components["schemas"]["WorkbenchDefinitionDocumentV1"];
export type WorkbenchExport = components["schemas"]["WorkbenchExportV1"];
export type WorkbenchPreference =
  components["schemas"]["WorkbenchPreferenceDocumentV1"];
export type WorkbenchPreferencePayload =
  components["schemas"]["WorkbenchPreferencePayloadV1"];
export type WorkbenchDefinitionConflictDetails =
  components["schemas"]["WorkbenchDefinitionConflictDetails"];

type WorkbenchDefinitionPage =
  components["schemas"]["WorkbenchDefinitionPageResponse"];
export type WorkbenchDeletionImpact =
  components["schemas"]["WorkbenchDefinitionDeletionImpact"];
type WorkbenchDeleteReceipt =
  components["schemas"]["WorkbenchDefinitionDeleteReceipt"];
type WorkbenchImportReceipt =
  components["schemas"]["WorkbenchImportSucceededReceipt"];
type UserSettingListResponse = components["schemas"]["UserSettingListResponse"];

const PREFERENCE_KEY = "workbench.preference";
const FIXED_WORKBENCHES = new Set([
  "fixed.learning",
  "fixed.research",
  "fixed.exam",
  "fixed.mentor",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const WORKBENCH_DEFINITION_MAX_BYTES = 32 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNoUnknownKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function isWorkbenchRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (FIXED_WORKBENCHES.has(value) || UUID.test(value))
  );
}

function isUniqueStrings(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length
  );
}

function isWorkbenchMap(
  value: unknown,
  validateValue: (entry: unknown) => boolean,
): boolean {
  if (!isRecord(value) || Object.keys(value).length > 24) return false;
  return Object.entries(value).every(
    ([key, entry]) => isWorkbenchRef(key) && validateValue(entry),
  );
}

export function parseWorkbenchPreference(
  value: string,
  outerRevision: number,
): WorkbenchPreference {
  if (new TextEncoder().encode(value).byteLength > 4096) {
    throw new Error("The Workbench preference exceeds 4096 UTF-8 bytes.");
  }
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, [
      "contract",
      "schemaVersion",
      "revision",
      "payload",
    ]) ||
    parsed.contract !== PREFERENCE_KEY ||
    parsed.schemaVersion !== 1 ||
    parsed.revision !== outerRevision ||
    !Number.isSafeInteger(parsed.revision) ||
    !isRecord(parsed.payload)
  ) {
    throw new Error("The stored Workbench preference is invalid.");
  }

  const payload = parsed.payload;
  const hidden = payload.hiddenFixedWorkbenchIds;
  const order = payload.workbenchOrder;
  const valid =
    hasOnlyKeys(payload, [
      "activeWorkbenchId",
      "hiddenFixedWorkbenchIds",
      "workbenchOrder",
      "density",
      "defaultViewByWorkbench",
      "defaultSpaceByWorkbench",
    ]) &&
    isWorkbenchRef(payload.activeWorkbenchId) &&
    isUniqueStrings(hidden, 3) &&
    hidden.every(
      (item) => FIXED_WORKBENCHES.has(item) && item !== "fixed.learning",
    ) &&
    isUniqueStrings(order, 24) &&
    order.every(isWorkbenchRef) &&
    order.includes("fixed.learning") &&
    (payload.density === "compact" || payload.density === "comfortable") &&
    isWorkbenchMap(
      payload.defaultViewByWorkbench,
      (entry) => typeof entry === "string" && STABLE_ID.test(entry),
    ) &&
    isWorkbenchMap(payload.defaultSpaceByWorkbench, (entry) => {
      return (
        isRecord(entry) &&
        hasOnlyKeys(entry, ["workspaceId", "spaceId"]) &&
        UUID.test(String(entry.workspaceId)) &&
        UUID.test(String(entry.spaceId))
      );
    });
  if (!valid) throw new Error("The stored Workbench preference is invalid.");
  return parsed as unknown as WorkbenchPreference;
}

function definitionConflict(
  details: unknown,
): details is WorkbenchDefinitionConflictDetails {
  return (
    isRecord(details) &&
    details.entity === "definition" &&
    Number.isSafeInteger(details.baseRevision) &&
    Number.isSafeInteger(details.remoteRevision) &&
    Array.isArray(details.conflictPaths) &&
    isRecord(details.base) &&
    isRecord(details.local) &&
    isRecord(details.remote)
  );
}

export class WorkbenchConflictError extends Error {
  constructor(readonly details: WorkbenchDefinitionConflictDetails) {
    super("The Workbench changed on another device.");
    this.name = "WorkbenchConflictError";
  }
}

export class WorkbenchPreferenceInvalidError extends Error {
  constructor(readonly source: string) {
    super("The stored Workbench preference is invalid.");
    this.name = "WorkbenchPreferenceInvalidError";
  }
}

export interface WorkbenchState {
  definitions: WorkbenchSummary[];
  preference: WorkbenchPreference | null;
}

function idempotencyHeaders(key = crypto.randomUUID()): HeadersInit {
  return { "Idempotency-Key": key };
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalize(left) === canonicalize(right);
}

function isWithinWorkbenchDefinitionCapacity(
  document: WorkbenchDocument,
): boolean {
  try {
    const canonical = canonicalize({
      ...document,
      payload: {
        ...document.payload,
        modules: document.payload.modules.map((module) => ({
          ...module,
          ...(module.title === undefined ? { title: null } : {}),
          ...(module.filterIds === undefined ? { filterIds: [] } : {}),
          ...(module.quickCreateIds === undefined
            ? { quickCreateIds: [] }
            : {}),
        })),
        fieldDefinitions: document.payload.fieldDefinitions.map((field) => ({
          ...field,
          ...(field.required === undefined ? { required: false } : {}),
        })),
      },
    });
    return (
      new TextEncoder().encode(canonical).byteLength <=
      WORKBENCH_DEFINITION_MAX_BYTES
    );
  } catch {
    return false;
  }
}

function stableRecordKey(item: Record<string, unknown>): string | null {
  if (typeof item.id === "string") return `id:${item.id}`;
  if (typeof item.moduleId === "string") return `moduleId:${item.moduleId}`;
  return null;
}

function isKeyedRecordArray(
  value: unknown,
): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) return false;
  const keys = value.map(stableRecordKey);
  return (
    keys.every((key) => key !== null) && new Set(keys).size === keys.length
  );
}

function mergeStableEntity(
  base: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
  remote: Record<string, unknown> | undefined,
  prefer: "local" | "remote",
): unknown {
  return mergeValue(base, local, remote, prefer);
}

function capStableRecords<T>(
  merged: T[],
  preferred: T[],
  maximum: number,
): T[] {
  if (merged.length <= maximum) return merged;
  const key = (item: T) => stableRecordKey(item as Record<string, unknown>);
  const byKey = new Map(merged.map((item) => [key(item), item]));
  const keys = [...preferred.map(key), ...merged.map(key)].filter(
    (item, index, values) => item !== null && values.indexOf(item) === index,
  );
  return keys.slice(0, maximum).flatMap((item) => {
    const value = byKey.get(item);
    return value === undefined ? [] : [value];
  });
}

function keyedOrder(
  base: Record<string, unknown>[],
  local: Record<string, unknown>[],
  remote: Record<string, unknown>[],
  prefer: "local" | "remote",
): string[] {
  const keys = (items: Record<string, unknown>[]) =>
    items.map((item) => stableRecordKey(item)!);
  const baseKeys = keys(base);
  const localKeys = keys(local);
  const remoteKeys = keys(remote);
  if (equalJson(localKeys, baseKeys)) return remoteKeys;
  if (equalJson(remoteKeys, baseKeys) || equalJson(localKeys, remoteKeys)) {
    return localKeys;
  }
  return prefer === "local" ? localKeys : remoteKeys;
}

function mergeValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  prefer: "local" | "remote",
): unknown {
  if (equalJson(local, base)) return remote;
  if (equalJson(remote, base) || equalJson(local, remote)) return local;
  if (isRecord(local) && isRecord(remote)) {
    const baseRecord = isRecord(base) ? base : {};
    const merged: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    for (const key of keys) {
      const value = mergeValue(
        baseRecord[key],
        local[key],
        remote[key],
        prefer,
      );
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  if (
    isKeyedRecordArray(base) &&
    isKeyedRecordArray(local) &&
    isKeyedRecordArray(remote)
  ) {
    const byId = (items: Record<string, unknown>[]) =>
      new Map(items.map((item) => [stableRecordKey(item)!, item]));
    const baseById = byId(base);
    const localById = byId(local);
    const remoteById = byId(remote);
    const ids = [
      ...keyedOrder(base, local, remote, prefer),
      ...local.map((item) => stableRecordKey(item)!),
      ...remote.map((item) => stableRecordKey(item)!),
    ].filter((id, index, values) => values.indexOf(id) === index);
    return ids.flatMap((id) => {
      const value = mergeStableEntity(
        baseById.get(id),
        localById.get(id),
        remoteById.get(id),
        prefer,
      );
      return value === undefined ? [] : [value];
    });
  }
  return prefer === "local" ? local : remote;
}

function reconcileWorkbenchDocument(
  merged: WorkbenchDocument,
  base: WorkbenchDocument,
  local: WorkbenchDocument,
  remote: WorkbenchDocument,
  prefer: "local" | "remote",
): WorkbenchDocument {
  const candidates =
    prefer === "local" ? [local, remote, base] : [remote, local, base];
  const modules = merged.payload.modules;
  const moduleIds = new Set(modules.map((module) => module.id));
  const layoutByModule = new Map(
    merged.payload.layout.items.map((item) => [item.moduleId, item]),
  );
  for (const document of candidates) {
    for (const item of document.payload.layout.items) {
      if (moduleIds.has(item.moduleId) && !layoutByModule.has(item.moduleId)) {
        layoutByModule.set(item.moduleId, item);
      }
    }
  }
  const occupied = new Set<string>();
  const layoutItems = modules.map((module) => {
    const source = layoutByModule.get(module.id) ?? {
      moduleId: module.id,
      order: 0,
      region: "main" as const,
      span: 1,
    };
    let order = source.order;
    if (occupied.has(`${source.region}:${order}`)) {
      order = Array.from({ length: 64 }, (_, candidate) => candidate).find(
        (candidate) => !occupied.has(`${source.region}:${candidate}`),
      )!;
    }
    occupied.add(`${source.region}:${order}`);
    return {
      ...source,
      order,
      span: Math.min(source.span, merged.payload.layout.columns),
    };
  });

  const filters = [...merged.payload.filters];
  const filtersById = new Map(filters.map((item) => [item.id, item]));
  const quickCreate = [...merged.payload.quickCreate];
  const quickCreateById = new Map(quickCreate.map((item) => [item.id, item]));
  const fieldDefinitions = [...merged.payload.fieldDefinitions];
  const fieldsById = new Map(fieldDefinitions.map((item) => [item.id, item]));
  for (const workbenchModule of modules) {
    for (const id of workbenchModule.filterIds ?? []) {
      if (filtersById.has(id)) continue;
      const found = candidates
        .flatMap((document) => document.payload.filters)
        .find((item) => item.id === id);
      if (found) {
        filters.push(found);
        filtersById.set(id, found);
      }
    }
    for (const id of workbenchModule.quickCreateIds ?? []) {
      if (quickCreateById.has(id)) continue;
      const found = candidates
        .flatMap((document) => document.payload.quickCreate)
        .find((item) => item.id === id);
      if (found) {
        quickCreate.push(found);
        quickCreateById.set(id, found);
      }
    }
  }
  for (const filter of filters) {
    if (filter.kind !== "attribute-equals" || fieldsById.has(filter.fieldId)) {
      continue;
    }
    const found = candidates
      .flatMap((document) => document.payload.fieldDefinitions)
      .find((item) => item.id === filter.fieldId);
    if (found) {
      fieldDefinitions.push(found);
      fieldsById.set(found.id, found);
    }
  }

  return {
    ...merged,
    payload: {
      ...merged.payload,
      fieldDefinitions,
      filters,
      layout: { ...merged.payload.layout, items: layoutItems },
      quickCreate,
    },
  };
}

const MODULE_KINDS = new Set([
  "next-action",
  "task-queue",
  "projects",
  "sources",
  "topics",
  "review",
  "evidence",
  "timeline",
  "graph-projection",
  "saved-view",
  "recent-objects",
  "pinned-objects",
]);
const TARGET_KINDS = new Set([
  "task",
  "source",
  "topic",
  "note",
  "evidence",
  "claim",
  "project",
]);
const TASK_STATUSES = new Set([
  "backlog",
  "planned",
  "in_progress",
  "submitted",
  "verified",
  "done",
  "blocked",
  "cancelled",
]);
const FIELD_ID = /^[a-z][a-z0-9_]{0,47}$/;
const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function isUniqueIds(
  items: unknown,
  maximum: number,
): items is Record<string, unknown>[] {
  return (
    Array.isArray(items) &&
    items.length <= maximum &&
    items.every((item) => isRecord(item) && isStableId(item.id)) &&
    new Set(items.map((item) => item.id)).size === items.length
  );
}

function isValidFieldDefinition(
  value: unknown,
): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.label !== "string" ||
    typeof value.required !== "boolean" ||
    typeof value.id !== "string" ||
    !FIELD_ID.test(value.id) ||
    typeof value.type !== "string"
  ) {
    return false;
  }
  if (value.type === "text") {
    if (
      !hasNoUnknownKeys(value, ["id", "label", "required", "type", "maxLength"])
    ) {
      return false;
    }
    const maxLength = value.maxLength;
    return (
      typeof maxLength === "number" &&
      Number.isInteger(maxLength) &&
      maxLength >= 1 &&
      maxLength <= 2000
    );
  }
  if (value.type === "number") {
    if (
      !hasNoUnknownKeys(value, [
        "id",
        "label",
        "required",
        "type",
        "minimum",
        "maximum",
      ])
    ) {
      return false;
    }
    const minimum = value.minimum;
    const maximum = value.maximum;
    return (
      typeof minimum === "number" &&
      typeof maximum === "number" &&
      Number.isFinite(minimum) &&
      Number.isFinite(maximum) &&
      minimum <= maximum
    );
  }
  if (
    value.type === "date" ||
    value.type === "boolean" ||
    value.type === "url"
  ) {
    if (!hasNoUnknownKeys(value, ["id", "label", "required", "type"])) {
      return false;
    }
    return true;
  }
  if (value.type === "rating") {
    if (
      !hasNoUnknownKeys(value, [
        "id",
        "label",
        "required",
        "type",
        "minimum",
        "maximum",
      ])
    ) {
      return false;
    }
    const minimum = value.minimum;
    const maximum = value.maximum;
    return (
      typeof minimum === "number" &&
      typeof maximum === "number" &&
      Number.isInteger(minimum) &&
      Number.isInteger(maximum) &&
      minimum >= 0 &&
      maximum <= 10 &&
      minimum < maximum
    );
  }
  if (value.type === "single-select" || value.type === "multi-select") {
    const allowedKeys =
      value.type === "single-select"
        ? ["id", "label", "required", "type", "options"]
        : ["id", "label", "required", "type", "options", "maxSelections"];
    if (!hasNoUnknownKeys(value, allowedKeys)) return false;
    const options = value.options;
    if (!Array.isArray(options) || options.length < 1 || options.length > 32) {
      return false;
    }
    const optionIds = options.map((option: unknown) =>
      isRecord(option) ? option.id : undefined,
    );
    if (
      optionIds.some((id) => !isStableId(id)) ||
      new Set(optionIds).size !== optionIds.length ||
      options.some(
        (option: unknown) =>
          !isRecord(option) ||
          !hasNoUnknownKeys(option, ["id", "label"]) ||
          typeof option.label !== "string",
      )
    ) {
      return false;
    }
    const maxSelections = value.maxSelections;
    return value.type === "single-select"
      ? true
      : typeof maxSelections === "number" &&
          Number.isInteger(maxSelections) &&
          maxSelections >= 1 &&
          maxSelections <= 32;
  }
  if (value.type === "object-reference") {
    if (
      !hasNoUnknownKeys(value, [
        "id",
        "label",
        "required",
        "type",
        "allowedTargetKinds",
      ])
    ) {
      return false;
    }
    const allowedTargetKinds = value.allowedTargetKinds;
    if (!Array.isArray(allowedTargetKinds)) return false;
    return (
      allowedTargetKinds.length >= 1 &&
      allowedTargetKinds.length <= 7 &&
      allowedTargetKinds.every(
        (kind: unknown) => typeof kind === "string" && TARGET_KINDS.has(kind),
      ) &&
      new Set(allowedTargetKinds).size === allowedTargetKinds.length
    );
  }
  return false;
}

function isValidAttributeValue(
  filter: Record<string, unknown>,
  field: Record<string, unknown>,
): boolean {
  const value = filter.value;
  switch (field.type) {
    case "text": {
      const maxLength = field.maxLength;
      return (
        typeof value === "string" &&
        typeof maxLength === "number" &&
        value.length <= maxLength
      );
    }
    case "number": {
      const minimum = field.minimum;
      const maximum = field.maximum;
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        typeof minimum === "number" &&
        typeof maximum === "number" &&
        value >= minimum &&
        value <= maximum
      );
    }
    case "date":
      return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      );
    case "single-select": {
      const options = field.options;
      return (
        typeof value === "string" &&
        Array.isArray(options) &&
        options.some(
          (option: unknown) => isRecord(option) && option.id === value,
        )
      );
    }
    case "multi-select": {
      const options = field.options;
      const maxSelections = field.maxSelections;
      return (
        Array.isArray(value) &&
        typeof maxSelections === "number" &&
        value.length <= maxSelections &&
        new Set(value).size === value.length &&
        Array.isArray(options) &&
        value.every(
          (item) =>
            typeof item === "string" &&
            options.some(
              (option: unknown) => isRecord(option) && option.id === item,
            ),
        )
      );
    }
    case "boolean":
      return typeof value === "boolean";
    case "url":
      try {
        const parsed = new URL(String(value));
        return (
          typeof value === "string" &&
          (parsed.protocol === "http:" || parsed.protocol === "https:") &&
          parsed.username === "" &&
          parsed.password === "" &&
          parsed.hash === ""
        );
      } catch {
        return false;
      }
    case "rating": {
      const minimum = field.minimum;
      const maximum = field.maximum;
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        typeof minimum === "number" &&
        typeof maximum === "number" &&
        value >= minimum &&
        value <= maximum
      );
    }
    case "object-reference": {
      const allowedTargetKinds = field.allowedTargetKinds;
      return (
        isRecord(value) &&
        UUID_VALUE.test(String(value.id)) &&
        typeof value.kind === "string" &&
        Array.isArray(allowedTargetKinds) &&
        allowedTargetKinds.includes(value.kind)
      );
    }
    default:
      return false;
  }
}

function isValidFilter(
  value: unknown,
  fields: Map<string, Record<string, unknown>>,
): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !isStableId(value.id) ||
    typeof value.kind !== "string"
  ) {
    return false;
  }
  if (value.kind === "target-kind-in") {
    if (!hasNoUnknownKeys(value, ["id", "kind", "targetKinds"])) {
      return false;
    }
    return (
      Array.isArray(value.targetKinds) &&
      value.targetKinds.length >= 1 &&
      value.targetKinds.length <= 7 &&
      value.targetKinds.every((kind) => TARGET_KINDS.has(kind)) &&
      new Set(value.targetKinds).size === value.targetKinds.length
    );
  }
  if (value.kind === "task-status-in") {
    if (!hasNoUnknownKeys(value, ["id", "kind", "statuses"])) {
      return false;
    }
    return (
      Array.isArray(value.statuses) &&
      value.statuses.length >= 1 &&
      value.statuses.length <= 8 &&
      value.statuses.every((status) => TASK_STATUSES.has(status)) &&
      new Set(value.statuses).size === value.statuses.length
    );
  }
  if (value.kind === "updated-within-days") {
    if (!hasNoUnknownKeys(value, ["id", "kind", "days"])) {
      return false;
    }
    const days = value.days;
    return (
      typeof days === "number" &&
      Number.isInteger(days) &&
      days >= 1 &&
      days <= 365
    );
  }
  if (value.kind === "attribute-equals") {
    if (!hasNoUnknownKeys(value, ["id", "kind", "fieldId", "value"])) {
      return false;
    }
    const field = fields.get(String(value.fieldId));
    return (
      isStableId(value.fieldId) &&
      field !== undefined &&
      isValidAttributeValue(value, field)
    );
  }
  return false;
}

function isValidMergedDocument(document: WorkbenchDocument): boolean {
  const payload = document.payload as unknown as Record<string, unknown>;
  if (
    document.contract !== "workbench.definition" ||
    document.schemaVersion !== 1 ||
    !isUniqueIds(payload.modules, 24) ||
    !isUniqueIds(payload.filters, 32) ||
    !isUniqueIds(payload.quickCreate, 16) ||
    !isUniqueIds(payload.fieldDefinitions, 32) ||
    !isRecord(payload.layout) ||
    !hasNoUnknownKeys(payload, [
      "name",
      "description",
      "icon",
      "accent",
      "templateId",
      "modules",
      "layout",
      "filters",
      "quickCreate",
      "fieldDefinitions",
    ])
  ) {
    return false;
  }
  const modules = payload.modules;
  const filters = payload.filters;
  const quickCreate = payload.quickCreate;
  const fields = payload.fieldDefinitions;
  const moduleIds = new Set(modules.map((module) => module.id));
  const filterIds = new Set(filters.map((filter) => filter.id));
  const quickCreateIds = new Set(quickCreate.map((item) => item.id));
  const fieldMap = new Map(fields.map((field) => [String(field.id), field]));
  if (
    !modules.every((module) => {
      const moduleFilterIds = module.filterIds ?? [];
      const moduleQuickCreateIds = module.quickCreateIds ?? [];
      const moduleKind = module.kind;
      return (
        hasNoUnknownKeys(module, [
          "id",
          "kind",
          "title",
          "filterIds",
          "quickCreateIds",
        ]) &&
        typeof moduleKind === "string" &&
        MODULE_KINDS.has(moduleKind) &&
        (module.title === undefined ||
          module.title === null ||
          typeof module.title === "string") &&
        Array.isArray(moduleFilterIds) &&
        new Set(moduleFilterIds).size === moduleFilterIds.length &&
        moduleFilterIds.every((id) => isStableId(id) && filterIds.has(id)) &&
        Array.isArray(moduleQuickCreateIds) &&
        new Set(moduleQuickCreateIds).size === moduleQuickCreateIds.length &&
        moduleQuickCreateIds.every(
          (id) => isStableId(id) && quickCreateIds.has(id),
        )
      );
    }) ||
    !quickCreate.every(
      (item) =>
        hasNoUnknownKeys(item, ["id", "command"]) &&
        (item.command === "task.create" ||
          item.command === "note.create" ||
          item.command === "source.create" ||
          item.command === "topic.create"),
    ) ||
    !fields.every(isValidFieldDefinition) ||
    !filters.every((filter) => isValidFilter(filter, fieldMap))
  ) {
    return false;
  }
  const layout = payload.layout;
  const columns = layout.columns;
  if (
    !hasNoUnknownKeys(layout, ["columns", "items"]) ||
    typeof columns !== "number" ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 4 ||
    !Array.isArray(layout.items) ||
    layout.items.length > 64
  ) {
    return false;
  }
  const layoutKeys = new Set<string>();
  const layoutModules = new Set<string>();
  for (const item of layout.items) {
    const moduleId = item.moduleId;
    const order = item.order;
    const span = item.span;
    if (
      !isRecord(item) ||
      !hasNoUnknownKeys(item, ["moduleId", "region", "order", "span"]) ||
      !isStableId(moduleId) ||
      !moduleIds.has(moduleId) ||
      !["main", "side", "footer"].includes(String(item.region)) ||
      typeof order !== "number" ||
      !Number.isInteger(order) ||
      order < 0 ||
      order > 63 ||
      typeof span !== "number" ||
      !Number.isInteger(span) ||
      span < 1 ||
      span > columns ||
      layoutKeys.has(`${item.region}:${order}`) ||
      layoutModules.has(moduleId)
    ) {
      return false;
    }
    layoutKeys.add(`${item.region}:${order}`);
    layoutModules.add(moduleId);
  }
  return layoutModules.size === moduleIds.size;
}

export function mergeWorkbenchDocuments(
  base: WorkbenchDocument,
  local: WorkbenchDocument,
  remote: WorkbenchDocument,
  prefer: "local" | "remote" = "local",
): WorkbenchDocument {
  const preferred = prefer === "local" ? local : remote;
  const merged = mergeValue(base, local, remote, prefer) as WorkbenchDocument;
  const capped = {
    ...merged,
    payload: {
      ...merged.payload,
      fieldDefinitions: capStableRecords(
        merged.payload.fieldDefinitions,
        preferred.payload.fieldDefinitions,
        32,
      ),
      filters: capStableRecords(
        merged.payload.filters,
        preferred.payload.filters,
        32,
      ),
      modules: capStableRecords(
        merged.payload.modules,
        preferred.payload.modules,
        24,
      ),
      quickCreate: capStableRecords(
        merged.payload.quickCreate,
        preferred.payload.quickCreate,
        16,
      ),
    },
  };
  const reconciled = reconcileWorkbenchDocument(
    capped,
    base,
    local,
    remote,
    prefer,
  );
  const recapped = {
    ...reconciled,
    payload: {
      ...reconciled.payload,
      fieldDefinitions: capStableRecords(
        reconciled.payload.fieldDefinitions,
        preferred.payload.fieldDefinitions,
        32,
      ),
      filters: capStableRecords(
        reconciled.payload.filters,
        preferred.payload.filters,
        32,
      ),
      modules: capStableRecords(
        reconciled.payload.modules,
        preferred.payload.modules,
        24,
      ),
      quickCreate: capStableRecords(
        reconciled.payload.quickCreate,
        preferred.payload.quickCreate,
        16,
      ),
    },
  };
  return isValidMergedDocument(recapped) &&
    isWithinWorkbenchDefinitionCapacity(recapped)
    ? recapped
    : preferred;
}

export function workbenchDocumentsEqual(
  left: WorkbenchDocument,
  right: WorkbenchDocument,
): boolean {
  return equalJson(left, right);
}

export async function workbenchMigrationIdempotencyKey(
  sourceId: string,
  document: WorkbenchDocument,
): Promise<string> {
  const source = canonicalize({ document, sourceId });
  if (typeof source !== "string") {
    throw new Error("The Workbench migration source is invalid.");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
  ).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const value = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function workbenchExportFingerprint(
  payload: WorkbenchExport,
): Promise<string> {
  const canonical = canonicalize(payload);
  if (typeof canonical !== "string") {
    throw new Error("The Workbench import is invalid.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return `sha256:${hex(digest)}`;
}

export class WorkbenchService {
  private preferenceVersion = 0;

  constructor(private readonly api: ApiClient = browserApiClient) {}

  async load(): Promise<WorkbenchState> {
    const [definitions, settings] = await Promise.all([
      this.api.request<WorkbenchDefinitionPage>(
        "/api/v1/users/me/workbenches",
        { query: { limit: "50" } },
      ),
      this.api.request<UserSettingListResponse>("/api/v1/users/me/settings", {
        query: { key: PREFERENCE_KEY },
      }),
    ]);
    const setting = settings.settings.find(
      (item) => item.key === PREFERENCE_KEY,
    );
    this.preferenceVersion = setting?.version ?? 0;
    if (!setting) return { definitions: definitions.items, preference: null };
    try {
      return {
        definitions: definitions.items,
        preference: parseWorkbenchPreference(setting.value, setting.version),
      };
    } catch {
      throw new WorkbenchPreferenceInvalidError(setting.value);
    }
  }

  async savePreference(
    payload: WorkbenchPreferencePayload,
  ): Promise<WorkbenchPreference> {
    const document: WorkbenchPreference = {
      contract: PREFERENCE_KEY,
      schemaVersion: 1,
      revision: this.preferenceVersion + 1,
      payload,
    };
    const value = JSON.stringify(document);
    parseWorkbenchPreference(value, document.revision);
    const response = await this.api.request<UserSettingListResponse>(
      "/api/v1/users/me/settings",
      {
        body: JSON.stringify({
          settings: [
            { key: PREFERENCE_KEY, value, version: this.preferenceVersion },
          ],
        }),
        csrf: true,
        method: "PUT",
      },
    );
    const saved = response.settings.find((item) => item.key === PREFERENCE_KEY);
    if (!saved)
      throw new Error("The Workbench preference response is invalid.");
    const parsed = parseWorkbenchPreference(saved.value, saved.version);
    this.preferenceVersion = saved.version;
    return parsed;
  }

  create(
    document: WorkbenchDocument,
    idempotencyKey?: string,
  ): Promise<WorkbenchDefinition> {
    return this.api.request("/api/v1/users/me/workbenches", {
      body: JSON.stringify({ document }),
      csrf: true,
      headers: idempotencyHeaders(idempotencyKey),
      method: "POST",
    });
  }

  get(id: string): Promise<WorkbenchDefinition> {
    return this.api.request(`/api/v1/users/me/workbenches/${id}`);
  }

  async replace(
    definition: WorkbenchDefinition,
    local: WorkbenchDocument,
  ): Promise<WorkbenchDefinition> {
    try {
      return await this.replaceAgainst(
        definition.id,
        definition.revision,
        definition.document,
        local,
      );
    } catch (error) {
      if (
        error instanceof LogionApiError &&
        error.code === "WORKBENCH_VERSION_CONFLICT" &&
        definitionConflict(error.details)
      ) {
        throw new WorkbenchConflictError(error.details);
      }
      throw error;
    }
  }

  async replaceAgainst(
    id: string,
    expectedRevision: number,
    base: WorkbenchDocument,
    local: WorkbenchDocument,
  ): Promise<WorkbenchDefinition> {
    try {
      return await this.api.request(`/api/v1/users/me/workbenches/${id}`, {
        body: JSON.stringify({ expectedRevision, base, local }),
        csrf: true,
        method: "PUT",
      });
    } catch (error) {
      if (
        error instanceof LogionApiError &&
        error.code === "WORKBENCH_VERSION_CONFLICT" &&
        definitionConflict(error.details)
      ) {
        throw new WorkbenchConflictError(error.details);
      }
      throw error;
    }
  }

  setLifecycle(
    definition: WorkbenchSummary,
    lifecycle: "active" | "archived",
  ): Promise<WorkbenchDefinition> {
    return this.api.request(
      `/api/v1/users/me/workbenches/${definition.id}/${lifecycle === "active" ? "restore" : "archive"}`,
      {
        body: JSON.stringify({
          expectedRevision: definition.revision,
          baseLifecycle: definition.lifecycle,
        }),
        csrf: true,
        method: "POST",
      },
    );
  }

  deletionImpact(id: string): Promise<WorkbenchDeletionImpact> {
    return this.api.request(
      `/api/v1/users/me/workbenches/${id}/deletion-impact`,
    );
  }

  delete(impact: WorkbenchDeletionImpact): Promise<WorkbenchDeleteReceipt> {
    return this.api.request(
      `/api/v1/users/me/workbenches/${impact.workbenchId}`,
      {
        body: JSON.stringify({
          expectedRevision: impact.revision,
          expectedLinkSetRevision: impact.linkSetRevision,
          impactFingerprint: impact.impactFingerprint,
        }),
        csrf: true,
        headers: idempotencyHeaders(),
        method: "DELETE",
      },
    );
  }

  export(id: string, includeLinks: boolean): Promise<WorkbenchExport> {
    return this.api.request(`/app/api/workbench-exports/${id}`, {
      csrf: true,
      method: "POST",
      query: { include_links: String(includeLinks) },
    });
  }

  async import(rawPayload: string): Promise<WorkbenchImportReceipt> {
    if (new TextEncoder().encode(rawPayload).byteLength > 2 * 1024 * 1024) {
      throw new Error("The Workbench import exceeds 2 MiB.");
    }
    const payload = JSON.parse(rawPayload) as WorkbenchExport;
    const sourceFingerprint = await workbenchExportFingerprint(payload);
    return this.api.request("/api/v1/users/me/workbenches/imports", {
      body: `{"sourceFingerprint":${JSON.stringify(sourceFingerprint)},"payload":${rawPayload}}`,
      csrf: true,
      headers: idempotencyHeaders(),
      method: "POST",
    });
  }
}

export const workbenchService = new WorkbenchService();
