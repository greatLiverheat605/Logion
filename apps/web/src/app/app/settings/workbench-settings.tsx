"use client";

import { type FormEvent, useRef, useState } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";
import { AppModal } from "@/components/app-shell/app-modal";
import { PersonaSettings } from "./persona-settings";
import {
  createWorkbenchDocument,
  WORKBENCH_MODULES,
} from "@/features/workbenches/workbench-model";
import { useWorkbench } from "@/features/workbenches/workbench-context";
import {
  WorkbenchConflictError,
  mergeWorkbenchDocuments,
  type WorkbenchDefinition,
  type WorkbenchDefinitionConflictDetails,
  type WorkbenchDeletionImpact,
  type WorkbenchDocument,
  type WorkbenchSummary,
} from "@/features/workbenches/workbench-service";

const ICONS = [
  "book-open",
  "microscope",
  "graduation-cap",
  "users",
  "layout-dashboard",
  "target",
  "folder",
  "note",
] as const;
const ACCENTS = [
  "neutral",
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "cyan",
] as const;
const TEMPLATES = [
  ["fixed.learning", "学习模板"],
  ["fixed.research", "研究模板"],
  ["fixed.exam", "考试模板"],
  ["fixed.mentor", "导师模板"],
  ["blank", "空白工作台"],
] as const;

type EditorState = { definition?: WorkbenchDefinition };
type ConflictState = {
  definition: WorkbenchDefinition;
  details: WorkbenchDefinitionConflictDetails;
  local: WorkbenchDocument;
};

function iconName(token: string): AppIconName {
  switch (token) {
    case "microscope":
      return "flask";
    case "users":
      return "users";
    case "layout-dashboard":
      return "layout-template";
    case "target":
      return "target";
    case "folder":
      return "folder";
    case "note":
      return "clipboard";
    default:
      return "book-open";
  }
}

function message(error: unknown): string {
  if (error instanceof WorkbenchConflictError)
    return "工作台已在其他设备更新。";
  return "操作未完成，请刷新后重试。";
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, value: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function documentFromForm(
  data: FormData,
  base?: WorkbenchDocument,
): WorkbenchDocument {
  const templateId = String(data.get("templateId")) as
    | WorkbenchDocument["payload"]["templateId"]
    | "blank";
  const selected = new Set(data.getAll("modules").map(String));
  const existing = base?.payload.modules ?? [];
  const usedIds = new Set(existing.map((module) => module.id));
  const modules = WORKBENCH_MODULES.flatMap(([kind]) => {
    if (!selected.has(kind)) return [];
    const matches = existing.filter((module) => module.kind === kind);
    if (matches.length) return matches;
    let id = `module-${kind}`;
    for (let suffix = 2; usedIds.has(id); suffix += 1) {
      id = `module-${kind}-${suffix}`;
    }
    usedIds.add(id);
    return [
      {
        id,
        kind,
      } as WorkbenchDocument["payload"]["modules"][number],
    ];
  });
  const fresh = createWorkbenchDocument({
    accent: String(
      data.get("accent"),
    ) as WorkbenchDocument["payload"]["accent"],
    description: String(data.get("description") ?? "").trim(),
    icon: String(data.get("icon")) as WorkbenchDocument["payload"]["icon"],
    moduleKinds:
      base || selected.size > 0
        ? modules.map((module) => module.kind)
        : undefined,
    name: String(data.get("name") ?? "").trim(),
    templateId,
  });
  if (!base) return fresh;
  const existingLayout = new Map(
    base.payload.layout.items.map((item) => [item.moduleId, item]),
  );
  const usedMainOrders = new Set(
    modules.flatMap((module) => {
      const item = existingLayout.get(module.id);
      return item?.region === "main" ? [item.order] : [];
    }),
  );
  let nextMainOrder = 0;
  const layoutItems = modules.map((module) => {
    const item = existingLayout.get(module.id);
    if (item) return item;
    while (usedMainOrders.has(nextMainOrder)) nextMainOrder += 1;
    const created = {
      moduleId: module.id,
      order: nextMainOrder,
      region: "main" as const,
      span: 1,
    };
    usedMainOrders.add(nextMainOrder);
    return created;
  });
  return {
    ...base,
    payload: {
      ...base.payload,
      ...fresh.payload,
      fieldDefinitions: base.payload.fieldDefinitions,
      filters: base.payload.filters,
      layout: { ...base.payload.layout, items: layoutItems },
      modules,
      quickCreate: base.payload.quickCreate,
    },
  };
}

export function WorkbenchSettings() {
  const workbench = useWorkbench();
  const invalidPreferenceSource = workbench.invalidPreferenceSource;
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [deletion, setDeletion] = useState<{
    definition: WorkbenchSummary;
    impact: WorkbenchDeletionImpact;
  } | null>(null);
  const [exporting, setExporting] = useState<WorkbenchSummary | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<void>, success: string) {
    setPending(id);
    setError(null);
    setStatus(null);
    try {
      await action();
      setStatus(success);
    } catch (caught) {
      setError(message(caught));
      throw caught;
    } finally {
      setPending(null);
    }
  }

  async function openEditor(definition?: WorkbenchSummary) {
    setError(null);
    if (!definition) {
      setEditor({});
      return;
    }
    setPending(definition.id);
    try {
      setEditor({ definition: await workbench.loadWorkbench(definition.id) });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const definition = editor?.definition;
    const local = documentFromForm(
      new FormData(event.currentTarget),
      definition?.document,
    );
    if (!local.payload.name) {
      setError("请输入工作台名称。");
      return;
    }
    setPending(definition?.id ?? "create");
    setError(null);
    try {
      if (definition) {
        await workbench.updateWorkbench(definition, local);
        setStatus(`已保存「${local.payload.name}」。`);
      } else {
        await workbench.createWorkbench(local);
        setStatus(`已创建「${local.payload.name}」。`);
      }
      setEditor(null);
    } catch (caught) {
      if (caught instanceof WorkbenchConflictError && definition) {
        setConflict({ definition, details: caught.details, local });
        setEditor(null);
      } else {
        setError(message(caught));
      }
    } finally {
      setPending(null);
    }
  }

  async function prepareDelete(definition: WorkbenchSummary) {
    setPending(definition.id);
    setError(null);
    try {
      setDeletion({
        definition,
        impact: await workbench.getDeletionImpact(definition.id),
      });
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(null);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    await run(
      "import",
      async () => workbench.importWorkbench(await file.text()),
      "工作台已导入。",
    ).catch(() => undefined);
    if (importRef.current) importRef.current.value = "";
  }

  if (workbench.phase === "loading") {
    return <p className="workbench-settings-state">正在读取工作台设置…</p>;
  }

  if (workbench.phase !== "ready") {
    return (
      <>
        <section className="product-panel workbench-migration-panel">
          <header className="product-panel-head">
            <div>
              <h2>工作台兼容模式</h2>
              <div className="product-panel-description">
                {workbench.phase === "migration-required"
                  ? "新工作台能力已可用。确认迁移后，旧画像会保留为回滚来源。"
                  : workbench.phase === "invalid-preference"
                    ? "新偏好无法安全读取，已回退旧画像；可先导出原值再修复。"
                    : "自定义工作台 API 当前未开放，继续使用既有画像设置。"}
              </div>
            </div>
            <div className="app-actions">
              {workbench.phase === "migration-required" ? (
                <button
                  className="primary-action workbench-primary-action"
                  disabled={pending !== null}
                  type="button"
                  onClick={() =>
                    void run(
                      "migration",
                      workbench.migrateLegacyPersonas,
                      "画像偏好已迁移为工作台，旧设置仍保留。",
                    ).catch(() => undefined)
                  }
                >
                  确认迁移
                </button>
              ) : null}
              {invalidPreferenceSource ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    downloadText(
                      "workbench-preference-recovery.json",
                      invalidPreferenceSource,
                    )
                  }
                >
                  导出原值
                </button>
              ) : null}
              {workbench.phase === "error" ||
              workbench.phase === "invalid-preference" ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void workbench.refresh()}
                >
                  重试
                </button>
              ) : null}
            </div>
          </header>
        </section>
        <PersonaSettings />
        {status ? <p className="persona-status">{status}</p> : null}
        {error ? <p className="inline-form-feedback error">{error}</p> : null}
      </>
    );
  }

  return (
    <>
      <section className="product-panel">
        <header className="product-panel-head">
          <div>
            <h2>固定工作台</h2>
            <div className="product-panel-description">
              固定工作台只改变工作方式，不改变 Workspace、Space 或对象权限。
            </div>
          </div>
        </header>
        <div className="workbench-settings-grid">
          {workbench.options
            .filter((item) => item.kind === "fixed")
            .map((item) => (
              <button
                aria-pressed={workbench.activeWorkbench?.ref === item.ref}
                className="workbench-settings-choice"
                disabled={pending !== null}
                key={item.ref}
                type="button"
                onClick={() =>
                  void run(
                    item.ref,
                    async () => {
                      await workbench.selectWorkbench(item.ref);
                    },
                    `已切换到「${item.name}」。`,
                  ).catch(() => undefined)
                }
              >
                <span aria-hidden="true">{item.icon}</span>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </button>
            ))}
        </div>
      </section>

      <section className="product-panel">
        <header className="product-panel-head">
          <div>
            <h2>自定义工作台</h2>
            <div className="product-panel-description">
              从固定模板或空白配置创建；正式对象、成员与权限不会被复制。
            </div>
          </div>
          <div className="app-actions">
            <input
              accept="application/json,.json"
              aria-label="导入工作台 JSON 文件"
              className="sr-only"
              ref={importRef}
              type="file"
              onChange={(event) => void importFile(event.target.files?.[0])}
            />
            <button
              className="secondary-button"
              disabled={pending !== null}
              type="button"
              onClick={() => importRef.current?.click()}
            >
              <AppIcon name="download" size={16} />
              导入
            </button>
            <button
              className="primary-action workbench-primary-action"
              disabled={pending !== null}
              ref={createButtonRef}
              type="button"
              onClick={() => void openEditor()}
            >
              <AppIcon name="plus" size={16} />
              新建工作台
            </button>
          </div>
        </header>
        {workbench.definitions.length ? (
          <div className="workbench-definition-list">
            {workbench.definitions.map((definition) => (
              <article className="workbench-definition-row" key={definition.id}>
                <span
                  aria-hidden="true"
                  className="workbench-definition-icon"
                  data-accent={definition.accent}
                >
                  <AppIcon name={iconName(definition.icon)} />
                </span>
                <span className="workbench-definition-copy">
                  <strong>{definition.name}</strong>
                  <small>
                    {definition.description || "无说明"} ·{" "}
                    {definition.lifecycle === "active" ? "使用中" : "已归档"}
                  </small>
                </span>
                <div className="workbench-definition-actions">
                  <button
                    aria-label={`编辑工作台：${definition.name}`}
                    disabled={pending !== null}
                    type="button"
                    onClick={() => void openEditor(definition)}
                  >
                    编辑
                  </button>
                  <button
                    aria-label={`导出工作台：${definition.name}`}
                    disabled={pending !== null}
                    type="button"
                    onClick={() => setExporting(definition)}
                  >
                    <AppIcon name="download" size={15} />
                  </button>
                  <button
                    disabled={pending !== null}
                    type="button"
                    onClick={() =>
                      void run(
                        definition.id,
                        async () => {
                          await workbench.setWorkbenchLifecycle(
                            definition,
                            definition.lifecycle === "active"
                              ? "archived"
                              : "active",
                          );
                        },
                        definition.lifecycle === "active"
                          ? "工作台已归档。"
                          : "工作台已恢复。",
                      ).catch(() => undefined)
                    }
                  >
                    {definition.lifecycle === "active" ? "归档" : "恢复"}
                  </button>
                  <button
                    aria-label={`删除工作台：${definition.name}`}
                    className="danger-button"
                    disabled={pending !== null}
                    type="button"
                    onClick={() => void prepareDelete(definition)}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="workbench-settings-state">尚未创建自定义工作台。</p>
        )}
      </section>

      {status ? (
        <p className="persona-status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="inline-form-feedback error" role="alert">
          {error}
        </p>
      ) : null}

      {editor ? (
        <AppModal
          eyebrow={editor.definition ? "EDIT WORKBENCH" : "CUSTOM WORKBENCH"}
          returnFocusRef={createButtonRef}
          title={editor.definition ? "编辑工作台" : "新建工作台"}
          onClose={() => setEditor(null)}
        >
          <form className="workbench-editor" onSubmit={save}>
            <label htmlFor="workbench-name">名称</label>
            <input
              data-modal-autofocus
              defaultValue={editor.definition?.document.payload.name}
              id="workbench-name"
              maxLength={80}
              name="name"
              required
            />
            <label htmlFor="workbench-description">说明</label>
            <textarea
              defaultValue={editor.definition?.document.payload.description}
              id="workbench-description"
              maxLength={280}
              name="description"
              rows={3}
            />
            <label htmlFor="workbench-template">模板</label>
            <select
              defaultValue={
                editor.definition?.document.payload.templateId ??
                "fixed.learning"
              }
              id="workbench-template"
              name="templateId"
            >
              {TEMPLATES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <fieldset>
              <legend>图标</legend>
              <div className="workbench-token-grid">
                {ICONS.map((icon) => (
                  <label key={icon} title={icon}>
                    <input
                      defaultChecked={
                        (editor.definition?.document.payload.icon ??
                          "book-open") === icon
                      }
                      name="icon"
                      type="radio"
                      value={icon}
                    />
                    <AppIcon name={iconName(icon)} />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>辅助色</legend>
              <div className="workbench-token-grid">
                {ACCENTS.map((accent) => (
                  <label data-accent={accent} key={accent} title={accent}>
                    <input
                      defaultChecked={
                        (editor.definition?.document.payload.accent ??
                          "neutral") === accent
                      }
                      name="accent"
                      type="radio"
                      value={accent}
                    />
                    <span className="workbench-color-swatch" />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>模块</legend>
              <div className="workbench-module-grid">
                {WORKBENCH_MODULES.map(([kind, label]) => (
                  <label key={kind}>
                    <input
                      defaultChecked={
                        editor.definition?.document.payload.modules.some(
                          (module) => module.kind === kind,
                        ) ?? false
                      }
                      name="modules"
                      type="checkbox"
                      value={kind}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="persona-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditor(null)}
              >
                取消
              </button>
              <button
                className="primary-action workbench-primary-action"
                disabled={pending !== null}
                type="submit"
              >
                {pending ? "正在保存…" : "保存工作台"}
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}

      {conflict ? (
        <AppModal
          eyebrow="VERSION CONFLICT"
          title="比较工作台修改"
          onClose={() => setConflict(null)}
        >
          <p className="muted">
            以下路径同时发生变化，请明确选择本地、远端或返回编辑合并稿。
          </p>
          <ul className="workbench-conflict-paths">
            {conflict.details.conflictPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <div className="workbench-conflict-grid">
            {(
              [
                ["保存前", conflict.details.base],
                ["本地修改", conflict.local],
                ["远端版本", conflict.details.remote],
              ] as const
            ).map(([label, document]) => (
              <section key={label}>
                <h3>{label}</h3>
                <strong>{document.payload.name}</strong>
                <p>{document.payload.description || "无说明"}</p>
                <small>{document.payload.modules.length} 个模块</small>
              </section>
            ))}
          </div>
          <div className="persona-dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setConflict(null);
                void workbench.refresh();
              }}
            >
              采用远端
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                const remote = conflict.details.remote;
                const merged = mergeWorkbenchDocuments(
                  conflict.details.base,
                  conflict.local,
                  remote,
                );
                setEditor({
                  definition: {
                    ...conflict.definition,
                    description: merged.payload.description,
                    document: merged,
                    icon: merged.payload.icon,
                    name: merged.payload.name,
                    revision: conflict.details.remoteRevision,
                    templateId: merged.payload.templateId,
                  },
                });
                setConflict(null);
              }}
            >
              编辑合并稿
            </button>
            <button
              className="primary-action workbench-primary-action"
              disabled={pending !== null}
              type="button"
              onClick={() => {
                const current = conflict;
                void run(
                  current.definition.id,
                  async () =>
                    workbench.resolveDefinitionConflict(
                      current.definition.id,
                      current.details,
                      current.local,
                    ),
                  "已基于远端版本保存本地修改。",
                )
                  .then(() => setConflict(null))
                  .catch((caught) => {
                    if (caught instanceof WorkbenchConflictError) {
                      setError(null);
                      setConflict({
                        definition: current.definition,
                        details: caught.details,
                        local: current.local,
                      });
                    }
                  });
              }}
            >
              保留本地并重试
            </button>
          </div>
        </AppModal>
      ) : null}

      {exporting ? (
        <AppModal
          eyebrow="EXPORT"
          title={`导出「${exporting.name}」`}
          onClose={() => setExporting(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const includeLinks =
                new FormData(event.currentTarget).get("includeLinks") === "on";
              void run(
                exporting.id,
                async () =>
                  downloadJson(
                    `workbench-${exporting.id}.json`,
                    await workbench.exportWorkbench(exporting, includeLinks),
                  ),
                "导出文件已生成。",
              )
                .then(() => setExporting(null))
                .catch(() => undefined);
            }}
          >
            <label className="workbench-export-option">
              <input name="includeLinks" type="checkbox" />
              <span>包含当前仍有权访问的对象引用，不包含对象正文。</span>
            </label>
            <div className="persona-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setExporting(null)}
              >
                取消
              </button>
              <button
                className="primary-action workbench-primary-action"
                type="submit"
              >
                导出
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}

      {deletion ? (
        <AppModal
          eyebrow="DELETE WORKBENCH"
          title={`删除「${deletion.definition.name}」`}
          onClose={() => setDeletion(null)}
        >
          <p>
            将删除工作台配置和 {deletion.impact.linkCount}{" "}
            个引用；正式对象删除数为 0。
          </p>
          {deletion.impact.preferenceWillFallback ? (
            <p className="muted">当前偏好将回退到学习工作台。</p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const confirmation = String(
                new FormData(event.currentTarget).get("confirmation") ?? "",
              );
              if (confirmation !== deletion.definition.name) {
                setError("请输入完整工作台名称以确认删除。");
                return;
              }
              void run(
                deletion.definition.id,
                async () => workbench.deleteWorkbench(deletion.impact),
                "工作台配置已删除，正式对象未被删除。",
              )
                .then(() => setDeletion(null))
                .catch(() => undefined);
            }}
          >
            <label htmlFor="workbench-delete-confirmation">
              输入工作台名称确认
            </label>
            <input
              data-modal-autofocus
              id="workbench-delete-confirmation"
              name="confirmation"
              autoComplete="off"
            />
            <div className="persona-dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDeletion(null)}
              >
                取消
              </button>
              <button className="danger-button" type="submit">
                删除配置
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}
    </>
  );
}
