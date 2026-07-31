import { describe, expect, it, vi } from "vitest";

import type { ApiClient, ApiRequestOptions } from "@/lib/api/client";

import {
  localDateValue,
  OnboardingSetupService,
  type OnboardingSpace,
  type OnboardingWorkspace,
} from "../onboarding-setup-service";

function clientWith(
  implementation: (path: string, options?: ApiRequestOptions) => unknown,
): ApiClient {
  return {
    request: vi.fn(implementation) as ApiClient["request"],
  };
}

describe("OnboardingSetupService", () => {
  it("lists and creates workspaces and private spaces through existing APIs", async () => {
    const workspace = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "学习工作区",
    } as OnboardingWorkspace;
    const space = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "入门空间",
    } as OnboardingSpace;
    const api = clientWith((path, options) => {
      if (path.endsWith("/spaces")) {
        return Promise.resolve(
          options?.method === "POST" ? space : { spaces: [space] },
        );
      }
      return Promise.resolve(
        options?.method === "POST" ? workspace : { workspaces: [workspace] },
      );
    });
    const service = new OnboardingSetupService(api);

    await expect(service.listWorkspaces()).resolves.toEqual([workspace]);
    await expect(service.createWorkspace("学习工作区")).resolves.toBe(
      workspace,
    );
    await expect(service.listSpaces(workspace.id)).resolves.toEqual([space]);
    await expect(service.createSpace(workspace.id, "入门空间")).resolves.toBe(
      space,
    );

    expect(api.request).toHaveBeenNthCalledWith(2, "/api/v1/workspaces", {
      body: '{"name":"学习工作区"}',
      csrf: true,
      method: "POST",
    });
    expect(api.request).toHaveBeenNthCalledWith(
      4,
      `/api/v1/workspaces/${workspace.id}/spaces`,
      {
        body: '{"name":"入门空间","visibility":"private"}',
        csrf: true,
        method: "POST",
      },
    );
  });

  it("creates one server-backed goal targeted at today", async () => {
    const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
    const api = clientWith((path, options) => {
      calls.push({ path, options });
      return Promise.resolve({ goal_id: "created" });
    });
    const service = new OnboardingSetupService(api);

    await service.createTodayGoal("workspace-id", "space-id", {
      desiredOutcome: "提交一页笔记",
      targetDate: "2026-07-31",
      title: "完成第一章",
      weeklyMinutes: 90,
    });

    expect(calls[0]?.path).toBe(
      "/api/v1/workspaces/workspace-id/spaces/space-id/goals",
    );
    expect(calls[0]?.options).toMatchObject({ csrf: true, method: "POST" });
    expect(JSON.parse(String(calls[0]?.options?.body))).toMatchObject({
      desired_outcome: "提交一页笔记",
      target_date: "2026-07-31",
      title: "完成第一章",
      weekly_minutes: 90,
      phases: [
        {
          acceptance_criteria: ["提交一页笔记"],
          estimated_minutes: 90,
          position: 0,
          title: "完成今日目标",
        },
      ],
    });
  });

  it("formats the browser-local calendar date", () => {
    expect(localDateValue(new Date(2026, 6, 31, 23, 59))).toBe("2026-07-31");
  });
});
