/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonaProvider } from "../persona-context";
import type { PersonaSetting } from "../persona-setting-service";
import { PersonaTodayOverview } from "../persona-today-overview";

afterEach(cleanup);

describe("PersonaTodayOverview", () => {
  it("shows persona-specific entries and switches through the quick dialog", async () => {
    const service = {
      load: vi.fn().mockResolvedValue({
        activePersonaId: "exam",
        customPersonas: [],
      }),
      save: vi
        .fn<(setting: PersonaSetting) => Promise<PersonaSetting>>()
        .mockImplementation((setting) => Promise.resolve(setting)),
    };
    render(
      <PersonaProvider service={service}>
        <PersonaTodayOverview />
      </PersonaProvider>,
    );

    await screen.findByRole("heading", {
      name: "围绕考试、复习和学习记录安排今天",
    });
    expect(
      screen.getByRole("link", { name: /考试/ }).getAttribute("href"),
    ).toBe("/app/exam");

    fireEvent.click(screen.getByRole("button", { name: "切换画像" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "导 团队协作：工作区管理、审计、成员协作 预设",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "围绕空间、审计和协作治理安排今天",
        }),
      ).toBeTruthy(),
    );
    expect(service.save).toHaveBeenCalledWith({
      activePersonaId: "mentor",
      customPersonas: [],
    });
  });
});
