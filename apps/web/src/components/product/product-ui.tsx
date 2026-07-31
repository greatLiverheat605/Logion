import type { ReactNode } from "react";

import { AppIcon, type AppIconName } from "@/components/app-shell/app-icon";

type ProductTone = "default" | "good" | "info" | "warn" | "bad";

const EMPTY_STATE_ICON_MAP: Readonly<Record<string, AppIconName>> = {
  "+": "plus",
  "＋": "plus",
  "✓": "shield",
  "?": "search",
  "□": "folder",
  "▦": "layout-template",
  "◇": "archive",
  "◫": "files",
  "⌁": "refresh",
  "⌕": "search",
  "◎": "users",
  "▶": "timer",
  "↓": "download",
  "↑": "archive",
  "↗": "files",
  "✎": "book-open",
  "⇢": "refresh",
};

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function ProductPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: Readonly<{
  actions?: ReactNode;
  description: ReactNode;
  eyebrow: string;
  title: ReactNode;
}>) {
  return (
    <header className="product-page-head">
      <div>
        <p className="product-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <div className="product-page-description">{description}</div>
      </div>
      {actions ? <div className="product-page-actions">{actions}</div> : null}
    </header>
  );
}

export function ProductPanel({
  aside,
  children,
  className,
  description,
  id,
  title,
}: Readonly<{
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  id?: string;
  title?: ReactNode;
}>) {
  return (
    <section className={joinClassNames("product-panel", className)} id={id}>
      {title || description || aside ? (
        <header className="product-panel-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? (
              <div className="product-panel-description">{description}</div>
            ) : null}
          </div>
          {aside ? <div className="product-panel-aside">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function ProductMetric({
  detail,
  label,
  tone = "default",
  value,
}: Readonly<{
  detail?: ReactNode;
  label: ReactNode;
  tone?: ProductTone;
  value: ReactNode;
}>) {
  return (
    <article className={joinClassNames("product-metric", `tone-${tone}`)}>
      <div className="product-metric-label">{label}</div>
      <div className="product-metric-value">{value}</div>
      {detail ? <div className="product-metric-detail">{detail}</div> : null}
    </article>
  );
}

type ProductSignalItem = Readonly<{
  description: ReactNode;
  id: string;
  title: ReactNode;
  tone?: "info" | "warn" | "bad";
}>;

export function ProductSignalList({
  items,
  label,
}: Readonly<{
  items: readonly ProductSignalItem[];
  label: string;
}>) {
  return (
    <div aria-label={label} className="product-signal-list" role="list">
      {items.map((item) => (
        <div
          className={joinClassNames(
            "product-signal",
            item.tone && item.tone !== "info" ? item.tone : undefined,
          )}
          key={item.id}
          role="listitem"
        >
          <strong>{item.title}</strong>
          <small>{item.description}</small>
        </div>
      ))}
    </div>
  );
}

type ProductSignalMetric = Readonly<{
  id: string;
  label: ReactNode;
  value: ReactNode;
}>;

export function ProductSignalGrid({
  items,
  label,
}: Readonly<{
  items: readonly ProductSignalMetric[];
  label: string;
}>) {
  return (
    <div aria-label={label} className="product-signal-grid" role="list">
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ProductTag({
  children,
  tone = "default",
}: Readonly<{ children: ReactNode; tone?: ProductTone }>) {
  return (
    <span className={joinClassNames("product-tag", `tone-${tone}`)}>
      {children}
    </span>
  );
}

export function ProductProgress({
  label,
  tone = "info",
  value,
}: Readonly<{
  label: string;
  tone?: ProductTone;
  value: number;
}>) {
  const clamped = Math.min(
    100,
    Math.max(0, Number.isFinite(value) ? value : 0),
  );
  return (
    <div
      className="product-progress"
      aria-label={`${label} ${Math.round(clamped)}%`}
    >
      <span className="product-progress-track">
        <span
          className={joinClassNames("product-progress-value", `tone-${tone}`)}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="product-progress-label">{label}</span>
      <strong>{Math.round(clamped)}%</strong>
    </div>
  );
}

export function ProductSparkline({
  label,
  values,
}: Readonly<{ label: string; values: readonly number[] }>) {
  const safeValues = values.length ? values : [0];
  let min = safeValues[0] ?? 0;
  let max = safeValues[0] ?? 0;
  for (const value of safeValues) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min || 1;
  const points = safeValues
    .map((value, index) => {
      const x =
        safeValues.length === 1 ? 50 : (index / (safeValues.length - 1)) * 100;
      const y = 37 - ((value - min) / span) * 31;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className="product-sparkline"
      viewBox="0 0 100 42"
      role="img"
      aria-label={label}
    >
      <path d="M0 37H100M0 21H100M0 5H100" className="product-chart-grid" />
      <polyline points={points} className="product-chart-line" />
    </svg>
  );
}

export function ProductBarChart({
  items,
  label,
}: Readonly<{
  items: readonly Readonly<{ label: string; value: number }>[];
  label: string;
}>) {
  let max = 1;
  for (const item of items) max = Math.max(max, item.value);
  return (
    <div className="product-bar-chart" role="img" aria-label={label}>
      {items.map((item) => (
        <div className="product-bar-column" key={item.label}>
          <span>{item.value}</span>
          <i style={{ height: `${Math.max(6, (item.value / max) * 100)}%` }} />
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

export function ProductEmptyState({
  action,
  description,
  icon = "◇",
  title,
}: Readonly<{
  action?: ReactNode;
  description: ReactNode;
  icon?: string;
  title: ReactNode;
}>) {
  const iconName = EMPTY_STATE_ICON_MAP[icon] ?? "archive";
  return (
    <div className="product-empty-state">
      <span className="product-empty-icon" aria-hidden="true">
        <AppIcon name={iconName} size={20} />
      </span>
      <h3>{title}</h3>
      <div>{description}</div>
      {action ? <div className="product-empty-action">{action}</div> : null}
    </div>
  );
}

export function ProductDisclosure({
  children,
  className,
  defaultOpen = false,
  description,
  id,
  summary,
}: Readonly<{
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  description?: ReactNode;
  id?: string;
  summary: ReactNode;
}>) {
  return (
    <details
      className={joinClassNames("product-disclosure", className)}
      id={id}
      open={defaultOpen}
    >
      <summary>
        <span>
          <strong>{summary}</strong>
          {description ? <small>{description}</small> : null}
        </span>
        <span aria-hidden="true">
          <AppIcon name="chevron-down" size={15} />
        </span>
      </summary>
      <div className="product-disclosure-body">{children}</div>
    </details>
  );
}

export function ProductHero({
  actions,
  badge,
  children,
  progressLabel,
  progressValue,
  title,
}: Readonly<{
  actions?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  progressLabel?: string;
  progressValue?: number;
  title: ReactNode;
}>) {
  const safeProgress = Math.min(100, Math.max(0, progressValue ?? 0));
  return (
    <section className="product-hero">
      <div>
        {badge ? <div className="product-hero-badge">{badge}</div> : null}
        <h2>{title}</h2>
        <div className="product-hero-description">{children}</div>
        {actions ? <div className="product-hero-actions">{actions}</div> : null}
      </div>
      {progressLabel ? (
        <div
          className="product-orbit"
          aria-label={`${progressLabel} ${Math.round(safeProgress)}%`}
        >
          <i className="orbit-one" />
          <i className="orbit-two" />
          <i className="orbit-three" />
          <strong>{Math.round(safeProgress)}%</strong>
          <small>{progressLabel}</small>
        </div>
      ) : null}
    </section>
  );
}

type ProductWorkflowStepState =
  | "complete"
  | "current"
  | "pending"
  | "attention";

type ProductWorkflowStep = Readonly<{
  detail: ReactNode;
  label: ReactNode;
  state: ProductWorkflowStepState;
}>;

const WORKFLOW_STEP_LABELS: Readonly<Record<ProductWorkflowStepState, string>> =
  {
    attention: "需处理",
    complete: "已完成",
    current: "当前",
    pending: "待开始",
  };

const WORKFLOW_STEP_TONES: Readonly<
  Record<ProductWorkflowStepState, ProductTone>
> = {
  attention: "warn",
  complete: "good",
  current: "info",
  pending: "default",
};

export function ProductWorkflowStage({
  actions,
  badge,
  children,
  steps,
  stepsLabel,
  title,
}: Readonly<{
  actions?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  steps: readonly ProductWorkflowStep[];
  stepsLabel: string;
  title: ReactNode;
}>) {
  return (
    <section className="product-workflow-stage">
      <div className="product-workflow-copy">
        {badge ? <div className="product-hero-badge">{badge}</div> : null}
        <h2>{title}</h2>
        <div className="product-workflow-description">{children}</div>
        {actions ? <div className="product-hero-actions">{actions}</div> : null}
      </div>
      <ol className="product-workflow-steps" aria-label={stepsLabel}>
        {steps.map((step, index) => (
          <li
            className={`state-${step.state}`}
            key={`${index}-${String(step.label)}`}
          >
            <span className="product-workflow-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="product-workflow-step-copy">
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
            <ProductTag tone={WORKFLOW_STEP_TONES[step.state]}>
              {WORKFLOW_STEP_LABELS[step.state]}
            </ProductTag>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ProductTaskRow({
  aside,
  description,
  icon,
  title,
}: Readonly<{
  aside?: ReactNode;
  description?: ReactNode;
  icon: ReactNode;
  title: ReactNode;
}>) {
  return (
    <div className="product-task-row">
      <span className="product-task-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      {aside ? <div className="product-task-aside">{aside}</div> : null}
    </div>
  );
}

type ProductMarkdownLine = Readonly<{
  kind:
    | "boundary"
    | "code"
    | "heading-2"
    | "heading-3"
    | "heading-4"
    | "quote"
    | "list"
    | "spacer"
    | "paragraph";
  value: string;
}>;

function parseMarkdownLines(value: string): ProductMarkdownLine[] {
  let codeBlock = false;
  return value.split(/\r?\n/).map((line) => {
    if (line.trimStart().startsWith("```")) {
      codeBlock = !codeBlock;
      return { kind: "boundary", value: "" };
    }
    if (codeBlock) return { kind: "code", value: line || " " };
    if (line.startsWith("### "))
      return { kind: "heading-4", value: line.slice(4) };
    if (line.startsWith("## "))
      return { kind: "heading-3", value: line.slice(3) };
    if (line.startsWith("# "))
      return { kind: "heading-2", value: line.slice(2) };
    if (line.startsWith("> ")) return { kind: "quote", value: line.slice(2) };
    if (/^[-*] /.test(line))
      return { kind: "list", value: `• ${line.slice(2)}` };
    if (/^\d+\. /.test(line)) return { kind: "list", value: line };
    if (!line.trim()) return { kind: "spacer", value: "" };
    return { kind: "paragraph", value: line };
  });
}

export function ProductMarkdownPreview({ value }: Readonly<{ value: string }>) {
  const lines = parseMarkdownLines(value);

  return (
    <div className="product-markdown-preview">
      {lines.map((line, index) => {
        const key = `${index}-${line.value.slice(0, 16)}`;
        if (line.kind === "boundary") {
          return (
            <span
              className="product-markdown-code-boundary"
              key={key}
              aria-hidden="true"
            />
          );
        }
        if (line.kind === "code") return <code key={key}>{line.value}</code>;
        if (line.kind === "heading-4") return <h4 key={key}>{line.value}</h4>;
        if (line.kind === "heading-3") return <h3 key={key}>{line.value}</h3>;
        if (line.kind === "heading-2") return <h2 key={key}>{line.value}</h2>;
        if (line.kind === "quote")
          return <blockquote key={key}>{line.value}</blockquote>;
        if (line.kind === "list")
          return (
            <div className="product-markdown-list-item" key={key}>
              {line.value}
            </div>
          );
        if (line.kind === "spacer")
          return <span className="product-markdown-spacer" key={key} />;
        return <p key={key}>{line.value}</p>;
      })}
    </div>
  );
}
