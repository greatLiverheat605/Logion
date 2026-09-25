/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkbenchDialog,
  WorkbenchDropdownMenu,
  WorkbenchSheet,
  WorkbenchSelect,
  WorkbenchTabPanel,
  WorkbenchTabs,
} from "./headless-ui";

afterEach(cleanup);

describe("headless UI adapters", () => {
  it("supports controlled dialog closure", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <WorkbenchDialog
          description="创建一条正式知识记录"
          onOpenChange={setOpen}
          open={open}
          title="新建记录"
          trigger={<button type="button">新建</button>}
        >
          正式表单
        </WorkbenchDialog>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const dialog = await screen.findByRole("dialog", { name: "新建记录" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(
      "创建一条正式知识记录",
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Escape and restores focus to its trigger", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <WorkbenchDialog
          onOpenChange={setOpen}
          open={open}
          title="命令详情"
          trigger={<button type="button">查看命令</button>}
        >
          命令内容
        </WorkbenchDialog>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "查看命令" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "命令详情" });
    fireEvent.keyDown(dialog, { code: "Escape", key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the opener of a controlled sheet without a trigger", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <main id="main-content" tabIndex={-1}>
          <button onClick={() => setOpen(true)} type="button">
            打开表单
          </button>
          <WorkbenchSheet onOpenChange={setOpen} open={open} title="受控表单">
            <input aria-label="名称" autoFocus />
          </WorkbenchSheet>
        </main>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "打开表单" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "受控表单" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("名称")),
    );
    fireEvent.keyDown(dialog, { code: "Escape", key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("returns focus when the sheet is mounted already open", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <main id="main-content" tabIndex={-1}>
          <button onClick={() => setOpen(true)} type="button">
            打开表单
          </button>
          {open ? (
            <WorkbenchSheet onOpenChange={setOpen} open title="按需挂载">
              <input aria-label="名称" autoFocus />
            </WorkbenchSheet>
          ) : null}
        </main>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "打开表单" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "按需挂载" });
    fireEvent.keyDown(dialog, { code: "Escape", key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it.each(["removed", "disabled"] as const)(
    "falls back to the main landmark when the opener is %s",
    async (change) => {
      function Harness() {
        const [open, setOpen] = useState(false);
        const [state, setState] = useState<"ready" | typeof change>("ready");
        return (
          <main id="main-content" tabIndex={-1}>
            {state === "removed" ? null : (
              <button
                disabled={state === "disabled"}
                onClick={() => setOpen(true)}
                type="button"
              >
                打开表单
              </button>
            )}
            <WorkbenchSheet onOpenChange={setOpen} open={open} title="受控表单">
              <button
                onClick={() => {
                  setState(change);
                  setOpen(false);
                }}
                type="button"
              >
                保存
              </button>
            </WorkbenchSheet>
          </main>
        );
      }

      render(<Harness />);
      const opener = screen.getByRole("button", { name: "打开表单" });
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole("dialog", { name: "受控表单" });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() =>
        expect(document.activeElement).toBe(
          document.getElementById("main-content"),
        ),
      );
    },
  );

  it("supports Arrow, Home and End tab navigation", async () => {
    function Harness() {
      const [value, setValue] = useState("queue");
      return (
        <WorkbenchTabs
          label="记录视图"
          onValueChange={setValue}
          tabs={[
            { label: "队列", value: "queue" },
            { label: "详情", value: "detail" },
            { label: "历史", value: "history" },
          ]}
          value={value}
        >
          <WorkbenchTabPanel value="queue">队列内容</WorkbenchTabPanel>
          <WorkbenchTabPanel value="detail">详情内容</WorkbenchTabPanel>
          <WorkbenchTabPanel value="history">历史内容</WorkbenchTabPanel>
        </WorkbenchTabs>
      );
    }

    render(<Harness />);
    const queue = screen.getByRole("tab", { name: "队列" });
    queue.focus();
    fireEvent.keyDown(queue, { code: "End", key: "End" });
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "历史" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "历史" }), {
      code: "Home",
      key: "Home",
    });
    await waitFor(() =>
      expect(queue.getAttribute("aria-selected")).toBe("true"),
    );
  });

  it("keeps menu and select actions explicit", async () => {
    const menuAction = vi.fn();
    const selectAction = vi.fn();
    render(
      <>
        <WorkbenchDropdownMenu
          items={[{ id: "archive", label: "归档", onSelect: menuAction }]}
          label="记录操作"
          trigger={<button type="button">更多</button>}
        />
        <WorkbenchSelect
          label="资料类型"
          onValueChange={selectAction}
          options={[
            { label: "全部", value: "all" },
            { label: "笔记", value: "note" },
          ]}
          value="all"
        />
      </>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "更多" }), {
      code: "Enter",
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "归档" }));
    expect(menuAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("combobox", { name: "资料类型" })).toBeTruthy();
  });
});
