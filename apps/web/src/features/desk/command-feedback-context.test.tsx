/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandFeedbackProvider,
  useCommandFeedback,
} from "@/features/desk/command-feedback-context";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Harness({ children }: { children: React.ReactNode }) {
  return <CommandFeedbackProvider>{children}</CommandFeedbackProvider>;
}

describe("CommandFeedbackProvider", () => {
  it("throws when useCommandFeedback is used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bad() {
      useCommandFeedback();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/CommandFeedbackProvider/);
    spy.mockRestore();
  });

  it("shows a toast when showToast is called", () => {
    function Trigger() {
      const { showToast } = useCommandFeedback();
      return (
        <button onClick={() => showToast({ title: "已保存", tone: "good" })}>
          保存
        </button>
      );
    }
    render(
      <Harness>
        <Trigger />
      </Harness>,
    );
    act(() => {
      screen.getByText("保存").click();
    });
    expect(screen.getByText("已保存")).toBeDefined();
  });

  it("dismisses a toast via its close button", () => {
    function Trigger() {
      const { showToast } = useCommandFeedback();
      return (
        <button onClick={() => showToast({ title: "通知", tone: "info" })}>
          显示
        </button>
      );
    }
    render(
      <Harness>
        <Trigger />
      </Harness>,
    );
    act(() => screen.getByText("显示").click());
    expect(screen.getByText("通知")).toBeDefined();
    act(() => screen.getByLabelText("关闭通知").click());
    expect(screen.queryByText("通知")).toBeNull();
  });

  describe("toast auto-dismiss with fake timers", () => {
    it("auto-dismisses a non-bad toast after the default duration", () => {
      vi.useFakeTimers();
      function Trigger() {
        const { showToast } = useCommandFeedback();
        return (
          <button onClick={() => showToast({ title: "已保存", tone: "good" })}>
            触发
          </button>
        );
      }
      render(
        <Harness>
          <Trigger />
        </Harness>,
      );
      act(() => screen.getByText("触发").click());
      expect(screen.getByText("已保存")).toBeDefined();
      // Not dismissed before the timer fires.
      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(screen.getByText("已保存")).toBeDefined();
      // Dismissed after 4000ms.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText("已保存")).toBeNull();
    });

    it("does NOT auto-dismiss a bad toast (stays until manually closed)", () => {
      vi.useFakeTimers();
      function Trigger() {
        const { showToast } = useCommandFeedback();
        return (
          <button onClick={() => showToast({ title: "失败", tone: "bad" })}>
            触发
          </button>
        );
      }
      render(
        <Harness>
          <Trigger />
        </Harness>,
      );
      act(() => screen.getByText("触发").click());
      expect(screen.getByText("失败")).toBeDefined();
      // Advance far beyond the default duration — bad toast must persist.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText("失败")).toBeDefined();
    });
  });

  it("tracks inspector open/close", () => {
    function Probe() {
      const { inspector, openInspector, closeInspector } = useCommandFeedback();
      return (
        <>
          <button
            onClick={() => openInspector({ body: "详情内容", title: "节点 A" })}
          >
            打开
          </button>
          {inspector ? <span>INSPECTOR:{inspector.title}</span> : null}
          <button onClick={closeInspector}>关闭面板</button>
        </>
      );
    }
    render(
      <Harness>
        <Probe />
      </Harness>,
    );
    expect(screen.queryByText(/INSPECTOR:/)).toBeNull();
    act(() => screen.getByText("打开").click());
    expect(screen.getByText("INSPECTOR:节点 A")).toBeDefined();
    act(() => screen.getByText("关闭面板").click());
    expect(screen.queryByText(/INSPECTOR:/)).toBeNull();
  });

  describe("conflict resolver visible rendering", () => {
    it("renders a visible Conflict Resolver with detail, request id and actions when requested", () => {
      function Trigger() {
        const { requestConflictResolution } = useCommandFeedback();
        return (
          <button
            onClick={() =>
              requestConflictResolution({
                actions: [
                  { kind: "reload", label: "重新加载", onClick: () => {} },
                  { kind: "cancel", label: "取消", onClick: () => {} },
                ],
                detail: "远端版本较新",
                requestId: "req-conflict-1",
              })
            }
          >
            触发冲突
          </button>
        );
      }
      render(
        <Harness>
          <Trigger />
        </Harness>,
      );
      // Before triggering, no conflict resolver is visible.
      expect(screen.queryByText("远端版本较新")).toBeNull();
      act(() => screen.getByText("触发冲突").click());
      // After triggering, the detail, request id and action buttons are visible.
      expect(screen.getByText("远端版本较新")).toBeDefined();
      expect(screen.getByText(/req-conflict-1/)).toBeDefined();
      expect(screen.getByText("重新加载")).toBeDefined();
      expect(screen.getByText("取消")).toBeDefined();
    });

    it("dismisses the conflict resolver after an action is taken", () => {
      function Trigger() {
        const { requestConflictResolution } = useCommandFeedback();
        return (
          <button
            onClick={() =>
              requestConflictResolution({
                actions: [
                  { kind: "reload", label: "重新加载", onClick: () => {} },
                ],
                detail: "冲突",
                requestId: "req-c",
              })
            }
          >
            触发
          </button>
        );
      }
      render(
        <Harness>
          <Trigger />
        </Harness>,
      );
      act(() => screen.getByText("触发").click());
      expect(screen.getByText("冲突")).toBeDefined();
      act(() => screen.getByText("重新加载").click());
      expect(screen.queryByText("冲突")).toBeNull();
    });
  });
});
