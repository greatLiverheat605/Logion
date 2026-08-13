/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeskConfirmDialog } from "@/components/desk/desk-confirm-dialog";

afterEach(cleanup);

function confirmButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "确认" });
}
function cancelButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "取消" });
}
/**
 * The confirm button's label changes when busy ("正在处理…") or auth-blocked
 * ("需重新认证"). This helper finds it by its `tone-bad` class instead of by
 * accessible name, so tests can assert on it regardless of label.
 */
function confirmButtonByClass(): HTMLButtonElement {
  return document.querySelector(".desk-button.tone-bad") as HTMLButtonElement;
}

function dialogRef() {
  return screen.getByRole("dialog");
}

describe("DeskConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <DeskConfirmDialog
        impact="x"
        onConfirm={() => {}}
        onCancel={() => {}}
        open={false}
        title="t"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the impact preview when open", () => {
    render(
      <DeskConfirmDialog
        impact="将永久删除该知识库"
        onConfirm={() => {}}
        onCancel={() => {}}
        open
        title="删除知识库"
      />,
    );
    expect(screen.getByText("将永久删除该知识库")).toBeDefined();
  });

  it("calls onCancel and not onConfirm when cancel is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeskConfirmDialog
        impact="x"
        onConfirm={onConfirm}
        onCancel={onCancel}
        open
        title="t"
      />,
    );
    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("enables confirm immediately when no typed phrase is required", () => {
    const onConfirm = vi.fn();
    render(
      <DeskConfirmDialog
        impact="x"
        onConfirm={onConfirm}
        onCancel={() => {}}
        open
        title="t"
      />,
    );
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables confirm until the typed phrase matches", () => {
    const onConfirm = vi.fn();
    render(
      <DeskConfirmDialog
        impact="x"
        onConfirm={onConfirm}
        onCancel={() => {}}
        open
        requireTypedPhrase="删除"
        title="t"
      />,
    );
    expect(confirmButton().disabled).toBe(true);

    const input = screen.getByLabelText("确认短语") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "删" } });
    expect(confirmButton().disabled).toBe(true);

    fireEvent.change(input, { target: { value: "删除" } });
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  describe("busy blocks all dismiss paths", () => {
    it("disables both confirm and cancel buttons when busy", () => {
      render(
        <DeskConfirmDialog
          busy
          impact="x"
          onConfirm={() => {}}
          onCancel={() => {}}
          open
          title="t"
        />,
      );
      // Busy label is "正在处理…" — find by class since the label changes.
      expect(confirmButtonByClass().disabled).toBe(true);
      expect(cancelButton().disabled).toBe(true);
    });

    it("cancel click does not fire onCancel when busy", () => {
      const onCancel = vi.fn();
      render(
        <DeskConfirmDialog
          busy
          impact="x"
          onConfirm={() => {}}
          onCancel={onCancel}
          open
          title="t"
        />,
      );
      fireEvent.click(cancelButton());
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("Escape does not fire onCancel when busy", () => {
      const onCancel = vi.fn();
      render(
        <DeskConfirmDialog
          busy
          impact="x"
          onConfirm={() => {}}
          onCancel={onCancel}
          open
          title="t"
        />,
      );
      fireEvent.keyDown(dialogRef(), { key: "Escape" });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("close-icon click does not fire onCancel when busy", () => {
      const onCancel = vi.fn();
      render(
        <DeskConfirmDialog
          busy
          impact="x"
          onConfirm={() => {}}
          onCancel={onCancel}
          open
          title="t"
        />,
      );
      // The close icon button has aria-label "关闭".
      const closeBtn = screen.getByRole("button", { name: "关闭" });
      fireEvent.click(closeBtn);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("typed phrase resets on reopen and phrase change", () => {
    it("clears the typed input when reopened (stale phrase does not enable confirm)", () => {
      const onConfirm = vi.fn();
      function App() {
        return (
          <DeskConfirmDialog
            impact="x"
            onConfirm={onConfirm}
            onCancel={() => {}}
            open
            requireTypedPhrase="删除"
            title="t"
          />
        );
      }
      const { rerender } = render(<App />);
      // Type the matching phrase.
      const input = screen.getByLabelText("确认短语") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "删除" } });
      expect(confirmButton().disabled).toBe(false);

      // Close.
      rerender(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open={false}
          requireTypedPhrase="删除"
          title="t"
        />,
      );

      // Reopen: the input must be empty again, so confirm is disabled.
      rerender(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open
          requireTypedPhrase="删除"
          title="t"
        />,
      );
      const inputAfterReopen = screen.getByLabelText(
        "确认短语",
      ) as HTMLInputElement;
      expect(inputAfterReopen.value).toBe("");
      expect(confirmButton().disabled).toBe(true);
    });

    it("clears the typed input when the required phrase changes while open", () => {
      const onConfirm = vi.fn();
      const { rerender } = render(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open
          requireTypedPhrase="删除"
          title="t"
        />,
      );
      const input = screen.getByLabelText("确认短语") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "删除" } });
      expect(confirmButton().disabled).toBe(false);

      // Change the required phrase: the stale typed value must be cleared.
      rerender(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open
          requireTypedPhrase="确认删除"
          title="t"
        />,
      );
      const inputAfterChange = screen.getByLabelText(
        "确认短语",
      ) as HTMLInputElement;
      expect(inputAfterChange.value).toBe("");
      expect(confirmButton().disabled).toBe(true);
    });
  });

  describe("explicit recent-auth gate", () => {
    it("disables confirm when requiresRecentAuth is true (component never fabricates auth success)", () => {
      const onConfirm = vi.fn();
      render(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open
          requiresRecentAuth
          title="t"
        />,
      );
      // Auth-blocked label is "需重新认证" — find by class since the label
      // changes.
      expect(confirmButtonByClass().disabled).toBe(true);
      fireEvent.click(confirmButtonByClass());
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("enables confirm only after requiresRecentAuth flips to false (simulating real re-auth)", () => {
      const onConfirm = vi.fn();
      const { rerender } = render(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open
          requiresRecentAuth
          title="t"
        />,
      );
      expect(confirmButtonByClass().disabled).toBe(true);

      // Caller flips requiresRecentAuth to false after a genuine re-auth.
      rerender(
        <DeskConfirmDialog
          impact="x"
          onConfirm={onConfirm}
          onCancel={() => {}}
          open
          requiresRecentAuth={false}
          title="t"
        />,
      );
      // Label reverts to "确认" after the auth gate opens.
      expect(confirmButton().disabled).toBe(false);
    });
  });

  it("uses unique input IDs across multiple instances (no id collision)", () => {
    // Render two dialogs at once to verify useId produces unique ids.
    render(
      <div>
        <DeskConfirmDialog
          impact="a"
          onConfirm={() => {}}
          onCancel={() => {}}
          open
          requireTypedPhrase="删除"
          title="dialog-a"
        />
        <DeskConfirmDialog
          impact="b"
          onConfirm={() => {}}
          onCancel={() => {}}
          open
          requireTypedPhrase="删除"
          title="dialog-b"
        />
      </div>,
    );
    // AppModal renders into a portal under document.body, so query the whole
    // document for both phrase inputs (each DeskConfirmDialog renders one
    // .desk-input when requireTypedPhrase is set).
    const inputs = document.querySelectorAll<HTMLInputElement>(".desk-input");
    expect(inputs.length).toBe(2);
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
  });
});
