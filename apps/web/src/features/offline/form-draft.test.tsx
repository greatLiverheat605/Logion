/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormDraftPrompt } from "./form-draft-prompt";
import { applyFormDraft, formDraftValues } from "./use-form-draft";

afterEach(cleanup);

describe("form drafts", () => {
  it("reads and restores only the allowlisted fields", () => {
    render(
      <form data-testid="form">
        <textarea name="summary" defaultValue="总结" />
        <input name="passphrase" type="password" defaultValue="secret-pass" />
      </form>,
    );
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(formDraftValues(form, ["summary"])).toEqual({ summary: "总结" });
    applyFormDraft(form, { summary: "恢复的总结" });
    expect(
      (form.elements.namedItem("summary") as HTMLTextAreaElement).value,
    ).toBe("恢复的总结");
    applyFormDraft(null, { summary: "ignored" });
  });

  it("asks before restoring and offers discard", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(
      <FormDraftPrompt
        draft={null}
        onDiscard={onDiscard}
        onRestore={onRestore}
      />,
    );
    expect(screen.queryByRole("group", { name: "未提交内容" })).toBeNull();
    rerender(
      <FormDraftPrompt
        draft={{ savedAt: "2026-09-26T03:00:00Z", values: { summary: "x" } }}
        onDiscard={onDiscard}
        onRestore={onRestore}
      />,
    );
    const prompt = screen.getByRole("group", { name: "未提交内容" });
    expect(prompt.textContent).toContain("恢复未提交内容？");
    expect(prompt.textContent).not.toContain("x。");
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    fireEvent.click(screen.getByRole("button", { name: "丢弃" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
