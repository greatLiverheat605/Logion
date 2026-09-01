"use client";

import { TodayWorkbench } from "./today-workbench";
import { useTodayController } from "./use-today-controller";

export function TodayCenter() {
  return <TodayWorkbench controller={useTodayController()} />;
}
