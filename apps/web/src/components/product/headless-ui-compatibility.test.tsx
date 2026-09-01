/** @vitest-environment jsdom */

import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

function CompatibilityHarness() {
  return (
    <Tooltip.Provider delayDuration={0}>
      <Dialog.Root>
        <Dialog.Trigger>打开对话框</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content aria-describedby={undefined}>
            <Dialog.Title>兼容性对话框</Dialog.Title>
            <Dialog.Close>关闭对话框</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Tabs.Root defaultValue="queue">
        <Tabs.List aria-label="兼容性分页">
          <Tabs.Trigger value="queue">队列</Tabs.Trigger>
          <Tabs.Trigger value="detail">详情</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="queue">队列内容</Tabs.Content>
        <Tabs.Content value="detail">详情内容</Tabs.Content>
      </Tabs.Root>

      <Popover.Root>
        <Popover.Trigger>打开浮层</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content>浮层内容</Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>打开菜单</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item>菜单动作</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Select.Root defaultValue="all">
        <Select.Trigger aria-label="范围">
          <Select.Value />
        </Select.Trigger>
        <Select.Portal>
          <Select.Content>
            <Select.Viewport>
              <Select.Item value="all">
                <Select.ItemText>全部</Select.ItemText>
              </Select.Item>
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      <ContextMenu.Root>
        <ContextMenu.Trigger>上下文目标</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item>上下文动作</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>帮助</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>帮助说明</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

afterEach(cleanup);

describe("Radix compatibility boundary", () => {
  it("renders stable triggers during server rendering", () => {
    const html = renderToString(<CompatibilityHarness />);

    expect(html).toContain("打开对话框");
    expect(html).toContain("兼容性分页");
    expect(html).toContain("上下文目标");
  });

  it("opens and closes a modal dialog without custom focus code", async () => {
    render(<CompatibilityHarness />);
    const trigger = screen.getByRole("button", { name: "打开对话框" });

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "兼容性对话框",
    });
    expect(dialog).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("supports arrow-key tab selection", async () => {
    render(<CompatibilityHarness />);
    const queue = screen.getByRole("tab", { name: "队列" });
    const detail = screen.getByRole("tab", { name: "详情" });

    queue.focus();
    fireEvent.keyDown(queue, {
      code: "ArrowRight",
      key: "ArrowRight",
      keyCode: 39,
    });

    await waitFor(() =>
      expect(detail.getAttribute("aria-selected")).toBe("true"),
    );
    expect(screen.getByText("详情内容")).toBeTruthy();
  });
});
