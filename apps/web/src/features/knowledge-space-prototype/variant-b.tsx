/* ============================================================
   knowledge-space-prototype / variant-b.tsx
   Variant B — Evidence Command Center.
   Dashboard-style layout with detailed evidence management.
   ============================================================ */

"use client";

import type { EvidenceItem, ProjectionSlot } from "./mock-data";
import type { MockState } from "./use-mock-state";
import { useState, useRef, useEffect } from "react";
import "./prototype.css";

/* ---------- helpers ---------- */

function statusLabel(status: EvidenceItem["status"]): string {
  const map: Record<EvidenceItem["status"], string> = {
    accepted: "已采纳",
    suggested: "建议中",
    rejected: "已拒绝",
    pending_review: "待审查",
  };
  return map[status];
}

function statusBadgeClass(status: EvidenceItem["status"]): string {
  return `ks-badge--${status}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

/* ---------- Evidence Card (B variant - more detailed) ---------- */

function EvidenceCardB({
  item,
  selected,
  onSelect,
  onAccept,
  onReject,
  onEdit,
}: {
  item: EvidenceItem;
  selected: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  return (
    <article
      className={`ks-card ks-card--${item.status} ${selected ? "ks-card--selected" : ""}`}
      aria-label={`${item.title} — ${statusLabel(item.status)}`}
    >
      <div className="ks-card__header">
        <h3 className="ks-card__title">{item.title}</h3>
        <span className={`ks-badge ${statusBadgeClass(item.status)}`}>
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="ks-card__meta">
        {item.source} · {formatDate(item.suggestedAt)}
        {item.onlineOnly && <span style={{ marginLeft: 8 }}>🔒 仅在线</span>}
        {item.locked && <span style={{ marginLeft: 8 }}>🔐 已锁定</span>}
      </div>

      <p className="ks-card__summary">{item.summary}</p>

      {/* Confidence + status indicators */}
      <div className="ks-flex-row ks-gap-md" style={{ marginBottom: 8 }}>
        <div className="ks-confidence">
          <span>置信度</span>
          <div className="ks-confidence__bar">
            <div
              className="ks-confidence__fill"
              style={{ width: `${Math.round(item.confidence * 100)}%` }}
            />
          </div>
          <span>{Math.round(item.confidence * 100)}%</span>
        </div>
        {item.status === "suggested" && (
          <span className="ks-badge ks-badge--suggested" style={{ fontSize: 10 }}>
            待决
          </span>
        )}
      </div>

      <div className="ks-card__footer">
        <div className="ks-card__tags">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="ks-tag">
              {tag}
            </span>
          ))}
        </div>

        <div className="ks-card__actions">
          <button
            type="button"
            className={`ks-btn ks-btn--small ${selected ? "ks-btn--primary" : ""}`}
            aria-pressed={selected}
            onClick={onSelect}
          >
            {selected ? "已选择" : "选择"}
          </button>
          {item.status !== "accepted" && (
            <button
              className="ks-btn ks-btn--primary ks-btn--small"
              onClick={(e) => {
                e.stopPropagation();
                onAccept();
              }}
            >
              采纳
            </button>
          )}
          {item.status !== "rejected" && (
            <button
              className="ks-btn ks-btn--danger ks-btn--small"
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
            >
              拒绝
            </button>
          )}
          <button
            className="ks-btn ks-btn--small"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            编辑
          </button>
        </div>
      </div>

      {item.status === "rejected" && item.rejectReason && (
        <p
          style={{
            margin: "8px 0 0 0",
            fontSize: 12,
            color: "var(--ks-danger)",
            fontStyle: "italic",
          }}
        >
          原因：{item.rejectReason}
        </p>
      )}
    </article>
  );
}

/* ---------- Evidence Detail (B variant - full-width) ---------- */

function EvidenceDetailB({
  item,
  onAccept,
  onReject,
  onEdit,
  onClose,
}: {
  item: EvidenceItem;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ks-detail-panel" role="region" aria-label="完整证据详情">
      <div className="ks-detail-panel__header">
        <div>
          <span className={`ks-badge ${statusBadgeClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
          <h2 className="ks-detail-panel__title" style={{ marginTop: 8 }}>
            {item.title}
          </h2>
        </div>
        <button className="ks-btn ks-btn--icon" onClick={onClose} aria-label="关闭详情">
          ✕
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div className="ks-detail-panel__section">
            <h3 className="ks-detail-panel__section-title">来源</h3>
            <a
              className="ks-source-link"
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.source} ↗
            </a>
          </div>

          <div className="ks-detail-panel__section">
            <h3 className="ks-detail-panel__section-title">摘要</h3>
            <p className="ks-detail-panel__text">{item.summary}</p>
          </div>

          <div className="ks-detail-panel__section">
            <h3 className="ks-detail-panel__section-title">标签</h3>
            <div className="ks-card__tags">
              {item.tags.map((tag) => (
                <span key={tag} className="ks-tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="ks-detail-panel__section">
            <h3 className="ks-detail-panel__section-title">置信度评分</h3>
            <div className="ks-confidence" style={{ gap: 8 }}>
              <div className="ks-confidence__bar" style={{ width: "100%", height: 8 }}>
                <div
                  className="ks-confidence__fill"
                  style={{ width: `${Math.round(item.confidence * 100)}%`, height: 8 }}
                />
              </div>
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                {Math.round(item.confidence * 100)}%
              </span>
            </div>
          </div>

          <div className="ks-detail-panel__section">
            <h3 className="ks-detail-panel__section-title">时间线</h3>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 0", color: "var(--ks-text-tertiary)" }}>建议</td>
                  <td style={{ padding: "4px 0" }}>{formatDate(item.suggestedAt)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 0", color: "var(--ks-text-tertiary)" }}>采纳</td>
                  <td style={{ padding: "4px 0" }}>{formatDate(item.acceptedAt)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 0", color: "var(--ks-text-tertiary)" }}>拒绝</td>
                  <td style={{ padding: "4px 0" }}>{formatDate(item.rejectedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {item.status === "rejected" && item.rejectReason && (
            <div className="ks-detail-panel__section">
              <h3 className="ks-detail-panel__section-title">拒绝原因</h3>
              <p className="ks-detail-panel__text" style={{ color: "var(--ks-danger)" }}>
                {item.rejectReason}
              </p>
            </div>
          )}

          {item.onlineOnly && (
            <div className="ks-detail-panel__section">
              <span className="ks-badge ks-badge--pending_review">仅在线查看</span>
              <p className="ks-detail-panel__text" style={{ marginTop: 4, fontSize: 12 }}>
                此内容需要网络连接才能查看。
              </p>
            </div>
          )}

          {item.locked && (
            <div className="ks-detail-panel__section">
              <span className="ks-badge ks-badge--rejected">已锁定 — 需要解密密钥</span>
              <p className="ks-detail-panel__text" style={{ marginTop: 4, fontSize: 12 }}>
                此内容使用端到端加密保护。请提供解密密钥以查看。
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="ks-flex-row ks-gap-md" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--ks-border-light)" }}>
        {item.status !== "accepted" && (
          <button className="ks-btn ks-btn--primary" onClick={onAccept}>
            采纳证据
          </button>
        )}
        {item.status !== "rejected" && (
          <button className="ks-btn ks-btn--danger" onClick={onReject}>
            拒绝证据
          </button>
        )}
        <button className="ks-btn" onClick={onEdit}>
          编辑条目
        </button>
      </div>
    </div>
  );
}

/* ---------- Graph View (B - more detailed) ---------- */

function DetailedGraph({
  items,
  onNodeClick,
}: {
  items: EvidenceItem[];
  onNodeClick: (id: string) => void;
}) {
  const accepted = items.filter((i) => i.status === "accepted");
  const suggested = items.filter(
    (i) => i.status === "suggested" || i.status === "pending_review",
  );
  const rejected = items.filter((i) => i.status === "rejected");

  const w = 600;
  const h = 320;
  const layers = [
    { label: "已采纳", items: accepted, color: "var(--ks-graph-node-accepted)", cy: 100 },
    { label: "建议中", items: suggested, color: "var(--ks-graph-node-suggested)", cy: 200 },
    { label: "已拒绝", items: rejected, color: "var(--ks-graph-node-rejected)", cy: 280 },
  ];

  return (
    <div className="ks-graph-container" role="img" aria-label="详细知识图谱">
      <svg viewBox={`0 0 ${w} ${h}`} className="ks-graph-svg" aria-hidden="true">
        {/* Vertical axis */}
        <line
          x1={40}
          y1={60}
          x2={40}
          y2={300}
          stroke="var(--ks-graph-edge)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {layers.map((layer, li) => {
          const cx = 120;
          const spacing = Math.min(80, (w - 160) / Math.max(layer.items.length, 1));
          return (
            <g key={layer.label}>
              {/* Layer label */}
              <text
                x={20}
                y={layer.cy + 4}
                textAnchor="start"
                fontSize={11}
                fill="var(--ks-text-tertiary)"
              >
                {layer.label}
              </text>

              {/* Nodes */}
              {layer.items.map((item, ii) => {
                const nx = cx + ii * spacing;
                const ny = layer.cy;
                const r = Math.max(12, Math.min(24, 18 + item.confidence * 8));
                return (
                  <g
                    key={item.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => onNodeClick(item.id)}
                  >
                    <circle
                      cx={nx}
                      cy={ny}
                      r={r}
                      fill={layer.color}
                      fillOpacity={0.2}
                      stroke={layer.color}
                      strokeWidth={2}
                    />
                    <text
                      x={nx}
                      y={ny + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fill="var(--ks-text)"
                      style={{ pointerEvents: "none" }}
                    >
                      {item.title.length > 10
                        ? item.title.slice(0, 10) + "…"
                        : item.title}
                    </text>
                  </g>
                );
              })}

              {/* Connecting lines between layers */}
              {li > 0 &&
                layer.items.map((_, ii) => {
                  const prevLayer = layers[li - 1]!;
                  if (prevLayer.items.length === 0) return null;
                  const pi = ii % prevLayer.items.length;
                  return (
                    <line
                      key={`conn-${li}-${ii}`}
                      x1={cx + ii * spacing}
                      y1={prevLayer.cy + 20}
                      x2={cx + pi * spacing}
                      y2={layer.cy - 20}
                      stroke="var(--ks-graph-edge)"
                      strokeWidth={0.5}
                      strokeDasharray="2 2"
                      opacity={0.5}
                    />
                  );
                })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- Mobile Tree (B variant) ---------- */

function MobileTreeB({
  items,
  onSelect,
  selectedId,
}: {
  items: EvidenceItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    accepted: true,
    suggested: true,
    rejected: true,
  });

  const toggle = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const accepted = items.filter((i) => i.status === "accepted");
  const suggested = items.filter(
    (i) => i.status === "suggested" || i.status === "pending_review",
  );
  const rejected = items.filter((i) => i.status === "rejected");

  const sections = [
    { key: "suggested", label: "待处理", count: suggested.length, badge: "ks-badge--suggested", data: suggested },
    { key: "accepted", label: "已采纳", count: accepted.length, badge: "ks-badge--accepted", data: accepted },
    { key: "rejected", label: "已拒绝", count: rejected.length, badge: "ks-badge--rejected", data: rejected },
  ];

  return (
    <ul className="ks-tree" role="tree" aria-label="知识条目分类">
      {sections
        .filter((s) => s.data.length > 0)
        .map((section) => (
          <li key={section.key} className="ks-tree__item" role="treeitem" aria-expanded={expandedSections[section.key]} aria-selected={false}>
            <button
              className="ks-tree__button"
              onClick={() => toggle(section.key)}
            >
              <span aria-hidden="true">
                {expandedSections[section.key] ? "▾" : "▸"}
              </span>
              <span className={`ks-badge ${section.badge}`} style={{ fontSize: 10 }}>
                {section.label}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ks-text-tertiary)" }}>
                {section.count}
              </span>
            </button>
            {expandedSections[section.key] && (
              <ul className="ks-tree__children" role="group">
                {section.data.map((item) => (
                  <li key={item.id} className="ks-tree__leaf" role="treeitem" aria-selected={selectedId === item.id}>
                    <button
                      className="ks-btn ks-btn--small"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        textAlign: "left",
                        fontWeight: selectedId === item.id ? 600 : 400,
                        color: "var(--ks-text)",
                        padding: "8px 12px",
                      }}
                      onClick={() => onSelect(item.id)}
                    >
                      <div>
                        <div>{item.title}</div>
                        <div style={{ fontSize: 11, color: "var(--ks-text-tertiary)", marginTop: 2 }}>
                          {item.source} · {Math.round(item.confidence * 100)}%
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
    </ul>
  );
}

/* ---------- Reject Modal ---------- */

function RejectModal({
  item,
  onConfirm,
  onClose,
}: {
  item: EvidenceItem;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ks-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="拒绝证据"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ks-modal" ref={ref} tabIndex={-1}>
        <h2 className="ks-modal__title">拒绝证据</h2>
        <p style={{ fontSize: 14, color: "var(--ks-text-secondary)", marginBottom: 12 }}>
          {item.title}
        </p>
        <div>
          <label className="ks-label" htmlFor="reject-reason">
            拒绝原因（可选）
          </label>
          <textarea
            id="reject-reason"
            className="ks-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明拒绝此证据的原因…"
          />
        </div>
        <div className="ks-modal__actions">
          <button className="ks-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="ks-btn ks-btn--danger"
            onClick={() => onConfirm(reason)}
          >
            确认拒绝
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Edit Modal (B variant) ---------- */

function EditModalB({
  item,
  onSave,
  onClose,
}: {
  item: EvidenceItem;
  onSave: (updates: Partial<EvidenceItem>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [summary, setSummary] = useState(item.summary);
  const [tags, setTags] = useState(item.tags.join(", "));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="ks-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="编辑证据"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ks-modal" ref={ref} tabIndex={-1}>
        <h2 className="ks-modal__title">编辑证据</h2>
        <div className="ks-flex-col ks-gap-md">
          <div>
            <label className="ks-label" htmlFor="edit-title-b">标题</label>
            <input
              id="edit-title-b"
              className="ks-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="ks-label" htmlFor="edit-summary-b">摘要</label>
            <textarea
              id="edit-summary-b"
              className="ks-textarea"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <label className="ks-label" htmlFor="edit-tags-b">标签（逗号分隔）</label>
            <input
              id="edit-tags-b"
              className="ks-input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
        </div>
        <div className="ks-modal__actions">
          <button className="ks-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="ks-btn ks-btn--primary"
            onClick={() => {
              onSave({
                title,
                summary,
                tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
              });
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Source / Evidence Timeline ---------- */

function EvidenceTimeline({ items }: { items: EvidenceItem[] }) {
  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.suggestedAt).getTime() - new Date(a.suggestedAt).getTime(),
  );

  return (
    <div className="ks-flex-col ks-gap-md">
      {sorted.slice(0, 5).map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            gap: 12,
            padding: "8px 0",
            borderBottom: "1px solid var(--ks-border-light)",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              marginTop: 6,
              flexShrink: 0,
              background:
                item.status === "accepted"
                  ? "var(--ks-success)"
                  : item.status === "rejected"
                    ? "var(--ks-danger)"
                    : "var(--ks-warning)",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ks-text)" }}>
              {item.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ks-text-tertiary)",
                marginTop: 2,
              }}
            >
              {item.source} · {formatDate(item.suggestedAt)}
            </div>
          </div>
          <span className={`ks-badge ${statusBadgeClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Variant B Main Component ---------- */

export function VariantB(state: MockState) {
  const [editingItem, setEditingItem] = useState<EvidenceItem | null>(null);
  const [rejectingItem, setRejectingItem] = useState<EvidenceItem | null>(null);

  const {
    items,
    projection,
    switchProjection,
    selectedItem,
    selectedItemId,
    setSelectedItemId,
    loading,
    error,
    online,
    data,
    acceptItem,
    rejectItem,
    editItem,
  } = state;

  return (
    <div className="prototype-container" role="region" aria-label="知识空间原型 B">
      {/* Toolbar */}
      <div className="ks-toolbar" role="toolbar" aria-label="命令中心工具栏">
        <div className="ks-toolbar__left">
          <div className="ks-tabs" role="tablist" aria-label="时间投影">
            {(["today", "review", "records"] as ProjectionSlot[]).map(
              (slot) => (
                <button
                  key={slot}
                  className="ks-tab"
                  role="tab"
                  aria-selected={projection === slot}
                  aria-controls={`panel-b-${slot}`}
                  id={`tab-b-${slot}`}
                  onClick={() => switchProjection(slot)}
                >
                  {slot === "today"
                    ? "今日"
                    : slot === "review"
                      ? "审查"
                      : "记录"}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="ks-toolbar__right">
          <label className="ks-online-toggle">
            <input
              type="checkbox"
              checked={online}
              onChange={() => {}}
              aria-label="在线状态"
              style={{ accentColor: "var(--ks-accent)" }}
            />
            <span
              className={`ks-status-dot ${online ? "ks-status-dot--online" : "ks-status-dot--offline"}`}
              aria-hidden="true"
            />
            {online ? "在线" : "离线"}
          </label>
        </div>
      </div>

      {/* Dashboard metrics */}
      <div className="ks-metrics">
        <div className="ks-metric">
          <div className="ks-metric__value">{data.progress.total}</div>
          <div className="ks-metric__label">证据总数</div>
        </div>
        <div className="ks-metric">
          <div className="ks-metric__value" style={{ color: "var(--ks-success)" }}>
            {data.progress.accepted}
          </div>
          <div className="ks-metric__label">已采纳</div>
        </div>
        <div className="ks-metric">
          <div className="ks-metric__value" style={{ color: "var(--ks-warning)" }}>
            {data.progress.suggested}
          </div>
          <div className="ks-metric__label">待处理</div>
        </div>
        <div className="ks-metric">
          <div className="ks-metric__value" style={{ color: "var(--ks-danger)" }}>
            {data.progress.rejected}
          </div>
          <div className="ks-metric__label">已拒绝</div>
        </div>
        <div className="ks-metric">
          <div className="ks-metric__value">
            {data.progress.total > 0
              ? Math.round(
                  (data.progress.accepted / data.progress.total) * 100,
                )
              : 0}
            %
          </div>
          <div className="ks-metric__label">采纳率</div>
        </div>
      </div>

      {/* Progress bar */}
      <div
        className="ks-progress"
        role="progressbar"
        aria-valuenow={data.progress.accepted}
        aria-valuemin={0}
        aria-valuemax={data.progress.total}
        aria-label="整体进度"
        style={{ marginBottom: 24 }}
      >
        <div
          className="ks-progress__bar ks-progress__bar--accepted"
          style={{
            width: `${data.progress.total > 0 ? (data.progress.accepted / data.progress.total) * 100 : 0}%`,
          }}
        />
        <div
          className="ks-progress__bar ks-progress__bar--suggested"
          style={{
            width: `${data.progress.total > 0 ? (data.progress.suggested / data.progress.total) * 100 : 0}%`,
          }}
        />
        <div
          className="ks-progress__bar ks-progress__bar--rejected"
          style={{
            width: `${data.progress.total > 0 ? (data.progress.rejected / data.progress.total) * 100 : 0}%`,
          }}
        />
      </div>

      {/* Loading state */}
      {loading && (
        <div className="ks-state" role="status" aria-label="加载中">
          <div className="ks-spinner" aria-hidden="true" />
          <p className="ks-state__description">正在加载证据命令中心…</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="ks-state" role="alert">
          <div className="ks-state__icon" aria-hidden="true">⚠</div>
          <h2 className="ks-state__title">数据加载失败</h2>
          <p className="ks-state__description">{error}</p>
          <div className="ks-flex-row ks-gap-md">
            <button
              className="ks-btn ks-btn--primary"
              onClick={() => state.simulateLoading()}
            >
              重试
            </button>
            <button
              className="ks-btn"
              onClick={() => state.simulateError()}
            >
              模拟错误
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div className="ks-state">
          <div className="ks-state__icon" aria-hidden="true">📋</div>
          <h2 className="ks-state__title">无数据</h2>
          <p className="ks-state__description">
            {projection === "today"
              ? "今日暂无待处理的证据。"
              : projection === "review"
                ? "所有证据已审查。"
                : "记录为空。"}
          </p>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && items.length > 0 && (
        <>
          {/* Desktop: detailed graph */}
          <div className="ks-desktop-only" style={{ marginBottom: 24 }}>
            <h2 className="ks-heading ks-heading--lg">证据图谱</h2>
            <DetailedGraph
              items={items}
              onNodeClick={setSelectedItemId}
            />
            <div className="ks-legend">
              <div className="ks-legend__item">
                <span className="ks-legend__swatch ks-legend__swatch--accepted" />
                已采纳
              </div>
              <div className="ks-legend__item">
                <span className="ks-legend__swatch ks-legend__swatch--suggested" />
                建议中
              </div>
              <div className="ks-legend__item">
                <span className="ks-legend__swatch ks-legend__swatch--rejected" />
                已拒绝
              </div>
            </div>
          </div>

          {/* Mobile: tree */}
          <div className="ks-mobile-only" style={{ marginBottom: 16 }}>
            <h2 className="ks-heading">证据分类</h2>
            <MobileTreeB
              items={items}
              onSelect={setSelectedItemId}
              selectedId={selectedItemId}
            />
          </div>

          {/* Three-column dashboard layout */}
          <div
            className="ks-layout-b"
            role="tabpanel"
            id={`panel-b-${projection}`}
            aria-labelledby={`tab-b-${projection}`}
          >
            {/* Column 1: Evidence list */}
            <div>
              <h2 className="ks-heading">
                {projection === "today"
                  ? "今日证据"
                  : projection === "review"
                    ? "审查队列"
                    : "全部证据"}
              </h2>
              <div className="ks-evidence-list" role="list" aria-label="证据列表">
                {items.map((item) => (
                  <div key={item.id} role="listitem">
                    <EvidenceCardB
                      item={item}
                      selected={selectedItemId === item.id}
                      onSelect={() => setSelectedItemId(item.id)}
                      onAccept={() => acceptItem(item.id)}
                      onReject={() => setRejectingItem(item)}
                      onEdit={() => setEditingItem(item)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Column 2: Detail / source info */}
            <div>
              {selectedItem ? (
                <>
                  <h2 className="ks-heading">证据详情</h2>
                  <EvidenceDetailB
                    item={selectedItem}
                    onAccept={() => acceptItem(selectedItem.id)}
                    onReject={() => setRejectingItem(selectedItem)}
                    onEdit={() => setEditingItem(selectedItem)}
                    onClose={() => setSelectedItemId(null)}
                  />
                </>
              ) : (
                <div className="ks-state" style={{ padding: "48px 24px" }}>
                  <h2 className="ks-state__title">选择一条证据</h2>
                  <p className="ks-state__description">
                    点击左侧列表中的证据查看完整详情，包括来源、时间线和置信度评分。
                  </p>
                </div>
              )}
            </div>

            {/* Column 3: Timeline + conversation */}
            <div>
              <h2 className="ks-heading">最近活动</h2>
              <EvidenceTimeline items={items} />

              <div style={{ marginTop: 24 }}>
                <h2 className="ks-heading">相关对话</h2>
                <div className="ks-flex-col ks-gap-md">
                  {data.messages.slice(-3).map((msg) => (
                    <div
                      key={msg.id}
                      className={`ks-message ${msg.role === "user" ? "ks-message--user" : "ks-message--assistant"}`}
                    >
                      <strong style={{ fontSize: 11 }}>
                        {msg.role === "user" ? "你" : "助手"}
                      </strong>
                      <p style={{ margin: "4px 0 0 0", fontSize: 12 }}>
                        {msg.content.length > 120
                          ? msg.content.slice(0, 120) + "…"
                          : msg.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit modal */}
      {editingItem && (
        <EditModalB
          item={editingItem}
          onSave={(updates) => editItem(editingItem.id, updates)}
          onClose={() => setEditingItem(null)}
        />
      )}

      {/* Reject modal */}
      {rejectingItem && (
        <RejectModal
          item={rejectingItem}
          onConfirm={(reason) => {
            rejectItem(rejectingItem.id, reason);
            setRejectingItem(null);
          }}
          onClose={() => setRejectingItem(null)}
        />
      )}
    </div>
  );
}