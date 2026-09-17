/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { components } from "@logion/contracts";
import { ProviderDiagnostics } from "./provider-diagnostics";
afterEach(cleanup);
function provider(
  fields: Partial<components["schemas"]["AIProviderResponse"]>,
) {
  return {
    last_health_status: "unknown",
    ...fields,
  } as components["schemas"]["AIProviderResponse"];
}
describe("Provider diagnostics", () => {
  it("shows stored health, time and actionable safe classification", () => {
    render(
      <ProviderDiagnostics
        provider={provider({
          last_health_status: "unhealthy",
          last_health_checked_at: "2026-09-01T00:00:00Z",
          last_health_error_code: "AI_PROVIDER_DNS_BLOCKED",
        })}
      />,
    );
    expect(screen.getByText("未通过")).toBeTruthy();
    expect(document.querySelector("time")?.dateTime).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(screen.getByText(/不要放宽地址安全限制/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("does not echo unknown diagnostic payload or invalid timestamp", () => {
    render(
      <ProviderDiagnostics
        provider={provider({
          last_health_error_code: "https://example.test/private-detail",
          last_health_checked_at: "invalid",
        })}
      />,
    );
    expect(screen.getByText("其他连接错误")).toBeTruthy();
    expect(screen.getByText("暂无可用时间")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-detail");
    expect(screen.getByText(/不代表当前实时连通性/)).toBeTruthy();
  });
});
