"use client";

import { RecordsWorkbench } from "./records-workbench";
import { useRecordsController } from "./use-records-controller";

export function ContentCenter() {
  return <RecordsWorkbench controller={useRecordsController()} />;
}
