"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { Button, Menu, Sheet } from "./components";
import {
  createCommands,
  isEditing,
  matchesShortcut,
  useModifierKey,
} from "./commands";
import { presetLayout, togglePane, type Theme } from "./preferences";
import { useWorkbench } from "./provider";
import { WORKBENCH_ROUTES } from "./routes";
import { livePdfRange } from "./selection";
import { PaletteSearch } from "./search";

export function WorkbenchShell({ children }: { children: ReactNode }) {
  const state = useWorkbench();
  const path = usePathname(),
    router = useRouter();
  const [paletteReturnFocus, setPaletteReturnFocus] =
    useState<HTMLElement | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [palette, setPalette] = useState(false),
    [help, setHelp] = useState(false),
    [navigation, setNavigation] = useState(false);
  const layout = state.preferences["workbench.layouts"];
  const modifier = useModifierKey();
  const commands = createCommands(
    {
      navigate: (href) => {
        if (
          !window.dispatchEvent(
            new Event("workbench:before-navigate", { cancelable: true }),
          )
        )
          return;
        router.push(href);
        setNavigation(false);
      },
      theme: (theme) => {
        void state.save("appearance.theme", theme);
      },
      preset: (id) => {
        void state.save("workbench.layouts", {
          ...presetLayout(id),
          toolbars: layout.toolbars,
        });
      },
      pane: (index) => {
        void state.save("workbench.layouts", togglePane(layout, index));
      },
      reader: path.startsWith("/read/")
        ? (id) =>
            window.dispatchEvent(
              new CustomEvent("workbench:reader-command", { detail: id }),
            )
        : undefined,
      palette: () => {
        window.dispatchEvent(new Event("workbench:reader-capture-selection"));
        setPaletteReturnFocus(
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        );
        setPaletteQuery("");
        setPalette(true);
      },
      help: () => setHelp(true),
      toolbars: () => {
        void state.save("workbench.layouts", {
          ...layout,
          toolbars: !layout.toolbars,
        });
      },
    },
    { toolbarsVisible: layout.toolbars, modifier },
  );
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      // Let an open Radix layer consume Escape before collapsing reader tools.
      if (
        event.key === "Escape" &&
        layout.toolbars &&
        !state.pending &&
        !document.querySelector('[role="dialog"], [role="menu"]')
      ) {
        event.preventDefault();
        void state.save("workbench.layouts", { ...layout, toolbars: false });
        return;
      }
      const command = commands.find(
        (item) => item.shortcut && matchesShortcut(event, item.shortcut),
      );
      if (
        !command ||
        (command.selectionOnly && !livePdfRange()) ||
        (isEditing(event.target) && command.id !== "palette") ||
        state.pending
      )
        return;
      event.preventDefault();
      command.action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, layout, state]);
  function run(id: string) {
    commands.find((item) => item.id === id)?.action();
  }
  const activeRoute = WORKBENCH_ROUTES.find(
    (route) => path === route.path || path.startsWith(`${route.path}/`),
  );
  const title = activeRoute?.label ?? "阅读器";
  const navigationContent = (
    <>
      <div className="wb-brand">
        <span className="wb-brand-mark" aria-hidden="true">
          L
        </span>
        <strong>Logion</strong>
        <span>研究工作台</span>
      </div>
      <div className="wb-context">
        <label>
          工作区
          <select
            aria-label="工作区"
            value={state.context?.workspace_id ?? ""}
            disabled={state.pending}
            onChange={(event) => void state.selectWorkspace(event.target.value)}
          >
            {!state.workspaces.length && <option value="">暂无工作区</option>}
            {state.workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          空间
          <select
            aria-label="空间"
            value={state.context?.space_id ?? ""}
            disabled={state.pending}
            onChange={(event) => void state.selectSpace(event.target.value)}
          >
            {!state.spaces.length && <option value="">暂无可访问空间</option>}
            {state.spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav aria-label="研究导航">
        {WORKBENCH_ROUTES.map((route, index) => (
          <Link
            key={route.path}
            href={route.path}
            onClick={() => setNavigation(false)}
            aria-current={activeRoute?.path === route.path ? "page" : undefined}
          >
            <NavIcon index={index} />
            {route.label}
          </Link>
        ))}
      </nav>
      <div className="wb-sidebar-footer">
        <span>个人研究 · 在线保存</span>
        <Link href="/app/workspaces">管理工作区</Link>
      </div>
    </>
  );
  return (
    <>
      <div className="wb-shell">
        <aside className="wb-sidebar">{navigationContent}</aside>
        <div className="wb-body">
          <header className="wb-titlebar">
            <Button
              className="wb-mobile-navigation"
              aria-label="打开导航"
              onClick={() => setNavigation(true)}
            >
              ☰
            </Button>
            <span className="wb-title">{title}</span>
            <div className="wb-title-actions">
              <Menu
                label="外观"
                items={(
                  [
                    ["light", "日间"],
                    ["dark", "夜间"],
                    ["system", "跟随系统"],
                  ] as [Theme, string][]
                ).map(([theme, label]) => ({
                  label,
                  checked: state.preferences["appearance.theme"] === theme,
                  disabled: state.pending,
                  action: () => run(`theme:${theme}`),
                }))}
              />
              <Button aria-label="打开指令面板" onClick={() => run("palette")}>
                <span>指令</span>
                <kbd>{modifier}+K</kbd>
              </Button>
            </div>
          </header>
          <main id="main-content" className="wb-main">
            {children}
          </main>
          <nav className="wb-bottom-nav" aria-label="快捷导航">
            {WORKBENCH_ROUTES.filter((route) =>
              ["/today", "/library", "/review", "/graph"].includes(route.path),
            ).map((route) => (
              <Link
                key={route.path}
                href={route.path}
                aria-current={
                  activeRoute?.path === route.path ? "page" : undefined
                }
              >
                {route.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <Sheet
        title="导航"
        description="选择工作区、空间和页面。"
        open={navigation}
        onOpenChange={setNavigation}
      >
        {navigationContent}
      </Sheet>
      <Dialog.Root open={palette} onOpenChange={setPalette}>
        <Dialog.Portal>
          <Dialog.Overlay className="wb-overlay" />
          <Dialog.Content
            className="wb-scope wb-command"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (paletteReturnFocus?.isConnected) paletteReturnFocus.focus();
            }}
          >
            <Dialog.Title className="wb-visually-hidden">指令面板</Dialog.Title>
            <Dialog.Description className="wb-visually-hidden">
              搜索指令和当前空间内容，使用方向键选择，回车执行，Esc 关闭。
            </Dialog.Description>
            <Command label="搜索指令">
              <Command.Input
                value={paletteQuery}
                onValueChange={setPaletteQuery}
                maxLength={120}
                placeholder="搜索内容或输入指令…"
                aria-label="搜索指令"
              />
              <Command.List>
                <Command.Empty>没有匹配的指令或内容</Command.Empty>
                {["跳转", "外观", "布局", "工具", "阅读"].map((group) => (
                  <Command.Group key={group} heading={group}>
                    {commands
                      .filter(
                        (item) => item.group === group && item.id !== "palette",
                      )
                      .map((item) => (
                        <Command.Item
                          key={item.id}
                          value={item.label}
                          disabled={state.pending}
                          onSelect={() => {
                            setPalette(false);
                            item.action();
                          }}
                        >
                          <span>{item.label}</span>
                          {item.hint && <kbd>{item.hint}</kbd>}
                        </Command.Item>
                      ))}
                  </Command.Group>
                ))}
                {palette && (
                  <PaletteSearch
                    query={paletteQuery}
                    navigate={(href) => {
                      if (
                        !window.dispatchEvent(
                          new Event("workbench:before-navigate", {
                            cancelable: true,
                          }),
                        )
                      )
                        return;
                      setPalette(false);
                      router.push(href);
                    }}
                  />
                )}
              </Command.List>
            </Command>
            <footer>
              <span>↑ ↓ 选择 · Enter 执行</span>
              <Dialog.Close asChild>
                <Button>Esc 关闭</Button>
              </Dialog.Close>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Sheet
        title="快捷键"
        description="输入文字时仅指令面板快捷键生效。"
        open={help}
        onOpenChange={setHelp}
      >
        <dl className="wb-shortcuts">
          {commands
            .filter((item) => item.hint)
            .map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>
                  <kbd>{item.hint}</kbd>
                </dd>
              </div>
            ))}
          <div>
            <dt>关闭弹层或收起工具栏</dt>
            <dd>
              <kbd>Esc</kbd>
            </dd>
          </div>
        </dl>
      </Sheet>
    </>
  );
}
function NavIcon({ index }: { index: number }) {
  const paths = [
    "M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1 1m8 8 1 1M3 13l1-1m8-8 1-1M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    "M2 2h5v12H2zM9 2h4v12H9zM2 5h5m2 0h4",
    "M5 5a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0",
    "M6 4h4M4 6v4m8-4v4m-6 2h4M6 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0m8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0m8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    "M2 6a6 6 0 1 1 0 4m0-8v4h4m2-2v4l3 2",
    "M3 3h10v11H3zM5 1v4m6-4v4M5 8h6m-6 3h4",
    "M3 1h7l3 3v11H3zM10 1v4h3M5 8h6m-6 3h6",
    "M11 11l4 4M12 7A5 5 0 1 1 2 7a5 5 0 0 1 10 0",
    "M2 4h12M2 8h12M2 12h12M5 2v4m6 0v4m-5 0v4",
  ];
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[index]} />
    </svg>
  );
}
