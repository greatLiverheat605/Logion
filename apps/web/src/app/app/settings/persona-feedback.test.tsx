/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { LogionApiError } from "@/lib/api/client";
import { PersonaSettings } from "./persona-settings";

const choose = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({
    activePersona: null,
    customPersonas: [],
    isLoading: false,
    setActivePersona: choose,
    createCustomPersona: vi.fn(),
    deleteCustomPersona: vi.fn(),
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  choose.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Persona feedback", () => {
  it.each([false, true])(
    "keeps inline feedback and emits a Toast (failure=%s)",
    async (failure) => {
      if (failure)
        choose.mockRejectedValue(
          new LogionApiError({
            code: "USER_SETTING_VERSION_CONFLICT",
            status: 409,
            requestId: "request-persona",
            message: "private detail",
          }),
        );
      render(<PersonaSettings />);
      fireEvent.click(screen.getAllByRole("button", { name: /^切换到：/ })[0]!);
      const text = failure ? "USER_SETTING_VERSION_CONFLICT" : "已切换到";
      await waitFor(() =>
        expect(
          document.querySelector('[aria-live="polite"]')?.textContent,
        ).toContain(text),
      );
      expect(failure ? toast.error : toast.success).toHaveBeenCalledWith(
        expect.stringContaining(text),
        failure
          ? { duration: Infinity, closeButton: true }
          : { duration: 3000 },
      );
      expect(document.body.textContent).not.toContain("private detail");
    },
  );
});
