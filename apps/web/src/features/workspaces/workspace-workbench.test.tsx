import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceWorkbenchController } from "./use-workspaces-controller";
import {
  SpacesWorkbench,
  WorkspaceGovernanceWorkbench,
} from "./workspace-workbench";

function controller(): WorkspaceWorkbenchController {
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
  return {
    capabilities: {
      canCreatePrivateSpace: true,
      canCreateSharedSpace: true,
      canInvite: true,
      canManageMembers: true,
      canTransferOwnership: true,
    },
    commands: {
      createSpace: vi.fn(),
      createWorkspace: vi.fn(),
      invite: vi.fn(),
      leaveWorkspace: vi.fn(),
      load: vi.fn(),
      revokeInvitation: vi.fn(),
      selectSpace: vi.fn(),
      selectWorkspace: vi.fn(),
      transferOwnership: vi.fn(),
      updateMember: vi.fn(),
    },
    context: {
      selectedSpace: space,
      selectedWorkspace: workspace,
      spaces: [space],
      status: "已读取工作区上下文。",
      workspaces: [workspace],
    },
    invitations: [],
    loading: false,
    members: [
      {
        created_at: "2026-08-26T12:00:00.000Z",
        email: "owner@example.com",
        id: "member-1",
        joined_at: "2026-08-26T12:00:00.000Z",
        revoked_at: null,
        role: "owner",
        status: "active",
        updated_at: "2026-08-26T12:00:00.000Z",
        user_id: "user-1",
        version: 1,
      },
    ],
  };
}

describe("workspace route-specific workbenches", () => {
  it("renders governance as member and invitation workbench", () => {
    const html = renderToStaticMarkup(
      <WorkspaceGovernanceWorkbench controller={controller()} />,
    );

    expect(html).toContain('data-testid="workspaces-members-master"');
    expect(html).toContain('data-testid="workspaces-members-main"');
    expect(html).toContain('data-testid="workspaces-inspector"');
    expect(html).toContain("成员");
    expect(html).toContain("邀请");
    expect(html).toContain("工作区信息");
    expect(html).toContain("危险操作");
    expect(html).toContain("邀请新成员");
    expect(html).not.toContain("product-panel");
    expect(html).not.toContain("planning-form");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });

  it("renders spaces as a directory with access inspector", () => {
    const html = renderToStaticMarkup(
      <SpacesWorkbench controller={controller()} />,
    );

    expect(html).toContain('data-testid="spaces-directory-master"');
    expect(html).toContain('data-testid="spaces-access-main"');
    expect(html).toContain('data-testid="spaces-inspector"');
    expect(html).toContain("空间目录");
    expect(html).toContain("个人空间");
    expect(html).toContain("共享可见性");
    expect(html).toContain("创建空间");
    expect(html).toContain("移入共享空间");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });
});
