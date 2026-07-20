import type { components } from "@logion/contracts";

import { type ApiClient, LogionApiError } from "@/lib/api/client";

type AuthResponse = components["schemas"]["AuthResponse"];
type EmailVerificationRequest =
  components["schemas"]["EmailVerificationConfirmationRequest"];
type LoginRequest = components["schemas"]["LoginRequest"];
type MfaChallengeResponse = components["schemas"]["MfaChallengeResponse"];
type MfaLoginRequest = components["schemas"]["MfaLoginVerifyRequest"];
type PasswordRecoveryCompletionRequest =
  components["schemas"]["PasswordRecoveryCompletionRequest"];
type PasswordRecoveryStartRequest =
  components["schemas"]["PasswordRecoveryStartRequest"];
type RegistrationStartRequest =
  components["schemas"]["RegistrationStartRequest"];

export type LoginOutcome =
  | { kind: "authenticated"; response: AuthResponse }
  | { kind: "mfa_required"; challenge: MfaChallengeResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): LogionApiError {
  return new LogionApiError({
    code: "WEB_API_RESPONSE_INVALID",
    message: "The server returned an invalid authentication response.",
    status: 200,
  });
}

function requireMessage(value: unknown): void {
  if (!isRecord(value) || value.status !== "ok") throw invalidResponse();
}

function isUser(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.status === "string" &&
    typeof value.created_at === "string"
  );
}

function requireAuth(value: unknown): AuthResponse {
  if (
    !isRecord(value) ||
    !isUser(value.user) ||
    typeof value.session_expires_at !== "string"
  ) {
    throw invalidResponse();
  }
  return value as AuthResponse;
}

function isMfaChallenge(value: unknown): value is MfaChallengeResponse {
  return (
    isRecord(value) &&
    value.status === "mfa_required" &&
    typeof value.challenge_token === "string" &&
    typeof value.expires_at === "string" &&
    Array.isArray(value.methods) &&
    value.methods.every(
      (method) => method === "totp" || method === "recovery_code",
    )
  );
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export function createPublicAuthApi(client: ApiClient) {
  return {
    async startRegistration(input: RegistrationStartRequest): Promise<void> {
      const response = await client.request<unknown>(
        "/api/v1/auth/registrations",
        {
          body: jsonBody(input),
          method: "POST",
        },
      );
      requireMessage(response);
    },

    async confirmEmail(input: EmailVerificationRequest): Promise<void> {
      const response = await client.request<unknown>(
        "/api/v1/auth/email-verification/confirmations",
        { body: jsonBody(input), method: "POST" },
      );
      requireMessage(response);
    },

    async login(input: LoginRequest): Promise<LoginOutcome> {
      const response = await client.request<unknown>("/api/v1/auth/login", {
        body: jsonBody(input),
        method: "POST",
      });
      if (isMfaChallenge(response)) {
        return { kind: "mfa_required", challenge: response };
      }
      return { kind: "authenticated", response: requireAuth(response) };
    },

    async verifyMfa(input: MfaLoginRequest): Promise<AuthResponse> {
      const response = await client.request<unknown>(
        "/api/v1/auth/totp/login/verify",
        { body: jsonBody(input), method: "POST" },
      );
      return requireAuth(response);
    },

    async startPasswordRecovery(
      input: PasswordRecoveryStartRequest,
    ): Promise<void> {
      const response = await client.request<unknown>(
        "/api/v1/auth/password-recovery/requests",
        { body: jsonBody(input), method: "POST" },
      );
      requireMessage(response);
    },

    async completePasswordRecovery(
      input: PasswordRecoveryCompletionRequest,
    ): Promise<void> {
      const response = await client.request<unknown>(
        "/api/v1/auth/password-recovery/completions",
        { body: jsonBody(input), method: "POST" },
      );
      requireMessage(response);
    },

    async logout(): Promise<void> {
      const response = await client.request<unknown>("/api/v1/auth/logout", {
        csrf: true,
        method: "POST",
      });
      requireMessage(response);
    },
  };
}

export type PublicAuthApi = ReturnType<typeof createPublicAuthApi>;
