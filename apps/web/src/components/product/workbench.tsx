"use client";

import { useId, useState, type ReactNode } from "react";

type WorkbenchPane = "inspector" | "main" | "master";

export interface WorkbenchContextItem {
  key: string;
  label: string;
  tone?: "default" | "good" | "warn";
  value: ReactNode;
}

interface WorkbenchContextEntity {
  id?: string;
  name: string;
}

interface WorkbenchContextStatus {
  label: string;
  tone?: WorkbenchContextItem["tone"];
}

export interface WorkbenchOperationalContext {
  permission?: WorkbenchContextStatus;
  persona?: WorkbenchContextEntity;
  space?: WorkbenchContextEntity;
  sync?: WorkbenchContextStatus;
  vault?: WorkbenchContextStatus;
  workspace?: WorkbenchContextEntity;
}

function hasText(value: string) {
  return value.trim().length > 0;
}

export function workbenchContextItems(
  context: WorkbenchOperationalContext,
): WorkbenchContextItem[] {
  const items: WorkbenchContextItem[] = [];
  const addEntity = (
    key: "persona" | "space" | "workspace",
    label: string,
    entity: WorkbenchContextEntity | undefined,
  ) => {
    if (!entity || !hasText(entity.name)) return;
    items.push({ key, label, value: entity.name });
  };
  const addStatus = (
    key: "permission" | "sync" | "vault",
    label: string,
    status: WorkbenchContextStatus | undefined,
  ) => {
    if (!status || !hasText(status.label)) return;
    items.push({
      key,
      label,
      tone: status.tone,
      value: status.label,
    });
  };

  addEntity("workspace", "Workspace", context.workspace);
  addEntity("space", "Space", context.space);
  addEntity("persona", "Persona", context.persona);
  addStatus("permission", "权限", context.permission);
  addStatus("vault", "Vault", context.vault);
  addStatus("sync", "Sync", context.sync);
  return items;
}

export function WorkbenchHeader({
  actions,
  description,
  eyebrow,
  title,
}: Readonly<{
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}>) {
  return (
    <header className="workbench-header">
      <div className="workbench-header-copy">
        {eyebrow ? <p className="workbench-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? (
          <div className="workbench-description">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="workbench-header-actions">{actions}</div>
      ) : null}
    </header>
  );
}

export function WorkbenchContextBar({
  context,
  items,
}: Readonly<{
  context?: WorkbenchOperationalContext;
  items?: readonly WorkbenchContextItem[];
}>) {
  const resolvedItems = context
    ? workbenchContextItems(context)
    : (items ?? []);

  return (
    <dl
      aria-label="当前工作台上下文"
      className="workbench-context-bar"
      tabIndex={0}
    >
      {resolvedItems.map((item) => (
        <div
          className={`workbench-context-item tone-${item.tone ?? "default"}`}
          key={item.key}
        >
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkbenchActionBar({
  label = "工作台操作",
  primary,
  secondary,
}: Readonly<{
  label?: string;
  primary?: ReactNode;
  secondary?: ReactNode;
}>) {
  return (
    <div aria-label={label} className="workbench-action-bar" role="group">
      {secondary ? (
        <div className="workbench-secondary-actions">{secondary}</div>
      ) : null}
      {primary ? (
        <div className="workbench-primary-action" data-workbench-primary="true">
          {primary}
        </div>
      ) : null}
    </div>
  );
}

export function WorkbenchToolbar({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <div aria-label={label} className="workbench-toolbar" role="toolbar">
      {children}
    </div>
  );
}

export function InspectorSection({
  actions,
  children,
  title,
}: Readonly<{ actions?: ReactNode; children: ReactNode; title: ReactNode }>) {
  return (
    <section className="workbench-inspector-section">
      <header>
        <h2>{title}</h2>
        {actions}
      </header>
      <div className="workbench-inspector-body">{children}</div>
    </section>
  );
}

export function WorkbenchFrame({
  context,
  header,
  initialPane = "main",
  inspector,
  inspectorLabel = "详情检查器",
  label,
  main,
  mainLabel = "工作区",
  master,
  masterLabel = "对象列表",
  toolbar,
}: Readonly<{
  context?: ReactNode;
  header: ReactNode;
  initialPane?: WorkbenchPane;
  inspector?: ReactNode;
  inspectorLabel?: string;
  label: string;
  main: ReactNode;
  mainLabel?: string;
  master: ReactNode;
  masterLabel?: string;
  toolbar?: ReactNode;
}>) {
  const regionId = useId();
  const [activePane, setActivePane] = useState<WorkbenchPane>(initialPane);
  const panes: Array<{ id: WorkbenchPane; label: string }> = [
    { id: "master", label: masterLabel },
    { id: "main", label: mainLabel },
    ...(inspector ? [{ id: "inspector" as const, label: inspectorLabel }] : []),
  ];

  return (
    <section
      aria-label={label}
      className="workbench-frame"
      data-testid="workbench-frame"
    >
      {header}
      {context}
      <nav aria-label="工作台区域" className="workbench-pane-switcher">
        {panes.map((pane) => (
          <button
            aria-controls={`${regionId}-${pane.id}`}
            aria-pressed={activePane === pane.id}
            key={pane.id}
            onClick={() => setActivePane(pane.id)}
            type="button"
          >
            {pane.label}
          </button>
        ))}
      </nav>
      {toolbar}
      <div className="workbench-grid">
        <aside
          aria-label={masterLabel}
          className="workbench-pane workbench-master"
          data-active={activePane === "master"}
          data-testid="workbench-master"
          id={`${regionId}-master`}
          tabIndex={0}
        >
          {master}
        </aside>
        <section
          aria-label={mainLabel}
          className="workbench-pane workbench-main"
          data-active={activePane === "main"}
          data-testid="workbench-main"
          id={`${regionId}-main`}
          tabIndex={0}
        >
          {main}
        </section>
        {inspector ? (
          <aside
            aria-label={inspectorLabel}
            className="workbench-pane workbench-inspector"
            data-active={activePane === "inspector"}
            data-testid="workbench-inspector"
            id={`${regionId}-inspector`}
            tabIndex={0}
          >
            {inspector}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
