/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  Button,
  Inspector,
  List,
  Menu,
  Popover,
  Segmented,
  Sheet,
  notifyAction,
} from "./components";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);
it("renders semantic buttons, list and inspector and only notifies actionable errors", async () => {
  const click = vi.fn();
  render(
    <>
      <Button onClick={click}>保存</Button>
      <List label="文献">
        <li>合成文献</li>
      </List>
      <Inspector title="文献信息">详细信息</Inspector>
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("list", { name: "文献" })).toBeTruthy();
  expect(screen.getByRole("complementary", { name: "文献信息" })).toBeTruthy();
  const { toast } = await import("sonner");
  expect(toast.error).not.toHaveBeenCalled();
  notifyAction("需要处理");
  expect(toast.error).toHaveBeenCalledWith("需要处理");
});
it("exposes segmented keyboard navigation and menu focus", async () => {
  const change = vi.fn(),
    action = vi.fn();
  render(
    <>
      <Segmented
        label="布局"
        value="a"
        options={[
          { id: "a", label: "精读" },
          { id: "b", label: "专注" },
        ]}
        onChange={change}
      />
      <Menu label="操作" items={[{ label: "执行", action }]} />
    </>,
  );
  screen.getByRole("radio", { name: "精读" }).focus();
  fireEvent.keyDown(screen.getByRole("radio", { name: "精读" }), {
    key: "ArrowRight",
  });
  await waitFor(() => expect(change).toHaveBeenCalledWith("b"));
  fireEvent.keyDown(screen.getByRole("button", { name: "操作" }), {
    key: "ArrowDown",
  });
  await waitFor(() =>
    expect(screen.getByRole("menuitem", { name: "执行" })).toBe(
      document.activeElement,
    ),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(action).toHaveBeenCalledTimes(1);
});
it("names Sheet and Popover, closes Sheet with Escape and returns focus from Popover", async () => {
  const close = vi.fn();
  const view = render(
    <Sheet title="编辑" description="编辑文献" open onOpenChange={close}>
      <input aria-label="标题" />
    </Sheet>,
  );
  expect(screen.getByRole("dialog", { name: "编辑" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(close).toHaveBeenCalledWith(false);
  view.unmount();
  render(
    <Popover label="说明">
      <p>合成说明</p>
    </Popover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "说明" }));
  expect(screen.getByRole("dialog", { name: "说明" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "说明" }),
    ),
  );
});
