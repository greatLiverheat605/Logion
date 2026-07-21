import type { LogionSyncV1Message } from "./sync-v1";

export interface SyncV1ValidationDiagnostic {
  readonly keyword: string;
  readonly schema_path: string;
}

export type SyncV1ValidationResult =
  | { readonly ok: true; readonly value: LogionSyncV1Message }
  | {
      readonly ok: false;
      readonly code: "SYNC_MESSAGE_INVALID";
      readonly diagnostics: readonly SyncV1ValidationDiagnostic[];
      readonly truncated: boolean;
    };

export function validateSyncV1Message(value: unknown): SyncV1ValidationResult;

export function isSyncV1Message(value: unknown): value is LogionSyncV1Message;
