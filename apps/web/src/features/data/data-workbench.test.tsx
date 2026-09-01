import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DataWorkbench } from "./data-workbench";
import type { DataControllerResult } from "./use-data-controller";
import type { DataImport } from "@/features/integrations/integration-capability-model";

function controller(overrides: Partial<DataControllerResult["context"]> = {}): DataControllerResult {
  const workspace = {
    created_at: "2026-08-26T12:00:00.000Z",
    id: "workspace-1",
    membership_status: "active",
    name: "个人工作区",
    role: "owner",
    status: "active",
    updated_at: "2026-08-26T12:00:00.000Z",
    version: 3,
  } as const;
  const space = {
    created_at: "2026-08-26T12:00:00.000Z",
    id: "space-1",
    name: "私人资料",
    owner_user_id: "user-1",
    status: "active",
    updated_at: "2026-08-26T12:00:00.000Z",
    version: 1,
    visibility: "private",
    workspace_id: "workspace-1",
  } as const;
  const exportItem = {
    artifact_bytes: 128,
    artifact_sha256: "abc123",
    completed_at: "2026-08-26T12:05:00.000Z",
    created_at: "2026-08-26T12:00:00.000Z",
    error_code: null,
    expires_at: "2026-08-27T12:00:00.000Z",
    id: "export-1",
    schema_version: "logion-export-v1",
    status: "succeeded",
    version: 1,
    workspace_id: "workspace-1",
  } as const;
  const importItem: DataImport = {
    counts: { note: 2 },
    created_at: "2026-08-26T12:00:00.000Z",
    expires_at: "2026-08-27T12:00:00.000Z",
    id: "import-1",
    imported_at: null,
    imported_space_id: null,
    source_filename: "notes.md",
    source_format: "markdown",
    source_sha256: "def456",
    status: "previewed",
    version: 1,
    warnings: [],
    workspace_id: "workspace-1",
  };
  const context = {
    dataState: "ready" as const,
    exports: [exportItem],
    imports: [importItem],
    lastLoadedAt: "2026-08-26T12:06:00.000Z",
    selectedExport: exportItem,
    selectedImport: null,
    selectedSpace: space,
    selectedWorkspace: workspace,
    spaces: [space],
    status: "数据边界已读取。",
    tab: "exports" as const,
    workspaces: [workspace],
    ...overrides,
  };
  return {
    capabilities: { canDeleteAccount: true, canExport: true, canImport: true },
    commands: {
      cancelExport: vi.fn(async () => true),
      commitImport: vi.fn(async () => true),
      createExport: vi.fn(async () => true),
      load: vi.fn(async () => true),
      previewImport: vi.fn(async () => true),
      requestAccountDeletion: vi.fn(async () => true),
      selectExport: vi.fn(),
      selectImport: vi.fn(),
      selectTab: vi.fn(),
      selectWorkspace: vi.fn(),
    },
    context,
    loading: false,
  };
}

describe("data sovereignty workbench", () => {
  it("renders export master, data view main and isolated danger inspector", () => {
    const html = renderToStaticMarkup(<DataWorkbench controller={controller()} />);

    expect(html).toContain('data-testid="data-master"');
    expect(html).toContain('data-testid="data-main"');
    expect(html).toContain('data-testid="data-inspector"');
    expect(html).toContain('data-testid="data-export-detail"');
    expect(html).toContain("数据主权");
    expect(html).toContain("创建加密导出");
    expect(html).toContain("危险区");
    expect(html).not.toContain("product-panel");
    expect(html).not.toContain("planning-form");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });

  it("keeps import previews bounded to private spaces", () => {
    const importItem = controller().context.imports[0];
    const html = renderToStaticMarkup(
      <DataWorkbench
        controller={controller({
          selectedExport: null,
          selectedImport: importItem,
          tab: "imports",
        })}
      />,
    );

    expect(html).toContain('data-testid="data-import-detail"');
    expect(html).toContain("Private Space");
    expect(html).toContain("不会恢复原权限或原始 ID");
    expect(html).toContain("生成导入预览");
    expect(html).toContain("确认写入 Private Space");
    expect(html).toContain('id="data-import-target"');
    expect(html).not.toContain('onchange="');
  });

  it("explains empty workspace and disabled import capability", () => {
    const html = renderToStaticMarkup(
      <DataWorkbench
        controller={controller({
          dataState: "empty",
          exports: [],
          imports: [],
          selectedExport: null,
          selectedImport: null,
          selectedSpace: null,
          selectedWorkspace: null,
          spaces: [],
          workspaces: [],
        })}
      />,
    );

    expect(html).toContain("没有可访问 Workspace");
    expect(html).toContain("管理 Workspace");
    expect(html).not.toContain("生成导入预览");
  });
});
