import { rm } from "node:fs/promises";

import { authenticationStateDirectory } from "./e2e-environment";

export default async function globalTeardown(): Promise<void> {
  await rm(authenticationStateDirectory, { force: true, recursive: true });
}
