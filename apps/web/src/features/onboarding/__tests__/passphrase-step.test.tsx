/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PassphraseStep } from "../steps/passphrase-step";

const unlock = vi.hoisted(() => vi.fn());

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => ({ unlock }),
}));

afterEach(() => {
  cleanup();
  unlock.mockReset();
});

describe("PassphraseStep", () => {
  it("initializes or unlocks the encrypted local vault before advancing", async () => {
    unlock.mockResolvedValue({});
    const onNext = vi.fn();
    render(<PassphraseStep onBack={vi.fn()} onNext={onNext} />);

    fireEvent.change(screen.getByLabelText("本机口令"), {
      target: { value: "local-secret-123" },
    });
    fireEvent.change(screen.getByLabelText("再次输入本机口令"), {
      target: { value: "local-secret-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设置并继续" }));

    await waitFor(() =>
      expect(unlock).toHaveBeenCalledWith("local-secret-123"),
    );
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("does not write or advance when confirmation differs", () => {
    const onNext = vi.fn();
    render(<PassphraseStep onBack={vi.fn()} onNext={onNext} />);

    fireEvent.change(screen.getByLabelText("本机口令"), {
      target: { value: "local-secret-123" },
    });
    fireEvent.change(screen.getByLabelText("再次输入本机口令"), {
      target: { value: "different-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设置并继续" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "两次输入的本机口令不一致。",
    );
    expect(unlock).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
