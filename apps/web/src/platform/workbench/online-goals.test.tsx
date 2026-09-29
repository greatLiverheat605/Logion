/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkbenchQueryClient, workbenchRequest } from "./api";
import { GoalList } from "./online-goals";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./provider", () => ({
  useWorkbench: () => ({
    context: { workspace_id: "workspace", space_id: "space" },
    workspaces: [{ id: "workspace", role: "owner" }],
    spaces: [{ id: "space", visibility: "private" }],
  }),
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  workbenchRequest: mocks.request,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps editing pending until the saved goal version is available for the next editor", async () => {
  const client = createWorkbenchQueryClient();
  const key = ["workbench", "goals", "scope"];
  const goal = {
    goal_id: "goal",
    goal_version: 1,
    plan_version: 1,
    title: "合成目标",
    desired_outcome: "解释模型",
    description: "",
    weekly_minutes: 120,
    target_date: null,
    goal_status: "draft",
    phases: [
      {
        id: "phase",
        title: "动机",
        description: "",
        position: 0,
        estimated_minutes: 30,
        acceptance_criteria: ["说明问题"],
        archived_at: null,
        removal_allowed: true,
      },
    ],
  };
  client.setQueryData(key, { goals: [goal] });
  let release!: () => void;
  let refreshing = false;
  const refresh = new Promise<{ goals: (typeof goal)[] }>((resolve) => {
    release = () => resolve({ goals: [{ ...goal, goal_version: 2 }] });
  });
  mocks.request.mockImplementation(
    async (path: string, options?: { method?: string }) => {
      if (path.endsWith("/capabilities"))
        return { phase_revision_enabled: true };
      if (options?.method === "PATCH") return { ...goal, goal_version: 2 };
      if (options?.method === "PUT") return { ...goal, goal_version: 3 };
      refreshing = true;
      return refresh;
    },
  );
  function Harness() {
    const query = useQuery({
      queryKey: key,
      staleTime: Infinity,
      queryFn: () =>
        workbenchRequest<components["schemas"]["OnlineGoalPage"]>(
          "scope/research/goals",
        ),
    });
    return (
      <GoalList
        scope="scope"
        goals={query.data?.goals ?? []}
        pending={query.isPending}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("合成目标"));
  fireEvent.click(await screen.findByRole("button", { name: "编辑目标" }));
  fireEvent.click(screen.getByRole("button", { name: "保存目标" }));
  await waitFor(() => expect(refreshing).toBe(true));
  expect(screen.queryByRole("dialog", { name: "编辑目标" })).not.toBeNull();
  expect(
    screen.getByRole("button", { name: "保存目标" }).closest("fieldset")
      ?.disabled,
  ).toBe(true);
  await act(async () => {
    release();
    await refresh;
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "编辑阶段" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "保存阶段",
    }),
  );
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(([, options]) => options?.method === "PUT"),
    ).toBe(true),
  );
  const write = mocks.request.mock.calls.find(
    ([, options]) => options?.method === "PUT",
  )!;
  expect(JSON.parse(write[1].body).expected_version).toBe(2);
});
