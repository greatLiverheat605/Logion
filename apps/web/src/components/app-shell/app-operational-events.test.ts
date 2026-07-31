/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import {
  operationalEventName,
  requestOperationalCommand,
} from "./app-operational-events";

describe("operational command events", () => {
  it.each(["capture", "focus"] as const)(
    "dispatches the existing %s tool request",
    (command) => {
      const listener = vi.fn();
      const eventName = operationalEventName(command);
      window.addEventListener(eventName, listener);

      requestOperationalCommand(command);

      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener(eventName, listener);
    },
  );
});
