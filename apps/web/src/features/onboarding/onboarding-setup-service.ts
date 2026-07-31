import type { components } from "@logion/contracts";

import { browserApiClient, type ApiClient } from "@/lib/api/client";

export type OnboardingWorkspace = components["schemas"]["WorkspaceResponse"];
export type OnboardingSpace = components["schemas"]["SpaceResponse"];
type GoalPlanResponse = components["schemas"]["GoalPlanResponse"];

export interface TodayGoalInput {
  desiredOutcome: string;
  targetDate: string;
  title: string;
  weeklyMinutes: number;
}

export class OnboardingSetupService {
  constructor(private readonly api: ApiClient = browserApiClient) {}

  async listWorkspaces(): Promise<OnboardingWorkspace[]> {
    const response = await this.api.request<{
      workspaces: OnboardingWorkspace[];
    }>("/api/v1/workspaces");
    return response.workspaces;
  }

  async createWorkspace(name: string): Promise<OnboardingWorkspace> {
    return this.api.request<OnboardingWorkspace>("/api/v1/workspaces", {
      body: JSON.stringify({ name }),
      csrf: true,
      method: "POST",
    });
  }

  async listSpaces(workspaceId: string): Promise<OnboardingSpace[]> {
    const response = await this.api.request<{ spaces: OnboardingSpace[] }>(
      `/api/v1/workspaces/${workspaceId}/spaces`,
    );
    return response.spaces;
  }

  async createSpace(
    workspaceId: string,
    name: string,
  ): Promise<OnboardingSpace> {
    return this.api.request<OnboardingSpace>(
      `/api/v1/workspaces/${workspaceId}/spaces`,
      {
        body: JSON.stringify({ name, visibility: "private" }),
        csrf: true,
        method: "POST",
      },
    );
  }

  async createTodayGoal(
    workspaceId: string,
    spaceId: string,
    input: TodayGoalInput,
  ): Promise<GoalPlanResponse> {
    return this.api.request<GoalPlanResponse>(
      `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/goals`,
      {
        body: JSON.stringify({
          goal_id: crypto.randomUUID(),
          plan_id: crypto.randomUUID(),
          plan_version_id: crypto.randomUUID(),
          title: input.title,
          description: "",
          desired_outcome: input.desiredOutcome,
          weekly_minutes: input.weeklyMinutes,
          target_date: input.targetDate,
          phases: [
            {
              id: crypto.randomUUID(),
              title: "完成今日目标",
              description: "",
              position: 0,
              estimated_minutes: Math.min(input.weeklyMinutes, 1_440),
              acceptance_criteria: [input.desiredOutcome],
            },
          ],
        }),
        csrf: true,
        method: "POST",
      },
    );
  }
}

export function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const onboardingSetupService = new OnboardingSetupService();
