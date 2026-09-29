"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Menu, Segmented } from "./components";
import { useModifierKey } from "./commands";
import {
  CONTENTS,
  PRESETS,
  presetLayout,
  initialMobilePane,
  togglePane,
  type Layout,
  type PaneContent,
  type PaneIndex,
} from "./preferences";
import { useWorkbench } from "./provider";

export function ThreePanes({
  info,
  renderContent,
  initialContent,
}: {
  info?: ReactNode;
  initialContent?: PaneContent;
  renderContent?: (kind: PaneContent) => ReactNode;
}) {
  const { preferences, save, pending } = useWorkbench();
  const modifier = useModifierKey();
  const stored = preferences["workbench.layouts"];
  const existingIndex = stored.panes.findIndex(
    (pane) =>
      pane.content === initialContent ||
      (initialContent === "pdf" && pane.content === "document"),
  );
  const initialIndex: PaneIndex =
    existingIndex >= 0
      ? (existingIndex as PaneIndex)
      : initialContent === "pdf"
        ? 1
        : 2;
  const signature = JSON.stringify(stored);
  const [entry, setEntry] = useState(() =>
    initialContent
      ? {
          signature,
          layout: {
            ...stored,
            panes: stored.panes.map((pane, index) =>
              index === initialIndex
                ? { ...pane, content: initialContent, collapsed: false }
                : pane,
            ) as Layout["panes"],
          },
        }
      : null,
  );
  // A source link opens its content temporarily; later user choices take precedence.
  if (entry && entry.signature !== signature) setEntry(null);
  const [draft, setDraft] = useState<Layout | null>(null);
  const layout = draft ?? entry?.layout ?? stored;
  const [mobilePane, setMobilePane] = useState<PaneIndex>(
    initialContent ? initialIndex : initialMobilePane(stored),
  );
  useEffect(() => {
    const show = () => setMobilePane(2);
    window.addEventListener("workbench:reader-show-result", show);
    return () =>
      window.removeEventListener("workbench:reader-show-result", show);
  }, []);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    index: PaneIndex;
    next: PaneIndex;
    start: number;
    width: number;
    initial: Layout;
    latest: Layout;
  } | null>(null);
  const visible = ([0, 1, 2] as const).filter(
    (index) => !layout.panes[index].collapsed,
  );
  const activeMobile = visible.includes(mobilePane) ? mobilePane : visible[0];
  async function commit(next: Layout) {
    await save("workbench.layouts", next);
    setEntry(null);
    setDraft(null);
  }
  function resize(
    initial: Layout,
    index: PaneIndex,
    next: PaneIndex,
    delta: number,
  ) {
    const panes = initial.panes.map((pane) => ({ ...pane })) as Layout["panes"];
    const total = panes[index].width + panes[next].width;
    panes[index].width = Math.min(
      80,
      total - 10,
      Math.max(10, total - 80, panes[index].width + delta),
    );
    panes[next].width = total - panes[index].width;
    return { ...initial, preset: "custom", panes };
  }
  return (
    <section className="wb-reader" aria-label="三栏阅读布局">
      {!preferences["reader.hint_dismissed"] && !layout.toolbars && (
        <aside className="wb-reader-hint" aria-label="阅读工具提示">
          <div>
            <strong>工具已隐藏</strong>
            <p>
              <kbd>{modifier}+K</kbd> 打开指令面板；<kbd>{modifier}+\</kbd>{" "}
              显示全部工具栏，Esc 收起。
            </p>
            <p>Alt+Shift+1–4 切换阅读预设。聚焦或移到栏顶可更换栏目内容。</p>
          </div>
          <Button
            disabled={pending}
            onClick={() => void save("reader.hint_dismissed", true)}
          >
            知道了
          </Button>
        </aside>
      )}
      {layout.toolbars && (
        <div className="wb-reader-tools">
          <Segmented
            label="预设布局"
            value={layout.preset}
            options={PRESETS}
            onChange={(id) => {
              if (!pending)
                void commit({ ...presetLayout(id), toolbars: layout.toolbars });
            }}
          />
          <Menu
            label="显示栏目"
            items={layout.panes.map((pane, index) => ({
              label: `${["左", "中", "右"][index]}栏 · ${CONTENTS[pane.content]}`,
              checked: !pane.collapsed,
              disabled: pending,
              action: () => void commit(togglePane(layout, index)),
            }))}
          />
        </div>
      )}
      <div className="wb-mobile-panes">
        <Segmented
          label="当前栏目"
          value={String(activeMobile)}
          options={visible.map((index) => ({
            id: String(index),
            label: `${["左", "中", "右"][index]} · ${CONTENTS[layout.panes[index].content]}`,
          }))}
          onChange={(value) => setMobilePane(Number(value) as PaneIndex)}
        />
      </div>
      <div className="wb-panes" ref={container} data-toolbars={layout.toolbars}>
        {visible.map((index, position) => {
          const pane = layout.panes[index],
            next = visible[position + 1];
          return (
            <div
              className="wb-pane-group"
              key={index}
              style={{ flexGrow: pane.width }}
              data-mobile-active={index === activeMobile}
            >
              <section
                className="wb-pane"
                aria-label={`${["左", "中", "右"][index]}栏`}
              >
                <header className="wb-pane-header">
                  <span>{CONTENTS[pane.content]}</span>
                  <div className="wb-pane-selector">
                    <Menu
                      label={`选择${["左", "中", "右"][index]}栏内容`}
                      items={Object.entries(CONTENTS).map(([id, label]) => ({
                        label,
                        checked: id === pane.content,
                        disabled: pending,
                        action: () =>
                          void commit({
                            ...layout,
                            preset: "custom",
                            panes: layout.panes.map((p, i) =>
                              i === index
                                ? { ...p, content: id as PaneContent }
                                : p,
                            ) as Layout["panes"],
                          }),
                      }))}
                    >
                      内容
                    </Menu>
                    <Button
                      aria-label={`折叠${["左", "中", "右"][index]}栏`}
                      disabled={pending || visible.length === 1}
                      onClick={() => void commit(togglePane(layout, index))}
                    >
                      −
                    </Button>
                  </div>
                </header>
                <div className="wb-pane-content" tabIndex={0}>
                  {renderContent?.(pane.content) ??
                    (pane.content === "info" ? (
                      (info ?? (
                        <div className="wb-empty">
                          <h2>文献信息</h2>
                          <p>从文献库选择一篇文献，在这里查看详细信息。</p>
                        </div>
                      ))
                    ) : (
                      <div className="wb-empty">
                        <h2>{CONTENTS[pane.content]}</h2>
                        <p>将在 R2–R4 提供</p>
                      </div>
                    ))}
                </div>
              </section>
              {next !== undefined && (
                <div
                  className="wb-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-label={`调整${["左", "中", "右"][index]}栏宽度`}
                  aria-orientation="vertical"
                  aria-valuemin={10}
                  aria-valuemax={80}
                  aria-valuenow={Math.round(pane.width)}
                  onKeyDown={(event) => {
                    if (
                      pending ||
                      !["ArrowLeft", "ArrowRight"].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    void commit(
                      resize(
                        layout,
                        index,
                        next,
                        event.key === "ArrowLeft" ? -2 : 2,
                      ),
                    );
                  }}
                  onPointerDown={(event) => {
                    if (pending || event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragging.current = {
                      index,
                      next,
                      start: event.clientX,
                      width: container.current?.clientWidth ?? 1,
                      initial: layout,
                      latest: layout,
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = dragging.current;
                    if (!drag) return;
                    const sum = visible.reduce<number>(
                      (total, i) => total + drag.initial.panes[i].width,
                      0,
                    );
                    drag.latest = resize(
                      drag.initial,
                      drag.index,
                      drag.next,
                      ((event.clientX - drag.start) / drag.width) * sum,
                    );
                    setDraft(drag.latest);
                  }}
                  onPointerUp={() => {
                    const drag = dragging.current;
                    dragging.current = null;
                    if (drag) void commit(drag.latest);
                  }}
                  onPointerCancel={() => {
                    dragging.current = null;
                    setDraft(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
