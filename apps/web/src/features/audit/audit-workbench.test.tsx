/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
  return { ...actual, browserApiClient: { request } };
});

import { AuditLog } from "./audit-log";

afterEach(cleanup);

const loginEvent = {
  actor_id: "user-1",
  event_type: "identity.login",
  id: "event-1",
  occurred_at: "2026-08-28T01:00:00Z",
  result: "success",
  target_id: "session-1",
  target_type: "session",
};

const deniedEvent = {
  actor_id: "user-1",
  event_type: "identity.password_reset",
  id: "event-2",
  occurred_at: "2026-08-28T00:55:00Z",
  result: "denied",
  target_id: "request-2",
  target_type: "account",
};

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(
    async (path: string, options?: { query?: Record<string, string> }) => {
      const query =
        options?.query ??
        Object.fromEntries(
          new URL(path, "http://localhost").searchParams.entries(),
        );
      if (query.cursor === "cursor-1") {
        return { events: [deniedEvent], next_cursor: null };
      }
      return { events: [loginEvent], next_cursor: "cursor-1" };
    },
  );
});

describe("Audit workbench", () => {
  it("sends audit pagination filters through the API query option", async () => {
    render(<AuditLog />);

    await waitFor(() =>
      expect(screen.getAllByText("identity.login").length).toBeGreaterThan(0),
    );

    expect(request).toHaveBeenCalledWith("/api/v1/audit/me", {
      query: { page_size: "50" },
    });
  });

  it("renders filter master, timeline main, and event inspector without legacy panels", async () => {
    const { container } = render(<AuditLog />);

    await waitFor(() =>
      expect(screen.getAllByText("identity.login").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("审计筛选").length).toBeGreaterThan(0);
    expect(screen.getAllByText("活动时间线").length).toBeGreaterThan(0);
    expect(screen.getAllByText("事件详情").length).toBeGreaterThan(0);
    expect(
      container.querySelector('[data-testid="audit-filters"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="audit-timeline"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="audit-event-detail"]'),
    ).toBeTruthy();
    expect(container.querySelector(".planning-form")).toBeNull();
    expect(container.textContent).not.toContain("ProductPanel");
    expect(
      container.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
  });

  it("selects an event in place and exposes its result and event id", async () => {
    render(<AuditLog />);

    await waitFor(() =>
      expect(screen.getAllByText("identity.login").length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByRole("button", { name: /identity\.login/ }));

    expect(screen.getAllByText("success").length).toBeGreaterThan(0);
    expect(screen.getByText("event-1")).toBeTruthy();
  });

  it("loads the next cursor from the timeline action", async () => {
    render(<AuditLog />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "加载更多" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() =>
      expect(screen.getByText("identity.password_reset")).toBeTruthy(),
    );
    expect(request).toHaveBeenCalledWith("/api/v1/audit/me", {
      query: { page_size: "50", cursor: "cursor-1" },
    });
  });
});
