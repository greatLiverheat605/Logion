/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILTIN_PERSONAS } from "@/features/personas/persona-definitions";

const mocks = vi.hoisted(() => ({
  closeInspector: vi.fn(),
  pathname: "/app/today",
  persona: {} as Record<string, unknown>,
  vault: { phase: "unlocked" },
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/app-shell/app-modal", () => ({
  AppModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/app-shell/app-operational-tools", () => ({
  AppOperationalTools: () => null,
}));

vi.mock("@/components/app-shell/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

vi.mock("@/features/auth/logout-button", () => ({ LogoutButton: () => null }));

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({ state: { status: "anonymous" } }),
}));

vi.mock("@/features/desk/command-feedback-context", () => ({
  useInspector: () => ({
    closeInspector: mocks.closeInspector,
    inspector: { body: "对象详情", title: "对象 A" },
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.vault,
}));

vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => mocks.persona,
}));

vi.mock("@/lib/api/client", () => ({
  browserApiClient: { request: vi.fn() },
}));

import { AppShell } from "./app-shell";

const learningPersona = BUILTIN_PERSONAS.find(
  (persona) => persona.id === "self",
)!;
const researchPersona = BUILTIN_PERSONAS.find(
  (persona) => persona.id === "research",
)!;

beforeEach(() => {
  mocks.closeInspector.mockReset();
  mocks.pathname = "/app/today";
  mocks.vault.phase = "unlocked";
  Object.assign(mocks.persona, {
    activePersona: learningPersona,
    allPersonas: BUILTIN_PERSONAS,
    isLoading: false,
    isRouteVisible: () => true,
    setActivePersona: vi.fn(),
  });
});

afterEach(cleanup);

describe("AppShell Inspector lifecycle", () => {
  it("clears Inspector when the route changes", () => {
    const view = render(<AppShell>内容</AppShell>);
    mocks.closeInspector.mockClear();

    mocks.pathname = "/app/settings";
    view.rerender(<AppShell>内容</AppShell>);

    expect(mocks.closeInspector).toHaveBeenCalled();
  });

  it("clears Inspector when the Vault locks", () => {
    const view = render(<AppShell>内容</AppShell>);
    mocks.closeInspector.mockClear();

    mocks.vault.phase = "locked";
    view.rerender(<AppShell>内容</AppShell>);

    expect(mocks.closeInspector).toHaveBeenCalled();
  });

  it("clears Inspector when the active Workbench Persona changes", () => {
    const view = render(<AppShell>内容</AppShell>);
    mocks.closeInspector.mockClear();

    mocks.persona.activePersona = researchPersona;
    view.rerender(<AppShell>内容</AppShell>);

    expect(mocks.closeInspector).toHaveBeenCalled();
  });
});
