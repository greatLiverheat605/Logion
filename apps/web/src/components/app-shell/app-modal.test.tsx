/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AppModal } from "./app-modal";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      {open ? (
        <AppModal
          eyebrow="TEST"
          onClose={() => setOpen(false)}
          returnFocusRef={triggerRef}
          title="测试对话框"
        >
          <label htmlFor="modal-name">名称</label>
          <input data-modal-autofocus id="modal-name" />
          <button type="button">对话框动作</button>
        </AppModal>
      ) : null}
    </>
  );
}

afterEach(cleanup);

describe("AppModal", () => {
  it("focuses the caller-designated initial control", async () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "名称" })).toBe(
        document.activeElement,
      ),
    );
  });

  it("closes on Escape and returns focus to the caller", async () => {
    render(<ModalHarness />);
    const trigger = screen.getByRole("button", { name: "打开" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "测试对话框" });
    fireEvent.keyDown(dialog, { code: "Escape", key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("exposes a named close control", async () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    fireEvent.click(await screen.findByRole("button", { name: "关闭" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

it("returns to the active tab when a successful action removes its trigger", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const [removed, setRemoved] = useState(false);
    return (
      <>
        <button role="tab" aria-selected="true">
          设备
        </button>
        {!removed ? <button onClick={() => setOpen(true)}>撤销</button> : null}
        {open ? (
          <AppModal
            title="撤销确认"
            eyebrow="TEST"
            onClose={() => setOpen(false)}
          >
            <button
              onClick={() => {
                setRemoved(true);
                setOpen(false);
              }}
            >
              完成
            </button>
          </AppModal>
        ) : null}
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByText("撤销");
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByText("完成"));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("tab")),
  );
});
