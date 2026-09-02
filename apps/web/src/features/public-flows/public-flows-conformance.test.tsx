// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { AcceptInvitationForm } from "@/features/workspaces/accept-invitation-form";
import { PublicShareView } from "@/features/growth/public-share";
import { AccountDeletionRecovery } from "@/features/portability/account-deletion-recovery";
import OfflinePage from "@/app/offline/page";
import NotFoundPage from "@/app/not-found";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request },
  LogionApiError: class LogionApiError extends Error {
    code = "request_failed";
    requestId = "req-test";
  },
}));

vi.mock("@/features/auth/use-fragment-token", () => ({
  useFragmentToken: () => "invite-token-123456789012345678901234567890",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("public flow GLM structure", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({
      id: "deletion-1",
      status: "pending",
      owned_workspace_ids: ["workspace-1", "workspace-2"],
      policy_version: "account-deletion-v2",
      version: 3,
      requested_at: "2026-08-28T00:00:00Z",
      delete_after: "2026-09-11T00:00:00Z",
      cancelled_at: null,
      completed_at: null,
    });
  });

  it("renders invitation summary and explicit recovery regions", () => {
    render(<AcceptInvitationForm />);
    expect(screen.getByTestId("invite-summary")).toBeTruthy();
    expect(screen.getByTestId("invite-role")).toBeTruthy();
    expect(screen.getByTestId("invite-action")).toBeTruthy();
    expect(screen.getByTestId("invite-recovery")).toBeTruthy();
  });

  it("renders a wide read-only share with metadata and snapshot regions", async () => {
    request.mockResolvedValueOnce({
      title: "分布式目标",
      object_type: "goal_plan",
      snapshot: { status: "进行中", phases: [{ title: "第一阶段" }] },
      expires_at: "2026-09-23T00:00:00Z",
    });
    render(<PublicShareView token="share-token" />);
    await waitFor(() =>
      expect(screen.getByTestId("share-metadata")).toBeTruthy(),
    );
    expect(screen.getByTestId("share-snapshot")).toBeTruthy();
    expect(screen.getByTestId("share-state")).toBeTruthy();
  });

  it("renders deletion impact, permission, confirmation and recovery regions", async () => {
    render(<AccountDeletionRecovery />);
    await waitFor(() =>
      expect(screen.getByTestId("deletion-impact")).toBeTruthy(),
    );
    expect(screen.getByTestId("deletion-permission")).toBeTruthy();
    expect(screen.getByTestId("deletion-confirmation")).toBeTruthy();
    expect(screen.getByTestId("deletion-recovery")).toBeTruthy();
  });

  it("renders dedicated recovery layouts for offline and not-found states", () => {
    render(<OfflinePage />);
    expect(screen.getByTestId("offline-state")).toBeTruthy();
    expect(screen.getByTestId("offline-local")).toBeTruthy();
    expect(screen.getByTestId("offline-recovery")).toBeTruthy();

    render(<NotFoundPage />);
    expect(screen.getByTestId("not-found-state")).toBeTruthy();
    expect(screen.getByTestId("not-found-recovery")).toBeTruthy();
  });
});
