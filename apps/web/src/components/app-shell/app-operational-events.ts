import { type OperationalCommand } from "./app-navigation";

const OPERATIONAL_EVENT_NAMES: Readonly<Record<OperationalCommand, string>> = {
  capture: "logion:open-capture",
  focus: "logion:open-focus",
};

export function operationalEventName(command: OperationalCommand): string {
  return OPERATIONAL_EVENT_NAMES[command];
}

export function requestOperationalCommand(command: OperationalCommand) {
  window.dispatchEvent(new Event(operationalEventName(command)));
}
