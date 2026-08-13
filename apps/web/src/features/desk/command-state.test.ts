import { describe, expect, it } from "vitest";

import { classifyCommandError } from "@/features/desk/command-state";
import { LogionApiError } from "@/lib/api/client";

describe("classifyCommandError", () => {
  it("classifies a 409 LogionApiError as a conflict", () => {
    const error = new LogionApiError({
      code: "INVITATION_CONFLICT",
      message: "conflict",
      requestId: "req-1",
      status: 409,
    });
    const state = classifyCommandError(error);
    expect(state.kind).toBe("conflict");
    expect(state.requestId).toBe("req-1");
    expect(state.error).toBe(error);
  });

  it("classifies a 403 as permission_denied", () => {
    const error = new LogionApiError({
      code: "FORBIDDEN",
      message: "forbidden",
      status: 403,
    });
    expect(classifyCommandError(error).kind).toBe("permission_denied");
  });

  it("classifies a 422 as validation_error", () => {
    const error = new LogionApiError({
      code: "VALIDATION_ERROR",
      message: "bad input",
      status: 422,
    });
    expect(classifyCommandError(error).kind).toBe("validation_error");
  });

  it("classifies WEB_NETWORK_UNAVAILABLE as offline (NOT queued)", () => {
    const error = new LogionApiError({
      code: "WEB_NETWORK_UNAVAILABLE",
      message: "down",
      status: 0,
    });
    expect(classifyCommandError(error).kind).toBe("offline");
  });

  it("classifies a generic status-0 error as error (only WEB_NETWORK_UNAVAILABLE is offline)", () => {
    // A status-0 error with an unknown code is not necessarily a network
    // failure — only the explicit WEB_NETWORK_UNAVAILABLE code maps to offline.
    const error = new LogionApiError({
      code: "SOME_OTHER_NET",
      message: "down",
      status: 0,
    });
    expect(classifyCommandError(error).kind).toBe("error");
  });

  it("classifies a 500+ as error", () => {
    const error = new LogionApiError({
      code: "INTERNAL",
      message: "boom",
      status: 500,
    });
    expect(classifyCommandError(error).kind).toBe("error");
  });

  it("classifies WEB_API_ABORTED as error (API timeout, NOT cancelled)", () => {
    // An API-side abort may come from an internal timeout, not a user cancel.
    // It must surface as `error` so the UI can show a timeout/retry message.
    // The `cancelled` state is only set via controller.signal.aborted inside
    // the run lifecycle when the user invokes cancel().
    const error = new LogionApiError({
      code: "WEB_API_ABORTED",
      message: "aborted",
      status: 0,
    });
    expect(classifyCommandError(error).kind).toBe("error");
  });

  it("classifyCommandError never returns cancelled (that state is set via signal.aborted)", () => {
    // Verify no LogionApiError code maps to cancelled.
    const codes = [
      "WEB_API_ABORTED",
      "WEB_NETWORK_UNAVAILABLE",
      "WEB_API_PATH_INVALID",
      "WEB_API_HEADER_INVALID",
      "WEB_API_TIMEOUT_INVALID",
      "WEB_API_RESPONSE_INVALID",
      "WEB_CSRF_MISSING",
      "INTERNAL",
      "UNKNOWN_CODE",
    ];
    for (const code of codes) {
      const error = new LogionApiError({
        code,
        message: "x",
        status: code === "INTERNAL" ? 500 : 0,
      });
      expect(classifyCommandError(error).kind).not.toBe("cancelled");
    }
  });

  it("classifies WEB_API_PATH_INVALID as error (not offline)", () => {
    const error = new LogionApiError({
      code: "WEB_API_PATH_INVALID",
      message: "bad path",
      status: 0,
    });
    expect(classifyCommandError(error).kind).toBe("error");
  });

  it("classifies WEB_API_HEADER_INVALID as error", () => {
    const error = new LogionApiError({
      code: "WEB_API_HEADER_INVALID",
      message: "bad header",
      status: 0,
    });
    expect(classifyCommandError(error).kind).toBe("error");
  });

  it("classifies WEB_API_TIMEOUT_INVALID as error", () => {
    const error = new LogionApiError({
      code: "WEB_API_TIMEOUT_INVALID",
      message: "bad timeout",
      status: 0,
    });
    expect(classifyCommandError(error).kind).toBe("error");
  });

  it("never classifies an unknown throw as offline_queued", () => {
    expect(classifyCommandError(new Error("random")).kind).toBe("error");
    expect(classifyCommandError("string error").kind).toBe("error");
    expect(classifyCommandError(undefined).kind).toBe("error");
  });

  it("preserves requestId and code for traceability without leaking server message", () => {
    const error = new LogionApiError({
      code: "INTERNAL",
      message: "sensitive internal detail",
      requestId: "req-trace-9",
      status: 500,
    });
    const state = classifyCommandError(error);
    expect(state.requestId).toBe("req-trace-9");
    expect(state.error?.code).toBe("INTERNAL");
    // The classifier stores the error object but the UI must use its own
    // message — it must not render error.message directly.
    expect(state.error?.message).toBe("sensitive internal detail");
  });
});
