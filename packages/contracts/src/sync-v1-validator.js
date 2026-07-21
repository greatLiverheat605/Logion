import validateGenerated from "./sync-v1-validator.generated.js";

const MAX_DIAGNOSTICS = 8;
const MAX_LOCATION_LENGTH = 160;

function bounded(value) {
  return value.slice(0, MAX_LOCATION_LENGTH);
}

/**
 * Validates an untrusted sync envelope without returning input values or AJV
 * parameters. Diagnostics are deliberately limited to schema-owned metadata.
 */
export function validateSyncV1Message(value) {
  let valid;
  try {
    valid = validateGenerated(value);
  } catch {
    return {
      ok: false,
      code: "SYNC_MESSAGE_INVALID",
      diagnostics: [{ keyword: "runtime", schema_path: "#" }],
      truncated: false,
    };
  }
  if (valid) {
    return { ok: true, value };
  }

  const diagnostics = (validateGenerated.errors ?? [])
    .slice(0, MAX_DIAGNOSTICS)
    .map((error) => ({
      keyword: bounded(error.keyword),
      schema_path: bounded(error.schemaPath),
    }));

  return {
    ok: false,
    code: "SYNC_MESSAGE_INVALID",
    diagnostics,
    truncated: (validateGenerated.errors?.length ?? 0) > MAX_DIAGNOSTICS,
  };
}

export function isSyncV1Message(value) {
  try {
    return validateGenerated(value);
  } catch {
    return false;
  }
}
