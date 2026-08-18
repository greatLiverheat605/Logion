import { ProductTag } from "./product-ui";

export interface WorkbenchInspectorField {
  readonly label: string;
  readonly value: string;
}

export interface WorkbenchInspectorObject {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: string;
  readonly spaceId?: string;
  readonly updatedAt?: string;
  readonly sourceUrl?: string | null;
  readonly fields?: readonly WorkbenchInspectorField[];
}

export interface WorkbenchInspectorRecord {
  readonly entity: {
    readonly deleted_at: string | null;
    readonly entity_id: string;
    readonly entity_type: string;
    readonly sync_status: string;
    readonly updated_at: string;
    readonly workspace_id: string;
  };
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WorkbenchInspectorSelection {
  readonly id: string;
  readonly kind: string;
}

export function workbenchInspectorContextKey({
  personaId,
  spaceId,
  unlocked,
  vaultRevision,
  workbench,
  workspaceId,
}: Readonly<{
  personaId: string | null;
  spaceId: string;
  unlocked: boolean;
  vaultRevision: number;
  workbench: string;
  workspaceId: string;
}>): string {
  return JSON.stringify([
    personaId,
    workbench,
    workspaceId,
    spaceId,
    vaultRevision,
    unlocked,
  ]);
}

export function projectWorkbenchInspectorObject({
  allowedKinds,
  contextAllowed = true,
  records,
  selection,
  spaceId,
  workspaceId,
}: Readonly<{
  allowedKinds: readonly string[];
  contextAllowed?: boolean;
  records: readonly WorkbenchInspectorRecord[];
  selection: WorkbenchInspectorSelection | null;
  spaceId: string;
  workspaceId: string;
}>): WorkbenchInspectorObject | null {
  if (
    !selection ||
    !workspaceId ||
    !spaceId ||
    !contextAllowed ||
    !allowedKinds.includes(selection.kind)
  )
    return null;

  const record = records.find(
    (candidate) =>
      candidate.entity.entity_id === selection.id &&
      candidate.entity.entity_type === selection.kind &&
      candidate.entity.workspace_id === workspaceId &&
      candidate.entity.deleted_at === null &&
      typeof candidate.payload.space_id === "string" &&
      candidate.payload.space_id === spaceId,
  );
  if (!record) return null;

  const description = String(
    record.payload.description ??
      record.payload.objective ??
      record.payload.evidence_summary ??
      record.payload.method_summary ??
      record.payload.criteria ??
      record.payload.feedback ??
      record.payload.submission_summary ??
      record.payload.summary ??
      record.payload.note ??
      "",
  );
  const fields = [
    record.payload.citation_key
      ? { label: "引用键", value: String(record.payload.citation_key) }
      : null,
    record.payload.question
      ? { label: "研究问题", value: String(record.payload.question) }
      : null,
    record.payload.coverage_status
      ? { label: "覆盖", value: String(record.payload.coverage_status) }
      : null,
    record.payload.score !== undefined
      ? {
          label: "得分",
          value:
            `${String(record.payload.score)} / ${String(record.payload.score_scale_max ?? "")}`.trim(),
        }
      : null,
    record.payload.value !== undefined
      ? {
          label: "指标值",
          value:
            `${String(record.payload.value)} ${String(record.payload.unit ?? "")}`.trim(),
        }
      : null,
  ].filter((field): field is WorkbenchInspectorField => field !== null);

  return {
    description,
    fields,
    id: record.entity.entity_id,
    kind: record.entity.entity_type,
    sourceUrl:
      typeof record.payload.source_url === "string"
        ? record.payload.source_url
        : null,
    spaceId,
    status: record.entity.sync_status,
    title: String(
      record.payload.title ??
        record.payload.question ??
        record.payload.statement ??
        record.payload.name ??
        record.payload.subject_title ??
        "对象",
    ),
    updatedAt: record.entity.updated_at,
  };
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function WorkbenchObjectInspector({
  object,
}: Readonly<{ object: WorkbenchInspectorObject | null }>) {
  if (!object) {
    return <p role="status">对象详情暂不可用。</p>;
  }

  const sourceUrl = safeHttpUrl(object.sourceUrl);

  return (
    <div className="workbench-object-inspector">
      <section>
        <ProductTag tone="info">{object.kind}</ProductTag>
        <h3>{object.title}</h3>
        {object.description ? <p>{object.description}</p> : null}
        {object.status ? <ProductTag>{object.status}</ProductTag> : null}
      </section>
      <dl>
        <div>
          <dt>对象 ID</dt>
          <dd>{object.id}</dd>
        </div>
        {object.spaceId ? (
          <div>
            <dt>Space</dt>
            <dd>{object.spaceId}</dd>
          </div>
        ) : null}
        {object.updatedAt ? (
          <div>
            <dt>更新时间</dt>
            <dd>{object.updatedAt}</dd>
          </div>
        ) : null}
        {object.fields?.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h4>来源</h4>
        {sourceUrl ? (
          <a href={sourceUrl} rel="noreferrer noopener" target="_blank">
            打开外部来源
          </a>
        ) : (
          <p>当前对象没有可用的外部来源。</p>
        )}
      </section>
      <p role="note">仅显示当前授权范围内的对象快照。</p>
    </div>
  );
}
