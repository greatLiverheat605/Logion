/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonaProvider } from "../persona-context";
import type { PersonaSetting } from "../persona-setting-service";
import { PersonaTodayOverview } from "../persona-today-overview";
import { WorkbenchProvider } from "@/features/workbenches/workbench-context";
import { WorkbenchService } from "@/features/workbenches/workbench-service";
import type { ApiClient, ApiRequestOptions } from "@/lib/api/client";

const source = {
  members: [],
  membersAvailable: true,
  now: new Date("2026-07-31T08:00:00.000Z"),
  records: [],
  selectedSpaceId: "space-1",
  sessions: [],
  spaces: [{ id: "space-1", visibility: "private" as const }],
  tasks: [],
};

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
        <PersonaTodayOverview onRetry={vi.fn()} source={source} state="empty" />
      </PersonaProvider>,
    );

    await screen.findByRole("heading", {
      name: "用真实日期、复习与成绩安排备考",
    });
    expect(
      within(screen.getByRole("navigation", { name: "考画像首要入口" }))
        .getByRole("link", { name: /^考试/ })
        .getAttribute("href"),
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
          name: "只在授权共享范围内组织协作与审阅",
        }),
      ).toBeTruthy(),
    );
    expect(service.save).toHaveBeenCalledWith({
      activePersonaId: "mentor",
      customPersonas: [],
    });
  });

  it.each([
    ["loading", "正在汇总真实首页数据"],
    ["needs-context", "还缺少首页上下文"],
    ["locked", "先解锁本地资料"],
    ["error", "画像首页暂时无法读取"],
  ] as const)(
    "renders the %s state without presenting it as empty",
    async (state, title) => {
      const service = {
        load: vi.fn().mockResolvedValue({
          activePersonaId: "self",
          customPersonas: [],
        }),
        save: vi.fn(),
      };
      render(
        <PersonaProvider service={service}>
          <PersonaTodayOverview
            onRetry={vi.fn()}
            source={source}
            state={state}
          />
        </PersonaProvider>,
      );

      expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
      expect(screen.queryByText("尚无项目", { exact: true })).toBeNull();
    },
  );

  it("writes the Workbench preference instead of the legacy Persona after migration", async () => {
    const personaService = {
      load: vi.fn().mockResolvedValue({
        activePersonaId: "self",
        customPersonas: [],
      }),
      save: vi
        .fn<(setting: PersonaSetting) => Promise<PersonaSetting>>()
        .mockImplementation((setting) => Promise.resolve(setting)),
    };
    const preference = {
      contract: "workbench.preference",
      schemaVersion: 1,
      revision: 1,
      payload: {
        activeWorkbenchId: "fixed.learning",
        defaultSpaceByWorkbench: {},
        defaultViewByWorkbench: {},
        density: "comfortable",
        hiddenFixedWorkbenchIds: [],
        workbenchOrder: [
          "fixed.learning",
          "fixed.research",
          "fixed.exam",
          "fixed.mentor",
        ],
      },
    };
    const api: ApiClient = {
      request: vi.fn((path: string, options?: ApiRequestOptions) => {
        if (path.endsWith("/settings") && options?.method === "PUT") {
          const value = JSON.parse(
            JSON.parse(String(options.body)).settings[0].value,
          );
          return Promise.resolve({
            settings: [
              {
                key: "workbench.preference",
                value: JSON.stringify(value),
                version: 2,
              },
            ],
          });
        }
        if (path.endsWith("/settings")) {
          return Promise.resolve({
            settings: [
              {
                key: "workbench.preference",
                value: JSON.stringify(preference),
                version: 1,
              },
            ],
          });
        }
        return Promise.resolve({ items: [], nextCursor: null });
      }) as ApiClient["request"],
    };
    render(
      <PersonaProvider service={personaService}>
        <WorkbenchProvider service={new WorkbenchService(api)}>
          <PersonaTodayOverview
            onRetry={vi.fn()}
            source={source}
            state="empty"
          />
        </WorkbenchProvider>
      </PersonaProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("persona-switcher-trigger")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("persona-switcher-trigger"));
    const choices = within(screen.getByRole("dialog")).getAllByRole("button");
    fireEvent.click(choices[3]!);

    await waitFor(() =>
      expect(
        vi
          .mocked(api.request)
          .mock.calls.some(([, options]) => options?.method === "PUT"),
      ).toBe(true),
    );
    expect(personaService.save).not.toHaveBeenCalled();
  });
});
