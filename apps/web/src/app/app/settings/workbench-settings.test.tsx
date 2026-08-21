/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maliciousName = '<img src=x onerror="alert(1)">';
const definition = {
  accent: "cyan",
  createdAt: "2026-08-20T00:00:00Z",
  description: "安全文本",
  icon: "microscope",
  id: "123e4567-e89b-42d3-a456-426614174000",
  lifecycle: "active",
  name: maliciousName,
  ownerUserId: "223e4567-e89b-42d3-a456-426614174000",
  revision: 1,
  templateId: "fixed.research",
  updatedAt: "2026-08-20T00:00:00Z",
};

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  createWorkbench: vi.fn(),
  deleteWorkbench: vi.fn(),
  getDeletionImpact: vi.fn(),
  loadWorkbench: vi.fn(),
  updateWorkbench: vi.fn(),
}));

vi.mock("@/features/workbenches/workbench-context", () => ({
  useWorkbench: () => mocks.context,
}));

import { WorkbenchSettings } from "./workbench-settings";

beforeEach(() => {
  mocks.createWorkbench.mockReset().mockResolvedValue(undefined);
  mocks.deleteWorkbench.mockReset().mockResolvedValue(undefined);
  mocks.loadWorkbench.mockReset();
  mocks.updateWorkbench.mockReset().mockResolvedValue(undefined);
  mocks.getDeletionImpact.mockReset().mockResolvedValue({
    fallbackWorkbenchId: "fixed.learning",
    formalObjectDeleteCount: 0,
    impactFingerprint: "signed",
    linkCount: 2,
    linkSetRevision: 1,
    preferenceWillFallback: true,
    revision: 1,
    workbenchId: definition.id,
  });
  Object.assign(mocks.context, {
    activeWorkbench: {
      description: "学习",
      icon: "📚",
      kind: "fixed",
      lifecycle: "active",
      name: "学习",
      ref: "fixed.learning",
    },
    createWorkbench: mocks.createWorkbench,
    definitions: [definition],
    deleteWorkbench: mocks.deleteWorkbench,
    exportWorkbench: vi.fn(),
    getDeletionImpact: mocks.getDeletionImpact,
    importWorkbench: vi.fn(),
    invalidPreferenceSource: null,
    loadWorkbench: mocks.loadWorkbench,
    migrateLegacyPersonas: vi.fn(),
    options: [
      {
        description: "学习",
        icon: "📚",
        kind: "fixed",
        lifecycle: "active",
        name: "学习",
        ref: "fixed.learning",
      },
    ],
    phase: "ready",
    refresh: vi.fn(),
    resolveDefinitionConflict: vi.fn(),
    selectWorkbench: vi.fn(),
    setWorkbenchLifecycle: vi.fn(),
    updateWorkbench: mocks.updateWorkbench,
  });
});

afterEach(cleanup);

describe("WorkbenchSettings", () => {
  it("renders server text without creating executable markup", () => {
    const view = render(<WorkbenchSettings />);

    expect(screen.getByText(maliciousName, { exact: true })).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("creates from a controlled template without owner or permission fields", async () => {
    render(<WorkbenchSettings />);
    fireEvent.click(screen.getByRole("button", { name: "新建工作台" }));
    const dialog = screen.getByRole("dialog", { name: "新建工作台" });
    fireEvent.change(within(dialog).getByLabelText("名称"), {
      target: { value: "论文推进" },
    });
    fireEvent.change(within(dialog).getByLabelText("模板"), {
      target: { value: "fixed.research" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存工作台" }));

    await waitFor(() => expect(mocks.createWorkbench).toHaveBeenCalledTimes(1));
    const document = mocks.createWorkbench.mock.calls[0]?.[0];
    expect(
      document.payload.modules.map((module: { kind: string }) => module.kind),
    ).toEqual(["next-action", "sources", "evidence", "graph-projection"]);
    expect(document).not.toHaveProperty("ownerUserId");
    expect(document).not.toHaveProperty("workspaceId");
  });

  it("keeps module IDs and layout coverage valid while editing selections", async () => {
    const document = {
      contract: "workbench.definition" as const,
      schemaVersion: 1 as const,
      payload: {
        accent: "cyan" as const,
        description: "Safe text",
        fieldDefinitions: [],
        filters: [],
        icon: "microscope" as const,
        layout: {
          columns: 2,
          items: [
            {
              moduleId: "remove-next",
              order: 2,
              region: "main" as const,
              span: 1,
            },
            {
              moduleId: "keep-source",
              order: 4,
              region: "side" as const,
              span: 1,
            },
          ],
        },
        modules: [
          { id: "remove-next", kind: "next-action" as const },
          { id: "keep-source", kind: "sources" as const },
        ],
        name: maliciousName,
        quickCreate: [],
        templateId: "fixed.research" as const,
      },
    };
    mocks.loadWorkbench.mockResolvedValue({ ...definition, document });
    render(<WorkbenchSettings />);
    const row = screen
      .getByText(maliciousName, { exact: true })
      .closest("article")!;
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    const dialog = await screen.findByRole("dialog");
    const nextAction = dialog.querySelector<HTMLInputElement>(
      'input[name="modules"][value="next-action"]',
    )!;
    const evidence = dialog.querySelector<HTMLInputElement>(
      'input[name="modules"][value="evidence"]',
    )!;
    fireEvent.click(nextAction);
    fireEvent.click(evidence);
    fireEvent.submit(dialog.querySelector("form")!);

    await waitFor(() => expect(mocks.updateWorkbench).toHaveBeenCalledTimes(1));
    const saved = mocks.updateWorkbench.mock.calls[0]?.[1];
    expect(saved.payload.modules).toEqual([
      { id: "keep-source", kind: "sources" },
      { id: "module-evidence", kind: "evidence" },
    ]);
    expect(saved.payload.layout.items).toEqual([
      { moduleId: "keep-source", order: 4, region: "side", span: 1 },
      { moduleId: "module-evidence", order: 0, region: "main", span: 1 },
    ]);
    expect(
      new Set(
        saved.payload.layout.items.map(
          (item: { moduleId: string }) => item.moduleId,
        ),
      ),
    ).toEqual(
      new Set(saved.payload.modules.map((module: { id: string }) => module.id)),
    );
  });

  it("requires exact-name confirmation after showing deletion impact", async () => {
    render(<WorkbenchSettings />);
    fireEvent.click(
      screen.getByRole("button", { name: `删除工作台：${maliciousName}` }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: `删除「${maliciousName}」`,
    });
    expect(within(dialog).getByText(/2 个引用/)).toBeTruthy();
    expect(within(dialog).getByText(/正式对象删除数为 0/)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("输入工作台名称确认"), {
      target: { value: "wrong" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除配置" }));
    expect(mocks.deleteWorkbench).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("完整工作台名称");

    fireEvent.change(within(dialog).getByLabelText("输入工作台名称确认"), {
      target: { value: maliciousName },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除配置" }));
    await waitFor(() => expect(mocks.deleteWorkbench).toHaveBeenCalledTimes(1));
  });
});
