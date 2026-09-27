/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { LogionApiError } from "@/lib/api/client";
import { createWorkbenchQueryClient } from "./api";
import { Library } from "./library";

const mocks = vi.hoisted(() => ({ request: vi.fn(), space: "space-a" }));
vi.mock("./provider", () => ({
  useWorkbench: () => ({
    context: { workspace_id: "workspace", space_id: mocks.space },
  }),
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  workbenchRequest: mocks.request,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.space = "space-a";
});

it("retains failed edits and preserves metadata and the original version when saving", async () => {
  const resource = {
    id: "synthetic",
    title: "Synthetic paper",
    resource_type: "paper",
    reading_status: "unread",
    version: 7,
    csl: {
      author: [{ given: "Example", family: "Researcher" }],
      issued: { "date-parts": [[2024, 2, 29]] },
      volume: "12",
    },
    file_locator: { kind: "url", path: "https://example.com/paper.pdf" },
    zotero_version: 3,
  };
  let fail = true;
  mocks.request.mockImplementation(
    async (path: string, options?: { method?: string; body?: string }) => {
      if (options?.method === "PUT") {
        if (fail)
          throw new LogionApiError({
            status: 409,
            code: "RESOURCE_VERSION_CONFLICT",
            message: "Conflict",
          });
        return { ...resource, ...JSON.parse(options.body!), version: 8 };
      }
      return path.endsWith("/synthetic")
        ? resource
        : { resources: [resource], next_cursor: null };
    },
  );
  const client = createWorkbenchQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <Library />
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Synthetic paper/ }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "编辑文献" }));
  const dialog = screen.getByRole("dialog", { name: "编辑文献" });
  fireEvent.change(within(dialog).getByLabelText("标题"), {
    target: { value: "Edited title" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存文献" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "当前输入已保留",
  );
  expect(
    (within(dialog).getByLabelText("标题") as HTMLInputElement).value,
  ).toBe("Edited title");
  fail = false;
  fireEvent.click(within(dialog).getByRole("button", { name: "保存文献" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const writes = mocks.request.mock.calls.filter(
    ([, options]) => options?.method === "PUT",
  );
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[1]![1].body)).toMatchObject({
    title: "Edited title",
    expected_version: 7,
    csl: resource.csl,
    file_locator: resource.file_locator,
    zotero_version: 3,
  });
  mocks.space = "space-b";
  mocks.request.mockResolvedValue({ resources: [], next_cursor: null });
  view.rerender(
    <QueryClientProvider client={client}>
      <Library />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Edited title")).toBeNull();
  await screen.findByText("这里还没有文献");
});
