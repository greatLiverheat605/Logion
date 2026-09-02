/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OutboxEntry } from "@logion/offline";

import { SyncWorkbench, type SyncWorkbenchProps } from "./sync-workbench";
import type { ConflictView } from "./offline-sync-center";

const workspace = {
  created_at: "2026-08-28T00:00:00.000Z",
  id: "workspace-1",
  membership_status: "active",
  name: "Logion",
  role: "owner",
  status: "active",
  updated_at: "2026-08-28T00:00:00.000Z",
  version: 1,
} as const;

const device = {
  current: true,
  first_seen_at: "2026-08-28T00:00:00.000Z",
  id: "device-1",
  last_seen_at: "2026-08-28T00:00:00.000Z",
  name: "开发机",
  platform: "web",
  revoked_at: null,
} as const;

function outboxEntry(): OutboxEntry {
  return {
    operation_id: "operation-1",
    protocol_version: "sync-v1",
    workspace_id: "workspace-1",
    device_id: "device-1",
    entity_type: "note",
    entity_id: "note-1",
    operation_type: "update",
    base_version: 1,
    client_occurred_at: "2026-08-28T00:00:00.000Z",
    payload: { title: "Local" },
    payload_hash: "hash-1",
    dependencies: [],
    outbox_state: "pending",
    attempt_count: 2,
    next_attempt_at: null,
    last_error_code: "NETWORK_OFFLINE",
    queued_at: "2026-08-28T00:00:00.000Z",
  } as OutboxEntry;
}

function props(
  overrides: Partial<SyncWorkbenchProps> = {},
): SyncWorkbenchProps {
  return {
    accessIssue: null,
    attachments: [],
    clearConfirmation: "",
    connection: "online",
    conflicts: [],
    deviceId: device.id,
    devices: [device],
    lock: vi.fn(),
    loading: false,
    mergeConflictId: null,
    mergeDraft: "",
    onClearConfirmationChange: vi.fn(),
    onClearDevice: vi.fn(),
    onCopyLocal: vi.fn(),
    onDismiss: vi.fn(),
    onMergeDraftChange: vi.fn(),
    onMergeOpen: vi.fn(),
    onMergeOpenChange: vi.fn(),
    onReload: vi.fn(),
    onResolve: vi.fn(),
    onSynchronize: vi.fn(),
    onUnlock: vi.fn(),
    onUpload: vi.fn(),
    onWorkspaceChange: vi.fn(),
    outbox: [outboxEntry()],
    queueSummary: {
      blocked: 0,
      conflict: 0,
      in_flight: 0,
      isolated: 0,
      pending: 1,
      total: 1,
    },
    status: "已读取同步上下文。",
    syncState: null,
    syncing: false,
    unlocked: true,
    vaultPhase: "unlocked",
    workspaceId: workspace.id,
    workspaces: [workspace],
    ...overrides,
  };
}

function conflict(): ConflictView {
  return {
    conflict: {
      conflict_id: "conflict-1",
      entity_type: "note",
      entity_id: "note-1",
      status: "open",
      conflict_kind: "content",
      base_version: 1,
      remote_version: 2,
      local_payload: { title: "Local" },
      local_payload_hash: "local-hash",
      remote_payload: { title: "Remote" },
      remote_payload_hash: "remote-hash",
      resolution_options: ["keep_local", "keep_remote", "merge", "dismiss"],
      workspace_id: workspace.id,
      source_device_id: device.id,
      source_operation_id: "operation-1",
      server_recorded: false,
      resolution_operation_id: null,
      requested_resolution: null,
      resolved_at: null,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    } as ConflictView["conflict"],
    local: { title: "Local" },
    remote: { title: "Remote" },
  };
}

describe("SyncWorkbench", () => {
  it("renders the three-pane sync contract and one page primary", () => {
    render(<SyncWorkbench {...props()} />);

    expect(screen.getByTestId("sync-master")).toBeTruthy();
    expect(screen.getByTestId("sync-main")).toBeTruthy();
    expect(screen.getByTestId("sync-inspector")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "重试次数" })).toBeTruthy();
    expect(screen.getByText("NETWORK_OFFLINE")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    expect(document.body.textContent).not.toContain("真实同步拓扑与设备");
    expect(document.body.textContent).not.toContain("同步队列诊断");
  });

  it("keeps conflict actions reachable and exposes the conflict deep link", () => {
    render(<SyncWorkbench {...props({ conflicts: [conflict()] })} />);

    expect(screen.getByRole("button", { name: "处理冲突" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "复制本地版本为新对象" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂不处理" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "1 项待处理" }).getAttribute("href"),
    ).toBe("/app/sync?tab=conflict");
  });

  it("shows loading, permission and capability state exits", () => {
    const rendered = render(
      <SyncWorkbench
        {...props({ accessIssue: "permission", loading: false, deviceId: "" })}
      />,
    );

    expect(screen.getByTestId("sync-access-state")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新读取" })).toBeTruthy();
    rendered.unmount();
    render(
      <SyncWorkbench
        {...props({ accessIssue: null, loading: false, deviceId: "" })}
      />,
    );
    expect(screen.getByTestId("sync-capability-disabled")).toBeTruthy();
  });
});
