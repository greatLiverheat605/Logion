/* ============================================================
   knowledge-space-prototype / variant-a.tsx
   Variant A — Quiet, action-oriented knowledge space.
   Clean, minimal design focused on what needs attention.
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

function cardBorderClass(item: EvidenceItem): string {
  if (item.locked) return "ks-card--locked";
  if (item.onlineOnly) return "ks-card--online-only";
  return `ks-card--${item.status}`;
}

/* ---------- Evidence Card ---------- */

function EvidenceCard({
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
      className={`ks-card ${cardBorderClass(item)} ${selected ? "ks-card--selected" : ""}`}
      aria-label={`${item.title} — ${statusLabel(item.status)}`}
    >
      <div className="ks-card__header">
        <h3 className="ks-card__title">{item.title}</h3>
        <span
          className={`ks-badge ${statusBadgeClass(item.status)}`}
          aria-label={`状态：${statusLabel(item.status)}`}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="ks-card__meta">
        {item.source} · {formatDate(item.suggestedAt)}
      </div>

      <p className="ks-card__summary">{item.summary}</p>

      <div className="ks-card__footer">
        <div className="ks-card__tags" role="list" aria-label="标签">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="ks-tag" role="listitem">
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
          {item.status !== "accepted" && item.status !== "rejected" ? (
            <>
              <button
                type="button"
                className="ks-btn ks-btn--primary ks-btn--small"
                aria-label={`采纳：${item.title}`}
                onClick={onAccept}
              >
                采纳
              </button>
              <button
                type="button"
                className="ks-btn ks-btn--danger ks-btn--small"
                aria-label={`拒绝：${item.title}`}
                onClick={onReject}
              >
                拒绝
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ks-btn ks-btn--small"
            aria-label={`编辑：${item.title}`}
            onClick={onEdit}
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

      <div className="ks-flex-row ks-gap-sm" style={{ marginTop: 8 }}>
        {item.onlineOnly && (
          <span
            className="ks-badge ks-badge--pending_review"
            style={{ fontSize: 10 }}
          >
            仅在线
          </span>
        )}
        {item.locked && (
          <span
            className="ks-badge ks-badge--rejected"
            style={{ fontSize: 10 }}
          >
            已锁定
          </span>
        )}
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
      </div>
    </article>
  );
}

/* ---------- Simple SVG Graph ---------- */

function SimpleGraph({
  items,
  onNodeClick,
}: {
  items: EvidenceItem[];
  onNodeClick: (id: string) => void;
}) {
  const accepted = items.filter((i) => i.status === "accepted").length;
  const suggested = items.filter(
    (i) => i.status === "suggested" || i.status === "pending_review",
  ).length;
  const rejected = items.filter((i) => i.status === "rejected").length;
  const total = items.length;

  const cx = 200;
  const cy = 140;

  return (
    <div className="ks-graph-container" role="img" aria-label="知识图谱概览">
      <svg viewBox="0 0 400 280" className="ks-graph-svg" aria-hidden="true">
        {/* Connecting lines */}
        <line
          x1={cx - 120}
          y1={cy}
          x2={cx - 10}
          y2={cy}
          stroke="var(--ks-graph-edge)"
          strokeWidth={1}
        />
        <line
          x1={cx + 10}
          y1={cy}
          x2={cx + 120}
          y2={cy}
          stroke="var(--ks-graph-edge)"
          strokeWidth={1}
        />
        <line
          x1={cx}
          y1={cy - 60}
          x2={cx}
          y2={cy - 110}
          stroke="var(--ks-graph-edge)"
          strokeWidth={1}
        />

        {/* Accepted cluster */}
        <circle
          cx={cx - 120}
          cy={cy}
          r={40}
          fill="var(--ks-graph-node-accepted)"
          fillOpacity={0.15}
          stroke="var(--ks-graph-node-accepted)"
          strokeWidth={2}
          style={{ cursor: "pointer" }}
          onClick={() => onNodeClick("concept-1")}
        />
        <text
          x={cx - 120}
          y={cy - 6}
          textAnchor="middle"
          fontSize={24}
          fontWeight={700}
          fill="var(--ks-graph-node-accepted)"
          style={{ pointerEvents: "none" }}
        >
          {accepted}
        </text>
        <text
          x={cx - 120}
          y={cy + 14}
          textAnchor="middle"
          fontSize={10}
          fill="var(--ks-text-tertiary)"
          style={{ pointerEvents: "none" }}
        >
          已采纳
        </text>

        {/* Suggested cluster */}
        <circle
          cx={cx + 120}
          cy={cy}
          r={40}
          fill="var(--ks-graph-node-suggested)"
          fillOpacity={0.15}
          stroke="var(--ks-graph-node-suggested)"
          strokeWidth={2}
          style={{ cursor: "pointer" }}
          onClick={() => onNodeClick("concept-2")}
        />
        <text
          x={cx + 120}
          y={cy - 6}
          textAnchor="middle"
          fontSize={24}
          fontWeight={700}
          fill="var(--ks-graph-node-suggested)"
          style={{ pointerEvents: "none" }}
        >
          {suggested}
        </text>
        <text
          x={cx + 120}
          y={cy + 14}
          textAnchor="middle"
          fontSize={10}
          fill="var(--ks-text-tertiary)"
          style={{ pointerEvents: "none" }}
        >
          建议中
        </text>

        {/* Rejected cluster */}
        <circle
          cx={cx}
          cy={cy - 110}
          r={30}
          fill="var(--ks-graph-node-rejected)"
          fillOpacity={0.15}
          stroke="var(--ks-graph-node-rejected)"
          strokeWidth={2}
          style={{ cursor: "pointer" }}
          onClick={() => onNodeClick("concept-3")}
        />
        <text
          x={cx}
          y={cy - 116}
          textAnchor="middle"
          fontSize={20}
          fontWeight={700}
          fill="var(--ks-graph-node-rejected)"
          style={{ pointerEvents: "none" }}
        >
          {rejected}
        </text>
        <text
          x={cx}
          y={cy - 98}
          textAnchor="middle"
          fontSize={10}
          fill="var(--ks-text-tertiary)"
          style={{ pointerEvents: "none" }}
        >
          已拒绝
        </text>

        {/* Center node */}
        <circle
          cx={cx}
          cy={cy}
          r={16}
          fill="var(--ks-accent)"
          stroke="var(--ks-accent)"
          strokeWidth={2}
        />
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="white"
          style={{ pointerEvents: "none" }}
        >
          {total}
        </text>
      </svg>
    </div>
  );
}

/* ---------- Mobile Tree ---------- */

function MobileTree({
  items,
  onSelect,
  selectedId,
}: {
  items: EvidenceItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const accepted = items.filter((i) => i.status === "accepted");
  const pending = items.filter(
    (i) => i.status === "suggested" || i.status === "pending_review",
  );
  const rejected = items.filter((i) => i.status === "rejected");

  return (
    <ul className="ks-tree" role="tree" aria-label="知识条目树">
      <li
        className="ks-tree__item"
        role="treeitem"
        aria-expanded={expanded}
        aria-selected={false}
      >
        <button
          className="ks-tree__button"
          onClick={() => setExpanded(!expanded)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          所有条目
          <span className="ks-badge" style={{ marginLeft: "auto" }}>
            {items.length}
          </span>
        </button>
        {expanded && (
          <>
            {pending.length > 0 && (
              <ul className="ks-tree__children" role="group">
                <li
                  className="ks-tree__leaf"
                  role="treeitem"
                  aria-selected={false}
                >
                  <span className="ks-badge ks-badge--suggested">待处理</span>
                  <span>{pending.length} 条建议</span>
                </li>
                {pending.map((item) => (
                  <li
                    key={item.id}
                    className="ks-tree__leaf"
                    role="treeitem"
                    aria-selected={selectedId === item.id}
                  >
                    <button
                      className="ks-btn ks-btn--small"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        textAlign: "left",
                        fontWeight: selectedId === item.id ? 600 : 400,
                        color: "var(--ks-text)",
                      }}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {accepted.length > 0 && (
              <ul className="ks-tree__children" role="group">
                <li
                  className="ks-tree__leaf"
                  role="treeitem"
                  aria-selected={false}
                >
                  <span className="ks-badge ks-badge--accepted">已采纳</span>
                  <span>{accepted.length} 条证据</span>
                </li>
                {accepted.map((item) => (
                  <li
                    key={item.id}
                    className="ks-tree__leaf"
                    role="treeitem"
                    aria-selected={selectedId === item.id}
                  >
                    <button
                      className="ks-btn ks-btn--small"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        textAlign: "left",
                        fontWeight: selectedId === item.id ? 600 : 400,
                        color: "var(--ks-text)",
                      }}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {rejected.length > 0 && (
              <ul className="ks-tree__children" role="group">
                <li
                  className="ks-tree__leaf"
                  role="treeitem"
                  aria-selected={false}
                >
                  <span className="ks-badge ks-badge--rejected">已拒绝</span>
                  <span>{rejected.length} 条</span>
                </li>
                {rejected.map((item) => (
                  <li
                    key={item.id}
                    className="ks-tree__leaf"
                    role="treeitem"
                    aria-selected={selectedId === item.id}
                  >
                    <button
                      className="ks-btn ks-btn--small"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        textAlign: "left",
                        fontWeight: selectedId === item.id ? 600 : 400,
                        color: "var(--ks-text)",
                      }}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </li>
    </ul>
  );
}

/* ---------- Detail Panel ---------- */

function DetailPanel({
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
    <div className="ks-detail-panel" role="region" aria-label="证据详情">
      <div className="ks-detail-panel__header">
        <div>
          <span className={`ks-badge ${statusBadgeClass(item.status)}`}>
            {statusLabel(item.status)}
          </span>
          <h2 className="ks-detail-panel__title" style={{ marginTop: 8 }}>
            {item.title}
          </h2>
        </div>
        <button
          className="ks-btn ks-btn--icon"
          onClick={onClose}
          aria-label="关闭详情"
        >
          ✕
        </button>
      </div>

      <div className="ks-detail-panel__section">
        <h3 className="ks-detail-panel__section-title">来源</h3>
        <a
          className="ks-source-link"
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={0}
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

      <div className="ks-detail-panel__section">
        <h3 className="ks-detail-panel__section-title">置信度</h3>
        <div className="ks-confidence">
          <div className="ks-confidence__bar" style={{ width: 120, height: 6 }}>
            <div
              className="ks-confidence__fill"
              style={{
                width: `${Math.round(item.confidence * 100)}%`,
                height: 6,
              }}
            />
          </div>
          <span>{Math.round(item.confidence * 100)}%</span>
        </div>
      </div>

      <div className="ks-detail-panel__section">
        <h3 className="ks-detail-panel__section-title">时间线</h3>
        <p className="ks-detail-panel__text">
          建议日期：{formatDate(item.suggestedAt)}
          <br />
          采纳日期：{formatDate(item.acceptedAt)}
          <br />
          拒绝日期：{formatDate(item.rejectedAt)}
        </p>
      </div>

      {item.status === "rejected" && item.rejectReason && (
        <div className="ks-detail-panel__section">
          <h3 className="ks-detail-panel__section-title">拒绝原因</h3>
          <p
            className="ks-detail-panel__text"
            style={{ color: "var(--ks-danger)" }}
          >
            {item.rejectReason}
          </p>
        </div>
      )}

      {item.onlineOnly && (
        <div className="ks-detail-panel__section">
          <span className="ks-badge ks-badge--pending_review">仅在线查看</span>
        </div>
      )}

      {item.locked && (
        <div className="ks-detail-panel__section">
          <span className="ks-badge ks-badge--rejected">已锁定 — 需要解密</span>
        </div>
      )}

      <div className="ks-flex-row ks-gap-md" style={{ marginTop: 16 }}>
        {item.status !== "accepted" && (
          <button className="ks-btn ks-btn--primary" onClick={onAccept}>
            采纳
          </button>
        )}
        {item.status !== "rejected" && (
          <button className="ks-btn ks-btn--danger" onClick={onReject}>
            拒绝
          </button>
        )}
        <button className="ks-btn" onClick={onEdit}>
          编辑
        </button>
      </div>
    </div>
  );
}

/* ---------- Edit Modal ---------- */

function EditModal({
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
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    modalRef.current?.focus();
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
      <div className="ks-modal" ref={modalRef} tabIndex={-1}>
        <h2 className="ks-modal__title">编辑证据</h2>
        <div className="ks-flex-col ks-gap-md">
          <div>
            <label className="ks-label" htmlFor="edit-title">
              标题
            </label>
            <input
              id="edit-title"
              className="ks-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="ks-label" htmlFor="edit-summary">
              摘要
            </label>
            <textarea
              id="edit-summary"
              className="ks-textarea"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
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
              onSave({ title, summary });
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

/* ---------- Variant A Main Component ---------- */

export function VariantA(state: MockState) {
  const [editingItem, setEditingItem] = useState<EvidenceItem | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    <div
      className="prototype-container"
      role="region"
      aria-label="知识空间原型 A"
    >
      {/* Toolbar */}
      <div className="ks-toolbar" role="toolbar" aria-label="工具栏">
        <div className="ks-toolbar__left">
          <div className="ks-tabs" role="tablist" aria-label="时间投影">
            {(["today", "review", "records"] as ProjectionSlot[]).map(
              (slot) => (
                <button
                  key={slot}
                  className="ks-tab"
                  role="tab"
                  aria-selected={projection === slot}
                  aria-controls={`panel-a-${slot}`}
                  id={`tab-a-${slot}`}
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

      {/* Metrics */}
      <div className="ks-metrics" aria-label="统计概览">
        <div className="ks-metric">
          <div className="ks-metric__value">{data.progress.total}</div>
          <div className="ks-metric__label">总计</div>
        </div>
        <div className="ks-metric">
          <div
            className="ks-metric__value"
            style={{ color: "var(--ks-success)" }}
          >
            {data.progress.accepted}
          </div>
          <div className="ks-metric__label">已采纳</div>
        </div>
        <div className="ks-metric">
          <div
            className="ks-metric__value"
            style={{ color: "var(--ks-warning)" }}
          >
            {data.progress.suggested}
          </div>
          <div className="ks-metric__label">待处理</div>
        </div>
        <div className="ks-metric">
          <div
            className="ks-metric__value"
            style={{ color: "var(--ks-danger)" }}
          >
            {data.progress.rejected}
          </div>
          <div className="ks-metric__label">已拒绝</div>
        </div>
      </div>

      {/* Progress bar */}
      <div
        className="ks-progress"
        role="progressbar"
        aria-valuenow={data.progress.accepted}
        aria-valuemin={0}
        aria-valuemax={data.progress.total}
        aria-label="采纳进度"
        style={{ marginBottom: 16 }}
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
          <p className="ks-state__description">正在加载知识空间…</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="ks-state" role="alert">
          <div className="ks-state__icon" aria-hidden="true">
            !
          </div>
          <h2 className="ks-state__title">加载失败</h2>
          <p className="ks-state__description">{error}</p>
          <button
            className="ks-btn ks-btn--primary"
            onClick={() => state.simulateLoading()}
          >
            重试
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div className="ks-state">
          <div className="ks-state__icon" aria-hidden="true">
            ○
          </div>
          <h2 className="ks-state__title">暂无条目</h2>
          <p className="ks-state__description">
            {projection === "today"
              ? "今日没有新的建议条目。"
              : projection === "review"
                ? "所有条目已审查完毕。"
                : "记录为空。"}
          </p>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && items.length > 0 && (
        <>
          {/* Desktop: graph view */}
          <div className="ks-desktop-only">
            <div style={{ marginBottom: 16 }}>
              <h2 className="ks-heading">知识图谱</h2>
              <SimpleGraph items={items} onNodeClick={setSelectedItemId} />
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
          </div>

          {/* Mobile: tree view */}
          <div className="ks-mobile-only" style={{ marginBottom: 16 }}>
            <h2 className="ks-heading">条目导航</h2>
            <MobileTree
              items={items}
              onSelect={setSelectedItemId}
              selectedId={selectedItemId}
            />
          </div>

          {/* Evidence list + detail (desktop) */}
          <div
            className="ks-layout-a"
            role="tabpanel"
            id={`panel-a-${projection}`}
            aria-labelledby={`tab-a-${projection}`}
          >
            <div>
              <h2 className="ks-heading">
                {projection === "today"
                  ? "今日建议"
                  : projection === "review"
                    ? "待审查"
                    : "全部记录"}
              </h2>
              <div
                className="ks-evidence-list"
                ref={listRef}
                role="list"
                aria-label="证据列表"
              >
                {items.map((item) => (
                  <div key={item.id} role="listitem">
                    <EvidenceCard
                      item={item}
                      selected={selectedItemId === item.id}
                      onSelect={() => setSelectedItemId(item.id)}
                      onAccept={() => acceptItem(item.id)}
                      onReject={() => rejectItem(item.id)}
                      onEdit={() => setEditingItem(item)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Detail sidebar */}
            <div>
              {selectedItem ? (
                <DetailPanel
                  item={selectedItem}
                  onAccept={() => acceptItem(selectedItem.id)}
                  onReject={() => rejectItem(selectedItem.id)}
                  onEdit={() => setEditingItem(selectedItem)}
                  onClose={() => setSelectedItemId(null)}
                />
              ) : (
                <div className="ks-state" style={{ padding: "48px 24px" }}>
                  <p className="ks-state__description">选择一条证据查看详情</p>
                </div>
              )}
            </div>
          </div>

          {/* Chat history */}
          <div style={{ marginTop: 24 }}>
            <h2 className="ks-heading">对话历史</h2>
            <div className="ks-flex-col ks-gap-md">
              {data.messages.slice(-4).map((msg) => (
                <div
                  key={msg.id}
                  className={`ks-message ${msg.role === "user" ? "ks-message--user" : "ks-message--assistant"}`}
                >
                  <strong>{msg.role === "user" ? "你" : "助手"}</strong>
                  <p style={{ margin: "4px 0 0 0" }}>{msg.content}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Edit modal */}
      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={(updates) => editItem(editingItem.id, updates)}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}
