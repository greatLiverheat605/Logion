import type { ReactNode } from "react";

import { SessionBoundary } from "@/features/auth/session-boundary";
import { PersonaProvider } from "@/features/personas/persona-context";

export default function OnboardingLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SessionBoundary>
      <PersonaProvider>{children}</PersonaProvider>
    </SessionBoundary>
  );
}
