"use client";

import Link from "next/link";

import { usePersona } from "@/features/personas/persona-context";

import { isIntegrationEntryVisible } from "./integration-navigation";

export function IntegrationHubEntry() {
  const { activePersona } = usePersona();
  if (!isIntegrationEntryVisible(activePersona)) return null;

  return (
    <Link className="app-secondary-link" href="/app/integrations">
      打开互操作中心
    </Link>
  );
}
