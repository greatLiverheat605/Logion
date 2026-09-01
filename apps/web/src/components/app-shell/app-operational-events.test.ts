/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import {
  operationalEventName,
  requestOperationalCommand,
} from "./app-operational-events";
import { GLOBAL_CAPTURE_TRIGGER_CLASS } from "./app-operational-tools";

describe("operational command events", () => {
  it("keeps global capture discoverable without marking it primary", () => {
    expect(GLOBAL_CAPTURE_TRIGGER_CLASS).toContain("app-capture-trigger");
    expect(GLOBAL_CAPTURE_TRIGGER_CLASS).not.toContain("primary");
  });

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
