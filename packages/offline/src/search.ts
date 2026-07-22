import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError } from "./errors";
import type { JsonObject, LocalEntity } from "./types";
import { validateUuid } from "./validation";
import { OfflineVault } from "./vault";

const SEARCHABLE_TYPES = new Set([
  "learning_goal",
  "task",
  "note",
  "resource",
  "paper_record",
]);

export interface OfflineSearchResult {
  entity_type: string;
  entity_id: string;
  title: string;
  snippet: string;
  updated_at: string;
}

export class OfflineSearchRepository {
  constructor(
    private readonly database: LogionOfflineDatabase,
    private readonly vault: OfflineVault,
  ) {}

  async search(
    workspaceId: string,
    query: string,
    limit = 30,
  ): Promise<OfflineSearchResult[]> {
    validateUuid(workspaceId);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length < 2 || normalizedQuery.length > 100) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    const rows = await this.database.entities
      .where("workspace_id")
      .equals(workspaceId)
      .filter(
        (entity) =>
          entity.deleted_at === null &&
          SEARCHABLE_TYPES.has(entity.entity_type),
      )
      .toArray();
    const results: OfflineSearchResult[] = [];
    for (const entity of rows) {
      const payload = await this.payload(entity);
      const [title, body] = searchableText(entity.entity_type, payload);
      const combined = `${title} ${body}`.replaceAll("\u0000", " ");
      const index = combined.toLocaleLowerCase().indexOf(normalizedQuery);
      if (index < 0) continue;
      results.push({
        entity_type: entity.entity_type,
        entity_id: entity.entity_id,
        title,
        snippet: snippet(combined, normalizedQuery),
        updated_at: entity.updated_at,
      });
    }
    return [...results]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, limit);
  }

  private async payload(entity: LocalEntity): Promise<JsonObject> {
    const reference = entity.payload.encrypted_payload_ref;
    if (typeof reference !== "string") return entity.payload;
    const value = await this.vault.get(reference, entity.workspace_id);
    if (value === null) throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    return value;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function searchableText(
  entityType: string,
  payload: JsonObject,
): [string, string] {
  if (entityType === "learning_goal")
    return [
      text(payload.title),
      `${text(payload.description)} ${text(payload.desired_outcome)}`,
    ];
  if (entityType === "task")
    return [text(payload.title), text(payload.description)];
  if (entityType === "note")
    return [text(payload.title), text(payload.markdown_body)];
  if (entityType === "resource")
    return [text(payload.title), text(payload.pdf_filename)];
  if (entityType === "paper_record")
    return [text(payload.title), text(payload.citation_key)];
  return ["", ""];
}

function snippet(value: string, query: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const adjusted = normalized.toLocaleLowerCase().indexOf(query);
  return normalized.slice(
    Math.max(0, adjusted - 60),
    Math.max(0, adjusted - 60) + 180,
  );
}
