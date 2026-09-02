"use client";

import { PlanningWorkbench } from "./planning-workbench";
import { usePlanningController } from "./use-planning-controller";

export function PlanningCenter() {
  return <PlanningWorkbench controller={usePlanningController()} />;
}
