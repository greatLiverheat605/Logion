import type { ApiClient } from "@/lib/api/client";
import { browserApiClient, LogionApiError } from "@/lib/api/client";

import type {
  CalendarFeed,
  DataExport,
  DataImport,
  IntegrationCapabilityData,
  Space,
  Workspace,
} from "./integration-capability-model";

function listFrom<T>(value: unknown, key: string): T[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

function calendarTokenFrom(value: unknown): { token: string } {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).token === "string" &&
    String((value as Record<string, unknown>).token).length > 0
  ) {
    return { token: String((value as Record<string, unknown>).token) };
  }
  throw new LogionApiError({
    code: "WEB_API_RESPONSE_INVALID",
    message: "The calendar feed response is invalid.",
    status: 0,
  });
}

export class IntegrationCapabilityService {
  constructor(private readonly api: ApiClient = browserApiClient) {}

  async listWorkspaces(): Promise<Workspace[]> {
    return listFrom<Workspace>(
      await this.api.request<unknown>("/api/v1/workspaces"),
      "workspaces",
    );
  }

  async listCalendarFeeds(workspaceId: string): Promise<CalendarFeed[]> {
    return listFrom<CalendarFeed>(
      await this.api.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/calendar-feeds`,
      ),
      "feeds",
    );
  }

  async createCalendarFeed(
    workspaceId: string,
    input: { id: string; name: string },
  ): Promise<{ token: string }> {
    return calendarTokenFrom(
      await this.api.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/calendar-feeds`,
        {
          body: JSON.stringify(input),
          csrf: true,
          method: "POST",
        },
      ),
    );
  }

  revokeCalendarFeed(
    workspaceId: string,
    feedId: string,
    expectedVersion: number,
  ): Promise<unknown> {
    return this.api.request(
      `/api/v1/workspaces/${workspaceId}/calendar-feeds/${feedId}/revoke`,
      {
        body: JSON.stringify({ expected_version: expectedVersion }),
        csrf: true,
        method: "POST",
      },
    );
  }

  async loadPortability(
    workspaceId: string,
  ): Promise<
    Pick<IntegrationCapabilityData, "exports" | "imports" | "privateSpaces">
  > {
    const [exportResult, importResult, spaceResult] = await Promise.all([
      this.api.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/data-exports`,
      ),
      this.api.request<unknown>(
        `/api/v1/workspaces/${workspaceId}/data-imports`,
      ),
      this.api.request<unknown>(`/api/v1/workspaces/${workspaceId}/spaces`),
    ]);
    return {
      exports: listFrom<DataExport>(exportResult, "exports"),
      imports: listFrom<DataImport>(importResult, "imports"),
      privateSpaces: listFrom<Space>(spaceResult, "spaces").filter(
        (space) => space.visibility === "private",
      ),
    };
  }

  createExport(
    workspaceId: string,
    input: { confirmation: string; id: string },
  ): Promise<DataExport> {
    return this.api.request(`/api/v1/workspaces/${workspaceId}/data-exports`, {
      body: JSON.stringify(input),
      csrf: true,
      method: "POST",
    });
  }

  cancelExport(
    workspaceId: string,
    exportId: string,
    expectedVersion: number,
  ): Promise<DataExport> {
    return this.api.request(
      `/api/v1/workspaces/${workspaceId}/data-exports/${exportId}/cancel`,
      {
        body: JSON.stringify({ expected_version: expectedVersion }),
        csrf: true,
        method: "POST",
      },
    );
  }

  previewImport(
    workspaceId: string,
    input: {
      content: string;
      id: string;
      source_filename: string;
      source_format: DataImport["source_format"];
    },
  ): Promise<DataImport> {
    return this.api.request(
      `/api/v1/workspaces/${workspaceId}/data-imports/preview`,
      {
        body: JSON.stringify(input),
        csrf: true,
        method: "POST",
      },
    );
  }

  commitImport(
    workspaceId: string,
    importId: string,
    input: { expected_version: number; target_space_id: string },
  ): Promise<DataImport> {
    return this.api.request(
      `/api/v1/workspaces/${workspaceId}/data-imports/${importId}/commit`,
      {
        body: JSON.stringify({ ...input, confirmation: "IMPORT" }),
        csrf: true,
        method: "POST",
      },
    );
  }
}

export const integrationCapabilityService = new IntegrationCapabilityService(
  browserApiClient,
);
