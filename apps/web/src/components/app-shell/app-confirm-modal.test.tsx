/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AppConfirmModal } from "./app-confirm-modal";
afterEach(cleanup);
it("focuses cancel, retains failures, blocks duplicate submits and busy dismissal, then restores focus", async () => {
  let finish!: () => void;
  const run = vi
    .fn()
    .mockRejectedValueOnce(new Error("denied"))
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>打开</button>
        {open ? (
          <AppConfirmModal
            action={{
              title: "撤销测试设备",
              description: "全部会话将失效",
              confirmLabel: "撤销设备",
              run,
            }}
            onClose={() => setOpen(false)}
            errorText={() => "权限不足，请重新认证"}
          />
        ) : null}
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByText("打开");
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByText("取消"));
  fireEvent.click(screen.getByText("取消"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(run).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByText("撤销设备"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "权限不足，请重新认证",
  );
  fireEvent.click(screen.getByText("撤销设备"));
  fireEvent.click(screen.getByText("正在处理…"));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(run).toHaveBeenCalledTimes(2);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});
