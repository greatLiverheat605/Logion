import type { ReactNode } from "react";

import { SessionBoundary } from "@/features/auth/session-boundary";
import { VaultSessionProvider } from "@/features/offline/vault-session-provider";
import { PersonaProvider } from "@/features/personas/persona-context";

export default function OnboardingLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionBoundary publicFlow>
      <PersonaProvider>
        <VaultSessionProvider>{children}</VaultSessionProvider>
      </PersonaProvider>
    </SessionBoundary>
  );
}
