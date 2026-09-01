/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>(
    "@/lib/api/client",
  );
  return { ...actual, browserApiClient: { request } };
});

import { SecurityCenter } from "./security-center";

afterEach(cleanup);

const device = {
  current: true,
  id: "device-1",
  name: "工作电脑",
  platform: "Windows",
  revoked_at: null,
};

const passkey = {
  credential_device_type: "platform",
  id: "passkey-1",
  name: "工作电脑认证器",
  revoked_at: null,
};

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path: string) => {
    if (path === "/api/v1/auth/devices") return { devices: [device] };
    if (path === "/api/v1/auth/passkeys") return { credentials: [passkey] };
    if (path === "/api/v1/auth/totp") {
      return { enabled: true, recovery_codes_remaining: 7 };
    }
    return {};
  });
});

describe("Security workbench", () => {
  it("renders checklist master, settings main, and security inspector", async () => {
    const { container } = render(<SecurityCenter />);

    expect(screen.getByText("保护清单")).toBeTruthy();
    expect(screen.getByText("账户安全")).toBeTruthy();
    expect(screen.getByText("保护摘要")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("安全设置已更新。").length).toBeGreaterThan(0));
    expect(container.querySelectorAll('[data-workbench-primary="true"]')).toHaveLength(0);
    expect(container.querySelector(".planning-form")).toBeNull();
    expect(container.textContent).not.toContain("ProductPanel");
  });

  it("keeps one page primary when TOTP is not enabled", async () => {
    request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/auth/devices") return { devices: [device] };
      if (path === "/api/v1/auth/passkeys") return { credentials: [] };
      if (path === "/api/v1/auth/totp") {
        return { enabled: false, recovery_codes_remaining: 0 };
      }
      return {};
    });

    const { container } = render(<SecurityCenter />);

    await waitFor(() => expect(screen.getByRole("button", { name: "启用 TOTP" })).toBeTruthy());
    expect(container.querySelectorAll('[data-workbench-primary="true"]')).toHaveLength(1);
  });

  it("exposes passkey and authenticator actions without leaving the workbench", async () => {
    render(<SecurityCenter />);

    fireEvent.click(screen.getByRole("button", { name: /^登录凭据/ }));
    await waitFor(() => expect(screen.getByText("工作电脑认证器")).toBeTruthy());
    expect(screen.getByRole("button", { name: "添加 Passkey" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^认证器与恢复/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "管理 TOTP 与恢复码" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "管理 TOTP 与恢复码" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^设备与会话/ }));
    await waitFor(() => expect(screen.getByText("工作电脑")).toBeTruthy());
    expect(screen.getByRole("button", { name: "撤销" })).toBeTruthy();
  });
});
