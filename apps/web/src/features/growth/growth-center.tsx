"use client";

import { TemplatesWorkbench } from "./templates-workbench";
import { useTemplatesController } from "./use-templates-controller";

export function GrowthCenter() {
  const controller = useTemplatesController();
  return <TemplatesWorkbench {...controller} />;
}
