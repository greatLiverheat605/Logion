"use client";

import { useState } from "react";

import { SearchWorkbench } from "./search-workbench";
import { type SearchScope, useSearchController } from "./use-search-controller";

export function EngagementCenter() {
  const [scope, setScope] = useState<SearchScope>("all");
  const controller = useSearchController(scope);

  return (
    <SearchWorkbench
      controller={controller}
      onScopeChange={setScope}
      scope={scope}
    />
  );
}
