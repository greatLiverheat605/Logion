/* Generated from schemas/sync-v1.schema.json. Do not edit manually. */

const RFC3339_DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const RFC3339_TIME =
  /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)$/i;
const RFC3339_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validateRfc3339DateTime(value) {
  const parts = value.split(/t|\s/i);
  if (parts.length !== 2) return false;
  const date = RFC3339_DATE.exec(parts[0]);
  const time = RFC3339_TIME.exec(parts[1]);
  if (date === null || time === null) return false;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 && leap ? 29 : RFC3339_DAYS[month];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    maxDay === undefined ||
    day > maxDay
  )
    return false;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3]);
  const timezoneSign = time[5] === "-" ? -1 : 1;
  const timezoneHour = Number(time[6] ?? 0);
  const timezoneMinute = Number(time[7] ?? 0);
  if (timezoneHour > 23 || timezoneMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;
  const utcMinute = minute - timezoneMinute * timezoneSign;
  const utcHour = hour - timezoneHour * timezoneSign - (utcMinute < 0 ? 1 : 0);
  return (
    (utcHour === 23 || utcHour === -1) &&
    (utcMinute === 59 || utcMinute === -1) &&
    second < 61
  );
}

// sync-v1 uses uniqueItems only for UUID and enum string arrays.
function equalSyncV1UniqueItem(left, right) {
  return left === right;
}

("use strict");
export const validate = validate20;
export default validate20;
const schema31 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.logion.dev/sync-v1.schema.json",
  title: "LogionSyncV1Message",
  description:
    "Versioned envelopes for bootstrap, push, pull and explicit sync control.",
  oneOf: [
    { $ref: "#/$defs/capabilities" },
    { $ref: "#/$defs/bootstrapRequest" },
    { $ref: "#/$defs/bootstrapResponse" },
    { $ref: "#/$defs/pushRequest" },
    { $ref: "#/$defs/pushResponse" },
    { $ref: "#/$defs/pullRequest" },
    { $ref: "#/$defs/pullResponse" },
    { $ref: "#/$defs/syncControl" },
  ],
  $defs: {
    protocolVersion: { const: "sync-v1" },
    uuid: { type: "string", format: "uuid" },
    dateTime: { type: "string", format: "date-time" },
    hash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    cursor: { type: "integer", minimum: 0 },
    entityType: { type: "string", pattern: "^[a-z][a-z0-9_]{1,63}$" },
    payload: { type: "object", additionalProperties: true, maxProperties: 200 },
    baseMessage: {
      type: "object",
      required: ["message_type", "protocol_version"],
      properties: {
        message_type: { type: "string" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
      },
    },
    workspaceDevice: {
      type: "object",
      required: ["workspace_id", "device_id"],
      properties: {
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
      },
    },
    syncOperation: {
      title: "SyncOperationV1",
      type: "object",
      additionalProperties: false,
      required: [
        "operation_id",
        "protocol_version",
        "workspace_id",
        "device_id",
        "entity_type",
        "entity_id",
        "operation_type",
        "base_version",
        "client_occurred_at",
        "payload",
        "payload_hash",
        "dependencies",
      ],
      properties: {
        operation_id: { $ref: "#/$defs/uuid" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        entity_type: { $ref: "#/$defs/entityType" },
        entity_id: { $ref: "#/$defs/uuid" },
        operation_type: { enum: ["create", "update", "delete", "restore"] },
        base_version: { type: "integer", minimum: 0 },
        client_occurred_at: { $ref: "#/$defs/dateTime" },
        payload: { $ref: "#/$defs/payload" },
        payload_hash: { $ref: "#/$defs/hash" },
        conflict_resolution: {
          oneOf: [{ $ref: "#/$defs/conflictResolution" }, { type: "null" }],
        },
        dependencies: {
          type: "array",
          maxItems: 100,
          uniqueItems: true,
          items: { $ref: "#/$defs/uuid" },
        },
      },
    },
    conflictResolution: {
      type: "object",
      additionalProperties: false,
      required: ["conflict_id", "resolution", "expected_remote_version"],
      properties: {
        conflict_id: { $ref: "#/$defs/uuid" },
        resolution: { enum: ["keep_local", "keep_remote", "merge", "dismiss"] },
        expected_remote_version: { type: "integer", minimum: 1 },
      },
    },
    entityRecord: {
      type: "object",
      additionalProperties: false,
      required: [
        "entity_type",
        "entity_id",
        "version",
        "created_at",
        "updated_at",
        "deleted_at",
        "created_by",
        "updated_by",
        "payload",
        "payload_hash",
      ],
      properties: {
        entity_type: { $ref: "#/$defs/entityType" },
        entity_id: { $ref: "#/$defs/uuid" },
        version: { type: "integer", minimum: 1 },
        created_at: { $ref: "#/$defs/dateTime" },
        updated_at: { $ref: "#/$defs/dateTime" },
        deleted_at: { oneOf: [{ $ref: "#/$defs/dateTime" }, { type: "null" }] },
        created_by: { $ref: "#/$defs/uuid" },
        updated_by: { $ref: "#/$defs/uuid" },
        payload: { $ref: "#/$defs/payload" },
        payload_hash: { $ref: "#/$defs/hash" },
      },
    },
    conflict: {
      type: "object",
      additionalProperties: false,
      required: [
        "conflict_id",
        "conflict_kind",
        "status",
        "entity_type",
        "entity_id",
        "base_version",
        "local_payload_hash",
        "remote_version",
        "remote_payload",
        "remote_payload_hash",
        "resolution_options",
        "created_at",
      ],
      properties: {
        conflict_id: { $ref: "#/$defs/uuid" },
        conflict_kind: {
          enum: [
            "content",
            "status",
            "hierarchy",
            "delete_update",
            "permission",
          ],
        },
        status: { const: "open" },
        entity_type: { $ref: "#/$defs/entityType" },
        entity_id: { $ref: "#/$defs/uuid" },
        base_version: { type: "integer", minimum: 0 },
        local_payload_hash: { $ref: "#/$defs/hash" },
        remote_version: { type: "integer", minimum: 1 },
        remote_payload: { $ref: "#/$defs/payload" },
        remote_payload_hash: { $ref: "#/$defs/hash" },
        resolution_options: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { enum: ["keep_local", "keep_remote", "merge", "dismiss"] },
        },
        created_at: { $ref: "#/$defs/dateTime" },
      },
    },
    capabilities: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "min_supported_version",
            "sync_epoch",
            "snapshot_schema_version",
            "max_push_operations",
            "max_pull_changes",
            "max_operation_bytes",
            "max_batch_bytes",
            "max_snapshot_chunk_bytes",
            "server_time",
          ],
          properties: {
            message_type: { const: "capabilities" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            min_supported_version: { $ref: "#/$defs/protocolVersion" },
            sync_epoch: { $ref: "#/$defs/uuid" },
            snapshot_schema_version: { const: 1 },
            max_push_operations: { type: "integer", minimum: 1, maximum: 1000 },
            max_pull_changes: { type: "integer", minimum: 1, maximum: 1000 },
            max_operation_bytes: {
              type: "integer",
              minimum: 1024,
              maximum: 1048576,
            },
            max_batch_bytes: {
              type: "integer",
              minimum: 1024,
              maximum: 16777216,
            },
            max_snapshot_chunk_bytes: {
              type: "integer",
              minimum: 1024,
              maximum: 16777216,
            },
            server_time: { $ref: "#/$defs/dateTime" },
          },
        },
      ],
    },
    bootstrapRequest: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        { $ref: "#/$defs/workspaceDevice" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "workspace_id",
            "device_id",
            "known_sync_epoch",
            "snapshot_id",
            "chunk_index",
          ],
          properties: {
            message_type: { const: "bootstrap_request" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            workspace_id: { $ref: "#/$defs/uuid" },
            device_id: { $ref: "#/$defs/uuid" },
            known_sync_epoch: {
              oneOf: [{ $ref: "#/$defs/uuid" }, { type: "null" }],
            },
            snapshot_id: {
              oneOf: [{ $ref: "#/$defs/uuid" }, { type: "null" }],
            },
            chunk_index: {
              oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
            },
          },
        },
      ],
    },
    bootstrapResponse: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        { $ref: "#/$defs/workspaceDevice" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "min_supported_version",
            "workspace_id",
            "device_id",
            "sync_epoch",
            "snapshot_schema_version",
            "snapshot_id",
            "chunk_index",
            "chunk_count",
            "cursor",
            "snapshot_checksum",
            "chunk_checksum",
            "records",
            "created_at",
          ],
          properties: {
            message_type: { const: "bootstrap_response" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            min_supported_version: { $ref: "#/$defs/protocolVersion" },
            workspace_id: { $ref: "#/$defs/uuid" },
            device_id: { $ref: "#/$defs/uuid" },
            sync_epoch: { $ref: "#/$defs/uuid" },
            snapshot_schema_version: { const: 1 },
            snapshot_id: { $ref: "#/$defs/uuid" },
            chunk_index: { type: "integer", minimum: 0 },
            chunk_count: { type: "integer", minimum: 1, maximum: 100000 },
            cursor: { $ref: "#/$defs/cursor" },
            snapshot_checksum: { $ref: "#/$defs/hash" },
            chunk_checksum: { $ref: "#/$defs/hash" },
            records: {
              type: "array",
              maxItems: 1000,
              items: { $ref: "#/$defs/entityRecord" },
            },
            created_at: { $ref: "#/$defs/dateTime" },
          },
        },
      ],
    },
    pushRequest: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        { $ref: "#/$defs/workspaceDevice" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "workspace_id",
            "device_id",
            "sync_epoch",
            "operations",
          ],
          properties: {
            message_type: { const: "push_request" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            workspace_id: { $ref: "#/$defs/uuid" },
            device_id: { $ref: "#/$defs/uuid" },
            sync_epoch: { $ref: "#/$defs/uuid" },
            operations: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { $ref: "#/$defs/syncOperation" },
            },
          },
        },
      ],
    },
    operationResult: {
      oneOf: [
        { $ref: "#/$defs/appliedOperationResult" },
        { $ref: "#/$defs/conflictOperationResult" },
        { $ref: "#/$defs/failedOperationResult" },
      ],
    },
    appliedOperationResult: {
      type: "object",
      additionalProperties: false,
      required: [
        "operation_id",
        "status",
        "retryable",
        "server_version",
        "sequence",
      ],
      properties: {
        operation_id: { $ref: "#/$defs/uuid" },
        status: { enum: ["applied", "duplicate"] },
        retryable: { const: false },
        server_version: { type: "integer", minimum: 1 },
        sequence: { type: "integer", minimum: 1 },
      },
    },
    conflictOperationResult: {
      type: "object",
      additionalProperties: false,
      required: ["operation_id", "status", "retryable", "conflict"],
      properties: {
        operation_id: { $ref: "#/$defs/uuid" },
        status: { const: "conflict" },
        retryable: { const: false },
        conflict: { $ref: "#/$defs/conflict" },
      },
    },
    failedOperationResult: {
      type: "object",
      additionalProperties: false,
      required: ["operation_id", "status", "retryable", "error_code"],
      properties: {
        operation_id: { $ref: "#/$defs/uuid" },
        status: { enum: ["rejected", "blocked_dependency"] },
        retryable: { type: "boolean" },
        error_code: { type: "string", pattern: "^SYNC_[A-Z0-9_]{2,80}$" },
      },
    },
    pushResponse: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        { $ref: "#/$defs/workspaceDevice" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "workspace_id",
            "device_id",
            "sync_epoch",
            "results",
          ],
          properties: {
            message_type: { const: "push_response" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            workspace_id: { $ref: "#/$defs/uuid" },
            device_id: { $ref: "#/$defs/uuid" },
            sync_epoch: { $ref: "#/$defs/uuid" },
            results: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { $ref: "#/$defs/operationResult" },
            },
          },
        },
      ],
    },
    pullRequest: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        { $ref: "#/$defs/workspaceDevice" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "workspace_id",
            "device_id",
            "sync_epoch",
            "cursor",
            "limit",
          ],
          properties: {
            message_type: { const: "pull_request" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            workspace_id: { $ref: "#/$defs/uuid" },
            device_id: { $ref: "#/$defs/uuid" },
            sync_epoch: { $ref: "#/$defs/uuid" },
            cursor: { $ref: "#/$defs/cursor" },
            limit: { type: "integer", minimum: 1, maximum: 1000 },
          },
        },
      ],
    },
    change: {
      oneOf: [
        { $ref: "#/$defs/liveChange" },
        { $ref: "#/$defs/tombstoneChange" },
      ],
    },
    liveChange: {
      type: "object",
      additionalProperties: false,
      required: [
        "sequence",
        "operation_id",
        "entity_type",
        "entity_id",
        "operation_type",
        "server_version",
        "occurred_at",
        "tombstone",
        "deleted_at",
        "payload",
        "payload_hash",
      ],
      properties: {
        sequence: { type: "integer", minimum: 1 },
        operation_id: { $ref: "#/$defs/uuid" },
        entity_type: { $ref: "#/$defs/entityType" },
        entity_id: { $ref: "#/$defs/uuid" },
        operation_type: { enum: ["create", "update", "restore"] },
        server_version: { type: "integer", minimum: 1 },
        occurred_at: { $ref: "#/$defs/dateTime" },
        tombstone: { const: false },
        deleted_at: { type: "null" },
        payload: { $ref: "#/$defs/payload" },
        payload_hash: { $ref: "#/$defs/hash" },
      },
    },
    tombstoneChange: {
      type: "object",
      additionalProperties: false,
      required: [
        "sequence",
        "operation_id",
        "entity_type",
        "entity_id",
        "operation_type",
        "server_version",
        "occurred_at",
        "tombstone",
        "deleted_at",
        "payload",
        "payload_hash",
      ],
      properties: {
        sequence: { type: "integer", minimum: 1 },
        operation_id: { $ref: "#/$defs/uuid" },
        entity_type: { $ref: "#/$defs/entityType" },
        entity_id: { $ref: "#/$defs/uuid" },
        operation_type: { const: "delete" },
        server_version: { type: "integer", minimum: 1 },
        occurred_at: { $ref: "#/$defs/dateTime" },
        tombstone: { const: true },
        deleted_at: { $ref: "#/$defs/dateTime" },
        payload: { type: "object", maxProperties: 0 },
        payload_hash: { $ref: "#/$defs/hash" },
      },
    },
    pullResponse: {
      allOf: [
        { $ref: "#/$defs/baseMessage" },
        { $ref: "#/$defs/workspaceDevice" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "message_type",
            "protocol_version",
            "workspace_id",
            "device_id",
            "sync_epoch",
            "from_cursor",
            "next_cursor",
            "has_more",
            "changes",
          ],
          properties: {
            message_type: { const: "pull_response" },
            protocol_version: { $ref: "#/$defs/protocolVersion" },
            workspace_id: { $ref: "#/$defs/uuid" },
            device_id: { $ref: "#/$defs/uuid" },
            sync_epoch: { $ref: "#/$defs/uuid" },
            from_cursor: { $ref: "#/$defs/cursor" },
            next_cursor: { $ref: "#/$defs/cursor" },
            has_more: { type: "boolean" },
            changes: {
              type: "array",
              maxItems: 1000,
              items: { $ref: "#/$defs/change" },
            },
          },
        },
      ],
    },
    syncControl: {
      oneOf: [
        { $ref: "#/$defs/upgradeControl" },
        { $ref: "#/$defs/rebootstrapControl" },
        { $ref: "#/$defs/cursorExpiredControl" },
      ],
    },
    upgradeControl: {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "min_supported_version",
        "action",
        "reason_code",
        "server_sync_epoch",
      ],
      properties: {
        message_type: { const: "sync_control" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        min_supported_version: { $ref: "#/$defs/protocolVersion" },
        action: { const: "upgrade_required" },
        reason_code: {
          enum: ["PROTOCOL_UNSUPPORTED", "SNAPSHOT_SCHEMA_UNSUPPORTED"],
        },
        server_sync_epoch: { $ref: "#/$defs/uuid" },
      },
    },
    rebootstrapControl: {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "min_supported_version",
        "action",
        "reason_code",
        "server_sync_epoch",
      ],
      properties: {
        message_type: { const: "sync_control" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        min_supported_version: { $ref: "#/$defs/protocolVersion" },
        action: { const: "rebootstrap_required" },
        reason_code: { const: "EPOCH_MISMATCH" },
        server_sync_epoch: { $ref: "#/$defs/uuid" },
      },
    },
    cursorExpiredControl: {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "min_supported_version",
        "action",
        "reason_code",
        "server_sync_epoch",
      ],
      properties: {
        message_type: { const: "sync_control" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        min_supported_version: { $ref: "#/$defs/protocolVersion" },
        action: { const: "cursor_expired" },
        reason_code: { const: "CURSOR_EXPIRED" },
        server_sync_epoch: { $ref: "#/$defs/uuid" },
      },
    },
  },
};
const schema32 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "min_supported_version",
        "sync_epoch",
        "snapshot_schema_version",
        "max_push_operations",
        "max_pull_changes",
        "max_operation_bytes",
        "max_batch_bytes",
        "max_snapshot_chunk_bytes",
        "server_time",
      ],
      properties: {
        message_type: { const: "capabilities" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        min_supported_version: { $ref: "#/$defs/protocolVersion" },
        sync_epoch: { $ref: "#/$defs/uuid" },
        snapshot_schema_version: { const: 1 },
        max_push_operations: { type: "integer", minimum: 1, maximum: 1000 },
        max_pull_changes: { type: "integer", minimum: 1, maximum: 1000 },
        max_operation_bytes: {
          type: "integer",
          minimum: 1024,
          maximum: 1048576,
        },
        max_batch_bytes: { type: "integer", minimum: 1024, maximum: 16777216 },
        max_snapshot_chunk_bytes: {
          type: "integer",
          minimum: 1024,
          maximum: 16777216,
        },
        server_time: { $ref: "#/$defs/dateTime" },
      },
    },
  ],
};
const schema34 = { const: "sync-v1" };
const schema37 = { type: "string", format: "uuid" };
const schema38 = { type: "string", format: "date-time" };
const schema33 = {
  type: "object",
  required: ["message_type", "protocol_version"],
  properties: {
    message_type: { type: "string" },
    protocol_version: { $ref: "#/$defs/protocolVersion" },
  },
};
function validate22(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate22.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.message_type === undefined && (missing0 = "message_type")) ||
        (data.protocol_version === undefined && (missing0 = "protocol_version"))
      ) {
        validate22.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        if (data.message_type !== undefined) {
          const _errs1 = errors;
          if (typeof data.message_type !== "string") {
            validate22.errors = [
              {
                instancePath: instancePath + "/message_type",
                schemaPath: "#/properties/message_type/type",
                keyword: "type",
                params: { type: "string" },
                message: "must be string",
              },
            ];
            return false;
          }
          var valid0 = _errs1 === errors;
        } else {
          var valid0 = true;
        }
        if (valid0) {
          if (data.protocol_version !== undefined) {
            const _errs3 = errors;
            if ("sync-v1" !== data.protocol_version) {
              validate22.errors = [
                {
                  instancePath: instancePath + "/protocol_version",
                  schemaPath: "#/$defs/protocolVersion/const",
                  keyword: "const",
                  params: { allowedValue: "sync-v1" },
                  message: "must be equal to constant",
                },
              ];
              return false;
            }
            var valid0 = _errs3 === errors;
          } else {
            var valid0 = true;
          }
        }
      }
    } else {
      validate22.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate22.errors = vErrors;
  return errors === 0;
}
validate22.evaluated = {
  props: { message_type: true, protocol_version: true },
  dynamicProps: false,
  dynamicItems: false,
};
const func1 = Object.prototype.hasOwnProperty;
const formats0 = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const formats2 = { validate: validateRfc3339DateTime };
function validate21(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (errors === _errs1) {
      if (data && typeof data == "object" && !Array.isArray(data)) {
        let missing0;
        if (
          (data.message_type === undefined && (missing0 = "message_type")) ||
          (data.protocol_version === undefined &&
            (missing0 = "protocol_version")) ||
          (data.min_supported_version === undefined &&
            (missing0 = "min_supported_version")) ||
          (data.sync_epoch === undefined && (missing0 = "sync_epoch")) ||
          (data.snapshot_schema_version === undefined &&
            (missing0 = "snapshot_schema_version")) ||
          (data.max_push_operations === undefined &&
            (missing0 = "max_push_operations")) ||
          (data.max_pull_changes === undefined &&
            (missing0 = "max_pull_changes")) ||
          (data.max_operation_bytes === undefined &&
            (missing0 = "max_operation_bytes")) ||
          (data.max_batch_bytes === undefined &&
            (missing0 = "max_batch_bytes")) ||
          (data.max_snapshot_chunk_bytes === undefined &&
            (missing0 = "max_snapshot_chunk_bytes")) ||
          (data.server_time === undefined && (missing0 = "server_time"))
        ) {
          validate21.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/1/required",
              keyword: "required",
              params: { missingProperty: missing0 },
              message: "must have required property '" + missing0 + "'",
            },
          ];
          return false;
        } else {
          const _errs3 = errors;
          for (const key0 in data) {
            if (!func1.call(schema32.allOf[1].properties, key0)) {
              validate21.errors = [
                {
                  instancePath,
                  schemaPath: "#/allOf/1/additionalProperties",
                  keyword: "additionalProperties",
                  params: { additionalProperty: key0 },
                  message: "must NOT have additional properties",
                },
              ];
              return false;
              break;
            }
          }
          if (_errs3 === errors) {
            if (data.message_type !== undefined) {
              const _errs4 = errors;
              if ("capabilities" !== data.message_type) {
                validate21.errors = [
                  {
                    instancePath: instancePath + "/message_type",
                    schemaPath: "#/allOf/1/properties/message_type/const",
                    keyword: "const",
                    params: { allowedValue: "capabilities" },
                    message: "must be equal to constant",
                  },
                ];
                return false;
              }
              var valid1 = _errs4 === errors;
            } else {
              var valid1 = true;
            }
            if (valid1) {
              if (data.protocol_version !== undefined) {
                const _errs5 = errors;
                if ("sync-v1" !== data.protocol_version) {
                  validate21.errors = [
                    {
                      instancePath: instancePath + "/protocol_version",
                      schemaPath: "#/$defs/protocolVersion/const",
                      keyword: "const",
                      params: { allowedValue: "sync-v1" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.min_supported_version !== undefined) {
                  const _errs7 = errors;
                  if ("sync-v1" !== data.min_supported_version) {
                    validate21.errors = [
                      {
                        instancePath: instancePath + "/min_supported_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs7 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.sync_epoch !== undefined) {
                    let data3 = data.sync_epoch;
                    const _errs9 = errors;
                    const _errs10 = errors;
                    if (errors === _errs10) {
                      if (errors === _errs10) {
                        if (typeof data3 === "string") {
                          if (!formats0.test(data3)) {
                            validate21.errors = [
                              {
                                instancePath: instancePath + "/sync_epoch",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate21.errors = [
                            {
                              instancePath: instancePath + "/sync_epoch",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid1 = _errs9 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.snapshot_schema_version !== undefined) {
                      const _errs12 = errors;
                      if (1 !== data.snapshot_schema_version) {
                        validate21.errors = [
                          {
                            instancePath:
                              instancePath + "/snapshot_schema_version",
                            schemaPath:
                              "#/allOf/1/properties/snapshot_schema_version/const",
                            keyword: "const",
                            params: { allowedValue: 1 },
                            message: "must be equal to constant",
                          },
                        ];
                        return false;
                      }
                      var valid1 = _errs12 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.max_push_operations !== undefined) {
                        let data5 = data.max_push_operations;
                        const _errs13 = errors;
                        if (
                          !(
                            typeof data5 == "number" &&
                            !(data5 % 1) &&
                            !isNaN(data5) &&
                            isFinite(data5)
                          )
                        ) {
                          validate21.errors = [
                            {
                              instancePath:
                                instancePath + "/max_push_operations",
                              schemaPath:
                                "#/allOf/1/properties/max_push_operations/type",
                              keyword: "type",
                              params: { type: "integer" },
                              message: "must be integer",
                            },
                          ];
                          return false;
                        }
                        if (errors === _errs13) {
                          if (typeof data5 == "number" && isFinite(data5)) {
                            if (data5 > 1000 || isNaN(data5)) {
                              validate21.errors = [
                                {
                                  instancePath:
                                    instancePath + "/max_push_operations",
                                  schemaPath:
                                    "#/allOf/1/properties/max_push_operations/maximum",
                                  keyword: "maximum",
                                  params: { comparison: "<=", limit: 1000 },
                                  message: "must be <= 1000",
                                },
                              ];
                              return false;
                            } else {
                              if (data5 < 1 || isNaN(data5)) {
                                validate21.errors = [
                                  {
                                    instancePath:
                                      instancePath + "/max_push_operations",
                                    schemaPath:
                                      "#/allOf/1/properties/max_push_operations/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                    message: "must be >= 1",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                        }
                        var valid1 = _errs13 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.max_pull_changes !== undefined) {
                          let data6 = data.max_pull_changes;
                          const _errs15 = errors;
                          if (
                            !(
                              typeof data6 == "number" &&
                              !(data6 % 1) &&
                              !isNaN(data6) &&
                              isFinite(data6)
                            )
                          ) {
                            validate21.errors = [
                              {
                                instancePath:
                                  instancePath + "/max_pull_changes",
                                schemaPath:
                                  "#/allOf/1/properties/max_pull_changes/type",
                                keyword: "type",
                                params: { type: "integer" },
                                message: "must be integer",
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs15) {
                            if (typeof data6 == "number" && isFinite(data6)) {
                              if (data6 > 1000 || isNaN(data6)) {
                                validate21.errors = [
                                  {
                                    instancePath:
                                      instancePath + "/max_pull_changes",
                                    schemaPath:
                                      "#/allOf/1/properties/max_pull_changes/maximum",
                                    keyword: "maximum",
                                    params: { comparison: "<=", limit: 1000 },
                                    message: "must be <= 1000",
                                  },
                                ];
                                return false;
                              } else {
                                if (data6 < 1 || isNaN(data6)) {
                                  validate21.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/max_pull_changes",
                                      schemaPath:
                                        "#/allOf/1/properties/max_pull_changes/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 1 },
                                      message: "must be >= 1",
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                          }
                          var valid1 = _errs15 === errors;
                        } else {
                          var valid1 = true;
                        }
                        if (valid1) {
                          if (data.max_operation_bytes !== undefined) {
                            let data7 = data.max_operation_bytes;
                            const _errs17 = errors;
                            if (
                              !(
                                typeof data7 == "number" &&
                                !(data7 % 1) &&
                                !isNaN(data7) &&
                                isFinite(data7)
                              )
                            ) {
                              validate21.errors = [
                                {
                                  instancePath:
                                    instancePath + "/max_operation_bytes",
                                  schemaPath:
                                    "#/allOf/1/properties/max_operation_bytes/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                  message: "must be integer",
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs17) {
                              if (typeof data7 == "number" && isFinite(data7)) {
                                if (data7 > 1048576 || isNaN(data7)) {
                                  validate21.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/max_operation_bytes",
                                      schemaPath:
                                        "#/allOf/1/properties/max_operation_bytes/maximum",
                                      keyword: "maximum",
                                      params: {
                                        comparison: "<=",
                                        limit: 1048576,
                                      },
                                      message: "must be <= 1048576",
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (data7 < 1024 || isNaN(data7)) {
                                    validate21.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/max_operation_bytes",
                                        schemaPath:
                                          "#/allOf/1/properties/max_operation_bytes/minimum",
                                        keyword: "minimum",
                                        params: {
                                          comparison: ">=",
                                          limit: 1024,
                                        },
                                        message: "must be >= 1024",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                            }
                            var valid1 = _errs17 === errors;
                          } else {
                            var valid1 = true;
                          }
                          if (valid1) {
                            if (data.max_batch_bytes !== undefined) {
                              let data8 = data.max_batch_bytes;
                              const _errs19 = errors;
                              if (
                                !(
                                  typeof data8 == "number" &&
                                  !(data8 % 1) &&
                                  !isNaN(data8) &&
                                  isFinite(data8)
                                )
                              ) {
                                validate21.errors = [
                                  {
                                    instancePath:
                                      instancePath + "/max_batch_bytes",
                                    schemaPath:
                                      "#/allOf/1/properties/max_batch_bytes/type",
                                    keyword: "type",
                                    params: { type: "integer" },
                                    message: "must be integer",
                                  },
                                ];
                                return false;
                              }
                              if (errors === _errs19) {
                                if (
                                  typeof data8 == "number" &&
                                  isFinite(data8)
                                ) {
                                  if (data8 > 16777216 || isNaN(data8)) {
                                    validate21.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/max_batch_bytes",
                                        schemaPath:
                                          "#/allOf/1/properties/max_batch_bytes/maximum",
                                        keyword: "maximum",
                                        params: {
                                          comparison: "<=",
                                          limit: 16777216,
                                        },
                                        message: "must be <= 16777216",
                                      },
                                    ];
                                    return false;
                                  } else {
                                    if (data8 < 1024 || isNaN(data8)) {
                                      validate21.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/max_batch_bytes",
                                          schemaPath:
                                            "#/allOf/1/properties/max_batch_bytes/minimum",
                                          keyword: "minimum",
                                          params: {
                                            comparison: ">=",
                                            limit: 1024,
                                          },
                                          message: "must be >= 1024",
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                }
                              }
                              var valid1 = _errs19 === errors;
                            } else {
                              var valid1 = true;
                            }
                            if (valid1) {
                              if (data.max_snapshot_chunk_bytes !== undefined) {
                                let data9 = data.max_snapshot_chunk_bytes;
                                const _errs21 = errors;
                                if (
                                  !(
                                    typeof data9 == "number" &&
                                    !(data9 % 1) &&
                                    !isNaN(data9) &&
                                    isFinite(data9)
                                  )
                                ) {
                                  validate21.errors = [
                                    {
                                      instancePath:
                                        instancePath +
                                        "/max_snapshot_chunk_bytes",
                                      schemaPath:
                                        "#/allOf/1/properties/max_snapshot_chunk_bytes/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                      message: "must be integer",
                                    },
                                  ];
                                  return false;
                                }
                                if (errors === _errs21) {
                                  if (
                                    typeof data9 == "number" &&
                                    isFinite(data9)
                                  ) {
                                    if (data9 > 16777216 || isNaN(data9)) {
                                      validate21.errors = [
                                        {
                                          instancePath:
                                            instancePath +
                                            "/max_snapshot_chunk_bytes",
                                          schemaPath:
                                            "#/allOf/1/properties/max_snapshot_chunk_bytes/maximum",
                                          keyword: "maximum",
                                          params: {
                                            comparison: "<=",
                                            limit: 16777216,
                                          },
                                          message: "must be <= 16777216",
                                        },
                                      ];
                                      return false;
                                    } else {
                                      if (data9 < 1024 || isNaN(data9)) {
                                        validate21.errors = [
                                          {
                                            instancePath:
                                              instancePath +
                                              "/max_snapshot_chunk_bytes",
                                            schemaPath:
                                              "#/allOf/1/properties/max_snapshot_chunk_bytes/minimum",
                                            keyword: "minimum",
                                            params: {
                                              comparison: ">=",
                                              limit: 1024,
                                            },
                                            message: "must be >= 1024",
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                  }
                                }
                                var valid1 = _errs21 === errors;
                              } else {
                                var valid1 = true;
                              }
                              if (valid1) {
                                if (data.server_time !== undefined) {
                                  let data10 = data.server_time;
                                  const _errs23 = errors;
                                  const _errs24 = errors;
                                  if (errors === _errs24) {
                                    if (errors === _errs24) {
                                      if (typeof data10 === "string") {
                                        if (!formats2.validate(data10)) {
                                          validate21.errors = [
                                            {
                                              instancePath:
                                                instancePath + "/server_time",
                                              schemaPath:
                                                "#/$defs/dateTime/format",
                                              keyword: "format",
                                              params: { format: "date-time" },
                                              message:
                                                'must match format "' +
                                                "date-time" +
                                                '"',
                                            },
                                          ];
                                          return false;
                                        }
                                      } else {
                                        validate21.errors = [
                                          {
                                            instancePath:
                                              instancePath + "/server_time",
                                            schemaPath: "#/$defs/dateTime/type",
                                            keyword: "type",
                                            params: { type: "string" },
                                            message: "must be string",
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                  }
                                  var valid1 = _errs23 === errors;
                                } else {
                                  var valid1 = true;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        validate21.errors = [
          {
            instancePath,
            schemaPath: "#/allOf/1/type",
            keyword: "type",
            params: { type: "object" },
            message: "must be object",
          },
        ];
        return false;
      }
    }
    var valid0 = _errs1 === errors;
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema39 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    { $ref: "#/$defs/workspaceDevice" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "workspace_id",
        "device_id",
        "known_sync_epoch",
        "snapshot_id",
        "chunk_index",
      ],
      properties: {
        message_type: { const: "bootstrap_request" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        known_sync_epoch: {
          oneOf: [{ $ref: "#/$defs/uuid" }, { type: "null" }],
        },
        snapshot_id: { oneOf: [{ $ref: "#/$defs/uuid" }, { type: "null" }] },
        chunk_index: {
          oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
        },
      },
    },
  ],
};
const schema40 = {
  type: "object",
  required: ["workspace_id", "device_id"],
  properties: {
    workspace_id: { $ref: "#/$defs/uuid" },
    device_id: { $ref: "#/$defs/uuid" },
  },
};
function validate27(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate27.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
        (data.device_id === undefined && (missing0 = "device_id"))
      ) {
        validate27.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        if (data.workspace_id !== undefined) {
          let data0 = data.workspace_id;
          const _errs1 = errors;
          const _errs2 = errors;
          if (errors === _errs2) {
            if (errors === _errs2) {
              if (typeof data0 === "string") {
                if (!formats0.test(data0)) {
                  validate27.errors = [
                    {
                      instancePath: instancePath + "/workspace_id",
                      schemaPath: "#/$defs/uuid/format",
                      keyword: "format",
                      params: { format: "uuid" },
                      message: 'must match format "' + "uuid" + '"',
                    },
                  ];
                  return false;
                }
              } else {
                validate27.errors = [
                  {
                    instancePath: instancePath + "/workspace_id",
                    schemaPath: "#/$defs/uuid/type",
                    keyword: "type",
                    params: { type: "string" },
                    message: "must be string",
                  },
                ];
                return false;
              }
            }
          }
          var valid0 = _errs1 === errors;
        } else {
          var valid0 = true;
        }
        if (valid0) {
          if (data.device_id !== undefined) {
            let data1 = data.device_id;
            const _errs4 = errors;
            const _errs5 = errors;
            if (errors === _errs5) {
              if (errors === _errs5) {
                if (typeof data1 === "string") {
                  if (!formats0.test(data1)) {
                    validate27.errors = [
                      {
                        instancePath: instancePath + "/device_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate27.errors = [
                    {
                      instancePath: instancePath + "/device_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs4 === errors;
          } else {
            var valid0 = true;
          }
        }
      }
    } else {
      validate27.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate27.errors = vErrors;
  return errors === 0;
}
validate27.evaluated = {
  props: { workspace_id: true, device_id: true },
  dynamicProps: false,
  dynamicItems: false,
};
function validate25(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate25.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (
      !validate27(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate27.errors
          : vErrors.concat(validate27.errors);
      errors = vErrors.length;
    }
    var valid0 = _errs1 === errors;
    if (valid0) {
      const _errs2 = errors;
      if (errors === _errs2) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing0;
          if (
            (data.message_type === undefined && (missing0 = "message_type")) ||
            (data.protocol_version === undefined &&
              (missing0 = "protocol_version")) ||
            (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
            (data.device_id === undefined && (missing0 = "device_id")) ||
            (data.known_sync_epoch === undefined &&
              (missing0 = "known_sync_epoch")) ||
            (data.snapshot_id === undefined && (missing0 = "snapshot_id")) ||
            (data.chunk_index === undefined && (missing0 = "chunk_index"))
          ) {
            validate25.errors = [
              {
                instancePath,
                schemaPath: "#/allOf/2/required",
                keyword: "required",
                params: { missingProperty: missing0 },
                message: "must have required property '" + missing0 + "'",
              },
            ];
            return false;
          } else {
            const _errs4 = errors;
            for (const key0 in data) {
              if (
                !(
                  key0 === "message_type" ||
                  key0 === "protocol_version" ||
                  key0 === "workspace_id" ||
                  key0 === "device_id" ||
                  key0 === "known_sync_epoch" ||
                  key0 === "snapshot_id" ||
                  key0 === "chunk_index"
                )
              ) {
                validate25.errors = [
                  {
                    instancePath,
                    schemaPath: "#/allOf/2/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: key0 },
                    message: "must NOT have additional properties",
                  },
                ];
                return false;
                break;
              }
            }
            if (_errs4 === errors) {
              if (data.message_type !== undefined) {
                const _errs5 = errors;
                if ("bootstrap_request" !== data.message_type) {
                  validate25.errors = [
                    {
                      instancePath: instancePath + "/message_type",
                      schemaPath: "#/allOf/2/properties/message_type/const",
                      keyword: "const",
                      params: { allowedValue: "bootstrap_request" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.protocol_version !== undefined) {
                  const _errs6 = errors;
                  if ("sync-v1" !== data.protocol_version) {
                    validate25.errors = [
                      {
                        instancePath: instancePath + "/protocol_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs6 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.workspace_id !== undefined) {
                    let data2 = data.workspace_id;
                    const _errs8 = errors;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (errors === _errs9) {
                        if (typeof data2 === "string") {
                          if (!formats0.test(data2)) {
                            validate25.errors = [
                              {
                                instancePath: instancePath + "/workspace_id",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate25.errors = [
                            {
                              instancePath: instancePath + "/workspace_id",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid1 = _errs8 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.device_id !== undefined) {
                      let data3 = data.device_id;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (errors === _errs12) {
                          if (typeof data3 === "string") {
                            if (!formats0.test(data3)) {
                              validate25.errors = [
                                {
                                  instancePath: instancePath + "/device_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate25.errors = [
                              {
                                instancePath: instancePath + "/device_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid1 = _errs11 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.known_sync_epoch !== undefined) {
                        let data4 = data.known_sync_epoch;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        let valid5 = false;
                        let passing0 = null;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        if (errors === _errs17) {
                          if (errors === _errs17) {
                            if (typeof data4 === "string") {
                              if (!formats0.test(data4)) {
                                const err0 = {
                                  instancePath:
                                    instancePath + "/known_sync_epoch",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                };
                                if (vErrors === null) {
                                  vErrors = [err0];
                                } else {
                                  vErrors.push(err0);
                                }
                                errors++;
                              }
                            } else {
                              const err1 = {
                                instancePath:
                                  instancePath + "/known_sync_epoch",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              };
                              if (vErrors === null) {
                                vErrors = [err1];
                              } else {
                                vErrors.push(err1);
                              }
                              errors++;
                            }
                          }
                        }
                        var _valid0 = _errs16 === errors;
                        if (_valid0) {
                          valid5 = true;
                          passing0 = 0;
                        }
                        const _errs19 = errors;
                        if (data4 !== null) {
                          const err2 = {
                            instancePath: instancePath + "/known_sync_epoch",
                            schemaPath:
                              "#/allOf/2/properties/known_sync_epoch/oneOf/1/type",
                            keyword: "type",
                            params: { type: "null" },
                            message: "must be null",
                          };
                          if (vErrors === null) {
                            vErrors = [err2];
                          } else {
                            vErrors.push(err2);
                          }
                          errors++;
                        }
                        var _valid0 = _errs19 === errors;
                        if (_valid0 && valid5) {
                          valid5 = false;
                          passing0 = [passing0, 1];
                        } else {
                          if (_valid0) {
                            valid5 = true;
                            passing0 = 1;
                          }
                        }
                        if (!valid5) {
                          const err3 = {
                            instancePath: instancePath + "/known_sync_epoch",
                            schemaPath:
                              "#/allOf/2/properties/known_sync_epoch/oneOf",
                            keyword: "oneOf",
                            params: { passingSchemas: passing0 },
                            message: "must match exactly one schema in oneOf",
                          };
                          if (vErrors === null) {
                            vErrors = [err3];
                          } else {
                            vErrors.push(err3);
                          }
                          errors++;
                          validate25.errors = vErrors;
                          return false;
                        } else {
                          errors = _errs15;
                          if (vErrors !== null) {
                            if (_errs15) {
                              vErrors.length = _errs15;
                            } else {
                              vErrors = null;
                            }
                          }
                        }
                        var valid1 = _errs14 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.snapshot_id !== undefined) {
                          let data5 = data.snapshot_id;
                          const _errs21 = errors;
                          const _errs22 = errors;
                          let valid7 = false;
                          let passing1 = null;
                          const _errs23 = errors;
                          const _errs24 = errors;
                          if (errors === _errs24) {
                            if (errors === _errs24) {
                              if (typeof data5 === "string") {
                                if (!formats0.test(data5)) {
                                  const err4 = {
                                    instancePath: instancePath + "/snapshot_id",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err4];
                                  } else {
                                    vErrors.push(err4);
                                  }
                                  errors++;
                                }
                              } else {
                                const err5 = {
                                  instancePath: instancePath + "/snapshot_id",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                };
                                if (vErrors === null) {
                                  vErrors = [err5];
                                } else {
                                  vErrors.push(err5);
                                }
                                errors++;
                              }
                            }
                          }
                          var _valid1 = _errs23 === errors;
                          if (_valid1) {
                            valid7 = true;
                            passing1 = 0;
                          }
                          const _errs26 = errors;
                          if (data5 !== null) {
                            const err6 = {
                              instancePath: instancePath + "/snapshot_id",
                              schemaPath:
                                "#/allOf/2/properties/snapshot_id/oneOf/1/type",
                              keyword: "type",
                              params: { type: "null" },
                              message: "must be null",
                            };
                            if (vErrors === null) {
                              vErrors = [err6];
                            } else {
                              vErrors.push(err6);
                            }
                            errors++;
                          }
                          var _valid1 = _errs26 === errors;
                          if (_valid1 && valid7) {
                            valid7 = false;
                            passing1 = [passing1, 1];
                          } else {
                            if (_valid1) {
                              valid7 = true;
                              passing1 = 1;
                            }
                          }
                          if (!valid7) {
                            const err7 = {
                              instancePath: instancePath + "/snapshot_id",
                              schemaPath:
                                "#/allOf/2/properties/snapshot_id/oneOf",
                              keyword: "oneOf",
                              params: { passingSchemas: passing1 },
                              message: "must match exactly one schema in oneOf",
                            };
                            if (vErrors === null) {
                              vErrors = [err7];
                            } else {
                              vErrors.push(err7);
                            }
                            errors++;
                            validate25.errors = vErrors;
                            return false;
                          } else {
                            errors = _errs22;
                            if (vErrors !== null) {
                              if (_errs22) {
                                vErrors.length = _errs22;
                              } else {
                                vErrors = null;
                              }
                            }
                          }
                          var valid1 = _errs21 === errors;
                        } else {
                          var valid1 = true;
                        }
                        if (valid1) {
                          if (data.chunk_index !== undefined) {
                            let data6 = data.chunk_index;
                            const _errs28 = errors;
                            const _errs29 = errors;
                            let valid9 = false;
                            let passing2 = null;
                            const _errs30 = errors;
                            if (
                              !(
                                typeof data6 == "number" &&
                                !(data6 % 1) &&
                                !isNaN(data6) &&
                                isFinite(data6)
                              )
                            ) {
                              const err8 = {
                                instancePath: instancePath + "/chunk_index",
                                schemaPath:
                                  "#/allOf/2/properties/chunk_index/oneOf/0/type",
                                keyword: "type",
                                params: { type: "integer" },
                                message: "must be integer",
                              };
                              if (vErrors === null) {
                                vErrors = [err8];
                              } else {
                                vErrors.push(err8);
                              }
                              errors++;
                            }
                            if (errors === _errs30) {
                              if (typeof data6 == "number" && isFinite(data6)) {
                                if (data6 < 0 || isNaN(data6)) {
                                  const err9 = {
                                    instancePath: instancePath + "/chunk_index",
                                    schemaPath:
                                      "#/allOf/2/properties/chunk_index/oneOf/0/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 0 },
                                    message: "must be >= 0",
                                  };
                                  if (vErrors === null) {
                                    vErrors = [err9];
                                  } else {
                                    vErrors.push(err9);
                                  }
                                  errors++;
                                }
                              }
                            }
                            var _valid2 = _errs30 === errors;
                            if (_valid2) {
                              valid9 = true;
                              passing2 = 0;
                            }
                            const _errs32 = errors;
                            if (data6 !== null) {
                              const err10 = {
                                instancePath: instancePath + "/chunk_index",
                                schemaPath:
                                  "#/allOf/2/properties/chunk_index/oneOf/1/type",
                                keyword: "type",
                                params: { type: "null" },
                                message: "must be null",
                              };
                              if (vErrors === null) {
                                vErrors = [err10];
                              } else {
                                vErrors.push(err10);
                              }
                              errors++;
                            }
                            var _valid2 = _errs32 === errors;
                            if (_valid2 && valid9) {
                              valid9 = false;
                              passing2 = [passing2, 1];
                            } else {
                              if (_valid2) {
                                valid9 = true;
                                passing2 = 1;
                              }
                            }
                            if (!valid9) {
                              const err11 = {
                                instancePath: instancePath + "/chunk_index",
                                schemaPath:
                                  "#/allOf/2/properties/chunk_index/oneOf",
                                keyword: "oneOf",
                                params: { passingSchemas: passing2 },
                                message:
                                  "must match exactly one schema in oneOf",
                              };
                              if (vErrors === null) {
                                vErrors = [err11];
                              } else {
                                vErrors.push(err11);
                              }
                              errors++;
                              validate25.errors = vErrors;
                              return false;
                            } else {
                              errors = _errs29;
                              if (vErrors !== null) {
                                if (_errs29) {
                                  vErrors.length = _errs29;
                                } else {
                                  vErrors = null;
                                }
                              }
                            }
                            var valid1 = _errs28 === errors;
                          } else {
                            var valid1 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          validate25.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/2/type",
              keyword: "type",
              params: { type: "object" },
              message: "must be object",
            },
          ];
          return false;
        }
      }
      var valid0 = _errs2 === errors;
    }
  }
  validate25.errors = vErrors;
  return errors === 0;
}
validate25.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema48 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    { $ref: "#/$defs/workspaceDevice" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "min_supported_version",
        "workspace_id",
        "device_id",
        "sync_epoch",
        "snapshot_schema_version",
        "snapshot_id",
        "chunk_index",
        "chunk_count",
        "cursor",
        "snapshot_checksum",
        "chunk_checksum",
        "records",
        "created_at",
      ],
      properties: {
        message_type: { const: "bootstrap_response" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        min_supported_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        sync_epoch: { $ref: "#/$defs/uuid" },
        snapshot_schema_version: { const: 1 },
        snapshot_id: { $ref: "#/$defs/uuid" },
        chunk_index: { type: "integer", minimum: 0 },
        chunk_count: { type: "integer", minimum: 1, maximum: 100000 },
        cursor: { $ref: "#/$defs/cursor" },
        snapshot_checksum: { $ref: "#/$defs/hash" },
        chunk_checksum: { $ref: "#/$defs/hash" },
        records: {
          type: "array",
          maxItems: 1000,
          items: { $ref: "#/$defs/entityRecord" },
        },
        created_at: { $ref: "#/$defs/dateTime" },
      },
    },
  ],
};
const schema55 = { type: "integer", minimum: 0 };
const schema56 = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const schema58 = {
  type: "object",
  additionalProperties: false,
  required: [
    "entity_type",
    "entity_id",
    "version",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by",
    "updated_by",
    "payload",
    "payload_hash",
  ],
  properties: {
    entity_type: { $ref: "#/$defs/entityType" },
    entity_id: { $ref: "#/$defs/uuid" },
    version: { type: "integer", minimum: 1 },
    created_at: { $ref: "#/$defs/dateTime" },
    updated_at: { $ref: "#/$defs/dateTime" },
    deleted_at: { oneOf: [{ $ref: "#/$defs/dateTime" }, { type: "null" }] },
    created_by: { $ref: "#/$defs/uuid" },
    updated_by: { $ref: "#/$defs/uuid" },
    payload: { $ref: "#/$defs/payload" },
    payload_hash: { $ref: "#/$defs/hash" },
  },
};
const schema59 = { type: "string", pattern: "^[a-z][a-z0-9_]{1,63}$" };
const schema66 = {
  type: "object",
  additionalProperties: true,
  maxProperties: 200,
};
const pattern6 = new RegExp("^[a-z][a-z0-9_]{1,63}$", "u");
const pattern4 = new RegExp("^sha256:[a-f0-9]{64}$", "u");
function validate33(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate33.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.entity_type === undefined && (missing0 = "entity_type")) ||
        (data.entity_id === undefined && (missing0 = "entity_id")) ||
        (data.version === undefined && (missing0 = "version")) ||
        (data.created_at === undefined && (missing0 = "created_at")) ||
        (data.updated_at === undefined && (missing0 = "updated_at")) ||
        (data.deleted_at === undefined && (missing0 = "deleted_at")) ||
        (data.created_by === undefined && (missing0 = "created_by")) ||
        (data.updated_by === undefined && (missing0 = "updated_by")) ||
        (data.payload === undefined && (missing0 = "payload")) ||
        (data.payload_hash === undefined && (missing0 = "payload_hash"))
      ) {
        validate33.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema58.properties, key0)) {
            validate33.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.entity_type !== undefined) {
            let data0 = data.entity_type;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === "string") {
                if (!pattern6.test(data0)) {
                  validate33.errors = [
                    {
                      instancePath: instancePath + "/entity_type",
                      schemaPath: "#/$defs/entityType/pattern",
                      keyword: "pattern",
                      params: { pattern: "^[a-z][a-z0-9_]{1,63}$" },
                      message:
                        'must match pattern "' + "^[a-z][a-z0-9_]{1,63}$" + '"',
                    },
                  ];
                  return false;
                }
              } else {
                validate33.errors = [
                  {
                    instancePath: instancePath + "/entity_type",
                    schemaPath: "#/$defs/entityType/type",
                    keyword: "type",
                    params: { type: "string" },
                    message: "must be string",
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.entity_id !== undefined) {
              let data1 = data.entity_id;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (errors === _errs6) {
                  if (typeof data1 === "string") {
                    if (!formats0.test(data1)) {
                      validate33.errors = [
                        {
                          instancePath: instancePath + "/entity_id",
                          schemaPath: "#/$defs/uuid/format",
                          keyword: "format",
                          params: { format: "uuid" },
                          message: 'must match format "' + "uuid" + '"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate33.errors = [
                      {
                        instancePath: instancePath + "/entity_id",
                        schemaPath: "#/$defs/uuid/type",
                        keyword: "type",
                        params: { type: "string" },
                        message: "must be string",
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.version !== undefined) {
                let data2 = data.version;
                const _errs8 = errors;
                if (
                  !(
                    typeof data2 == "number" &&
                    !(data2 % 1) &&
                    !isNaN(data2) &&
                    isFinite(data2)
                  )
                ) {
                  validate33.errors = [
                    {
                      instancePath: instancePath + "/version",
                      schemaPath: "#/properties/version/type",
                      keyword: "type",
                      params: { type: "integer" },
                      message: "must be integer",
                    },
                  ];
                  return false;
                }
                if (errors === _errs8) {
                  if (typeof data2 == "number" && isFinite(data2)) {
                    if (data2 < 1 || isNaN(data2)) {
                      validate33.errors = [
                        {
                          instancePath: instancePath + "/version",
                          schemaPath: "#/properties/version/minimum",
                          keyword: "minimum",
                          params: { comparison: ">=", limit: 1 },
                          message: "must be >= 1",
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.created_at !== undefined) {
                  let data3 = data.created_at;
                  const _errs10 = errors;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (errors === _errs11) {
                      if (typeof data3 === "string") {
                        if (!formats2.validate(data3)) {
                          validate33.errors = [
                            {
                              instancePath: instancePath + "/created_at",
                              schemaPath: "#/$defs/dateTime/format",
                              keyword: "format",
                              params: { format: "date-time" },
                              message:
                                'must match format "' + "date-time" + '"',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate33.errors = [
                          {
                            instancePath: instancePath + "/created_at",
                            schemaPath: "#/$defs/dateTime/type",
                            keyword: "type",
                            params: { type: "string" },
                            message: "must be string",
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.updated_at !== undefined) {
                    let data4 = data.updated_at;
                    const _errs13 = errors;
                    const _errs14 = errors;
                    if (errors === _errs14) {
                      if (errors === _errs14) {
                        if (typeof data4 === "string") {
                          if (!formats2.validate(data4)) {
                            validate33.errors = [
                              {
                                instancePath: instancePath + "/updated_at",
                                schemaPath: "#/$defs/dateTime/format",
                                keyword: "format",
                                params: { format: "date-time" },
                                message:
                                  'must match format "' + "date-time" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate33.errors = [
                            {
                              instancePath: instancePath + "/updated_at",
                              schemaPath: "#/$defs/dateTime/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs13 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.deleted_at !== undefined) {
                      let data5 = data.deleted_at;
                      const _errs16 = errors;
                      const _errs17 = errors;
                      let valid5 = false;
                      let passing0 = null;
                      const _errs18 = errors;
                      const _errs19 = errors;
                      if (errors === _errs19) {
                        if (errors === _errs19) {
                          if (typeof data5 === "string") {
                            if (!formats2.validate(data5)) {
                              const err0 = {
                                instancePath: instancePath + "/deleted_at",
                                schemaPath: "#/$defs/dateTime/format",
                                keyword: "format",
                                params: { format: "date-time" },
                                message:
                                  'must match format "' + "date-time" + '"',
                              };
                              if (vErrors === null) {
                                vErrors = [err0];
                              } else {
                                vErrors.push(err0);
                              }
                              errors++;
                            }
                          } else {
                            const err1 = {
                              instancePath: instancePath + "/deleted_at",
                              schemaPath: "#/$defs/dateTime/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            };
                            if (vErrors === null) {
                              vErrors = [err1];
                            } else {
                              vErrors.push(err1);
                            }
                            errors++;
                          }
                        }
                      }
                      var _valid0 = _errs18 === errors;
                      if (_valid0) {
                        valid5 = true;
                        passing0 = 0;
                      }
                      const _errs21 = errors;
                      if (data5 !== null) {
                        const err2 = {
                          instancePath: instancePath + "/deleted_at",
                          schemaPath: "#/properties/deleted_at/oneOf/1/type",
                          keyword: "type",
                          params: { type: "null" },
                          message: "must be null",
                        };
                        if (vErrors === null) {
                          vErrors = [err2];
                        } else {
                          vErrors.push(err2);
                        }
                        errors++;
                      }
                      var _valid0 = _errs21 === errors;
                      if (_valid0 && valid5) {
                        valid5 = false;
                        passing0 = [passing0, 1];
                      } else {
                        if (_valid0) {
                          valid5 = true;
                          passing0 = 1;
                        }
                      }
                      if (!valid5) {
                        const err3 = {
                          instancePath: instancePath + "/deleted_at",
                          schemaPath: "#/properties/deleted_at/oneOf",
                          keyword: "oneOf",
                          params: { passingSchemas: passing0 },
                          message: "must match exactly one schema in oneOf",
                        };
                        if (vErrors === null) {
                          vErrors = [err3];
                        } else {
                          vErrors.push(err3);
                        }
                        errors++;
                        validate33.errors = vErrors;
                        return false;
                      } else {
                        errors = _errs17;
                        if (vErrors !== null) {
                          if (_errs17) {
                            vErrors.length = _errs17;
                          } else {
                            vErrors = null;
                          }
                        }
                      }
                      var valid0 = _errs16 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.created_by !== undefined) {
                        let data6 = data.created_by;
                        const _errs23 = errors;
                        const _errs24 = errors;
                        if (errors === _errs24) {
                          if (errors === _errs24) {
                            if (typeof data6 === "string") {
                              if (!formats0.test(data6)) {
                                validate33.errors = [
                                  {
                                    instancePath: instancePath + "/created_by",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate33.errors = [
                                {
                                  instancePath: instancePath + "/created_by",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid0 = _errs23 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.updated_by !== undefined) {
                          let data7 = data.updated_by;
                          const _errs26 = errors;
                          const _errs27 = errors;
                          if (errors === _errs27) {
                            if (errors === _errs27) {
                              if (typeof data7 === "string") {
                                if (!formats0.test(data7)) {
                                  validate33.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/updated_by",
                                      schemaPath: "#/$defs/uuid/format",
                                      keyword: "format",
                                      params: { format: "uuid" },
                                      message:
                                        'must match format "' + "uuid" + '"',
                                    },
                                  ];
                                  return false;
                                }
                              } else {
                                validate33.errors = [
                                  {
                                    instancePath: instancePath + "/updated_by",
                                    schemaPath: "#/$defs/uuid/type",
                                    keyword: "type",
                                    params: { type: "string" },
                                    message: "must be string",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid0 = _errs26 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.payload !== undefined) {
                            let data8 = data.payload;
                            const _errs29 = errors;
                            const _errs30 = errors;
                            if (errors === _errs30) {
                              if (
                                data8 &&
                                typeof data8 == "object" &&
                                !Array.isArray(data8)
                              ) {
                                if (Object.keys(data8).length > 200) {
                                  validate33.errors = [
                                    {
                                      instancePath: instancePath + "/payload",
                                      schemaPath:
                                        "#/$defs/payload/maxProperties",
                                      keyword: "maxProperties",
                                      params: { limit: 200 },
                                      message:
                                        "must NOT have more than 200 properties",
                                    },
                                  ];
                                  return false;
                                }
                              } else {
                                validate33.errors = [
                                  {
                                    instancePath: instancePath + "/payload",
                                    schemaPath: "#/$defs/payload/type",
                                    keyword: "type",
                                    params: { type: "object" },
                                    message: "must be object",
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid0 = _errs29 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.payload_hash !== undefined) {
                              let data9 = data.payload_hash;
                              const _errs33 = errors;
                              const _errs34 = errors;
                              if (errors === _errs34) {
                                if (typeof data9 === "string") {
                                  if (!pattern4.test(data9)) {
                                    validate33.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/payload_hash",
                                        schemaPath: "#/$defs/hash/pattern",
                                        keyword: "pattern",
                                        params: {
                                          pattern: "^sha256:[a-f0-9]{64}$",
                                        },
                                        message:
                                          'must match pattern "' +
                                          "^sha256:[a-f0-9]{64}$" +
                                          '"',
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate33.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/payload_hash",
                                      schemaPath: "#/$defs/hash/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                      message: "must be string",
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs33 === errors;
                            } else {
                              var valid0 = true;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate33.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate33.errors = vErrors;
  return errors === 0;
}
validate33.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate30(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate30.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (
      !validate27(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate27.errors
          : vErrors.concat(validate27.errors);
      errors = vErrors.length;
    }
    var valid0 = _errs1 === errors;
    if (valid0) {
      const _errs2 = errors;
      if (errors === _errs2) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing0;
          if (
            (data.message_type === undefined && (missing0 = "message_type")) ||
            (data.protocol_version === undefined &&
              (missing0 = "protocol_version")) ||
            (data.min_supported_version === undefined &&
              (missing0 = "min_supported_version")) ||
            (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
            (data.device_id === undefined && (missing0 = "device_id")) ||
            (data.sync_epoch === undefined && (missing0 = "sync_epoch")) ||
            (data.snapshot_schema_version === undefined &&
              (missing0 = "snapshot_schema_version")) ||
            (data.snapshot_id === undefined && (missing0 = "snapshot_id")) ||
            (data.chunk_index === undefined && (missing0 = "chunk_index")) ||
            (data.chunk_count === undefined && (missing0 = "chunk_count")) ||
            (data.cursor === undefined && (missing0 = "cursor")) ||
            (data.snapshot_checksum === undefined &&
              (missing0 = "snapshot_checksum")) ||
            (data.chunk_checksum === undefined &&
              (missing0 = "chunk_checksum")) ||
            (data.records === undefined && (missing0 = "records")) ||
            (data.created_at === undefined && (missing0 = "created_at"))
          ) {
            validate30.errors = [
              {
                instancePath,
                schemaPath: "#/allOf/2/required",
                keyword: "required",
                params: { missingProperty: missing0 },
                message: "must have required property '" + missing0 + "'",
              },
            ];
            return false;
          } else {
            const _errs4 = errors;
            for (const key0 in data) {
              if (!func1.call(schema48.allOf[2].properties, key0)) {
                validate30.errors = [
                  {
                    instancePath,
                    schemaPath: "#/allOf/2/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: key0 },
                    message: "must NOT have additional properties",
                  },
                ];
                return false;
                break;
              }
            }
            if (_errs4 === errors) {
              if (data.message_type !== undefined) {
                const _errs5 = errors;
                if ("bootstrap_response" !== data.message_type) {
                  validate30.errors = [
                    {
                      instancePath: instancePath + "/message_type",
                      schemaPath: "#/allOf/2/properties/message_type/const",
                      keyword: "const",
                      params: { allowedValue: "bootstrap_response" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.protocol_version !== undefined) {
                  const _errs6 = errors;
                  if ("sync-v1" !== data.protocol_version) {
                    validate30.errors = [
                      {
                        instancePath: instancePath + "/protocol_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs6 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.min_supported_version !== undefined) {
                    const _errs8 = errors;
                    if ("sync-v1" !== data.min_supported_version) {
                      validate30.errors = [
                        {
                          instancePath: instancePath + "/min_supported_version",
                          schemaPath: "#/$defs/protocolVersion/const",
                          keyword: "const",
                          params: { allowedValue: "sync-v1" },
                          message: "must be equal to constant",
                        },
                      ];
                      return false;
                    }
                    var valid1 = _errs8 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.workspace_id !== undefined) {
                      let data3 = data.workspace_id;
                      const _errs10 = errors;
                      const _errs11 = errors;
                      if (errors === _errs11) {
                        if (errors === _errs11) {
                          if (typeof data3 === "string") {
                            if (!formats0.test(data3)) {
                              validate30.errors = [
                                {
                                  instancePath: instancePath + "/workspace_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate30.errors = [
                              {
                                instancePath: instancePath + "/workspace_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid1 = _errs10 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.device_id !== undefined) {
                        let data4 = data.device_id;
                        const _errs13 = errors;
                        const _errs14 = errors;
                        if (errors === _errs14) {
                          if (errors === _errs14) {
                            if (typeof data4 === "string") {
                              if (!formats0.test(data4)) {
                                validate30.errors = [
                                  {
                                    instancePath: instancePath + "/device_id",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate30.errors = [
                                {
                                  instancePath: instancePath + "/device_id",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid1 = _errs13 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.sync_epoch !== undefined) {
                          let data5 = data.sync_epoch;
                          const _errs16 = errors;
                          const _errs17 = errors;
                          if (errors === _errs17) {
                            if (errors === _errs17) {
                              if (typeof data5 === "string") {
                                if (!formats0.test(data5)) {
                                  validate30.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/sync_epoch",
                                      schemaPath: "#/$defs/uuid/format",
                                      keyword: "format",
                                      params: { format: "uuid" },
                                      message:
                                        'must match format "' + "uuid" + '"',
                                    },
                                  ];
                                  return false;
                                }
                              } else {
                                validate30.errors = [
                                  {
                                    instancePath: instancePath + "/sync_epoch",
                                    schemaPath: "#/$defs/uuid/type",
                                    keyword: "type",
                                    params: { type: "string" },
                                    message: "must be string",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid1 = _errs16 === errors;
                        } else {
                          var valid1 = true;
                        }
                        if (valid1) {
                          if (data.snapshot_schema_version !== undefined) {
                            const _errs19 = errors;
                            if (1 !== data.snapshot_schema_version) {
                              validate30.errors = [
                                {
                                  instancePath:
                                    instancePath + "/snapshot_schema_version",
                                  schemaPath:
                                    "#/allOf/2/properties/snapshot_schema_version/const",
                                  keyword: "const",
                                  params: { allowedValue: 1 },
                                  message: "must be equal to constant",
                                },
                              ];
                              return false;
                            }
                            var valid1 = _errs19 === errors;
                          } else {
                            var valid1 = true;
                          }
                          if (valid1) {
                            if (data.snapshot_id !== undefined) {
                              let data7 = data.snapshot_id;
                              const _errs20 = errors;
                              const _errs21 = errors;
                              if (errors === _errs21) {
                                if (errors === _errs21) {
                                  if (typeof data7 === "string") {
                                    if (!formats0.test(data7)) {
                                      validate30.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/snapshot_id",
                                          schemaPath: "#/$defs/uuid/format",
                                          keyword: "format",
                                          params: { format: "uuid" },
                                          message:
                                            'must match format "' +
                                            "uuid" +
                                            '"',
                                        },
                                      ];
                                      return false;
                                    }
                                  } else {
                                    validate30.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/snapshot_id",
                                        schemaPath: "#/$defs/uuid/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                        message: "must be string",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                              var valid1 = _errs20 === errors;
                            } else {
                              var valid1 = true;
                            }
                            if (valid1) {
                              if (data.chunk_index !== undefined) {
                                let data8 = data.chunk_index;
                                const _errs23 = errors;
                                if (
                                  !(
                                    typeof data8 == "number" &&
                                    !(data8 % 1) &&
                                    !isNaN(data8) &&
                                    isFinite(data8)
                                  )
                                ) {
                                  validate30.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/chunk_index",
                                      schemaPath:
                                        "#/allOf/2/properties/chunk_index/type",
                                      keyword: "type",
                                      params: { type: "integer" },
                                      message: "must be integer",
                                    },
                                  ];
                                  return false;
                                }
                                if (errors === _errs23) {
                                  if (
                                    typeof data8 == "number" &&
                                    isFinite(data8)
                                  ) {
                                    if (data8 < 0 || isNaN(data8)) {
                                      validate30.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/chunk_index",
                                          schemaPath:
                                            "#/allOf/2/properties/chunk_index/minimum",
                                          keyword: "minimum",
                                          params: {
                                            comparison: ">=",
                                            limit: 0,
                                          },
                                          message: "must be >= 0",
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                }
                                var valid1 = _errs23 === errors;
                              } else {
                                var valid1 = true;
                              }
                              if (valid1) {
                                if (data.chunk_count !== undefined) {
                                  let data9 = data.chunk_count;
                                  const _errs25 = errors;
                                  if (
                                    !(
                                      typeof data9 == "number" &&
                                      !(data9 % 1) &&
                                      !isNaN(data9) &&
                                      isFinite(data9)
                                    )
                                  ) {
                                    validate30.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/chunk_count",
                                        schemaPath:
                                          "#/allOf/2/properties/chunk_count/type",
                                        keyword: "type",
                                        params: { type: "integer" },
                                        message: "must be integer",
                                      },
                                    ];
                                    return false;
                                  }
                                  if (errors === _errs25) {
                                    if (
                                      typeof data9 == "number" &&
                                      isFinite(data9)
                                    ) {
                                      if (data9 > 100000 || isNaN(data9)) {
                                        validate30.errors = [
                                          {
                                            instancePath:
                                              instancePath + "/chunk_count",
                                            schemaPath:
                                              "#/allOf/2/properties/chunk_count/maximum",
                                            keyword: "maximum",
                                            params: {
                                              comparison: "<=",
                                              limit: 100000,
                                            },
                                            message: "must be <= 100000",
                                          },
                                        ];
                                        return false;
                                      } else {
                                        if (data9 < 1 || isNaN(data9)) {
                                          validate30.errors = [
                                            {
                                              instancePath:
                                                instancePath + "/chunk_count",
                                              schemaPath:
                                                "#/allOf/2/properties/chunk_count/minimum",
                                              keyword: "minimum",
                                              params: {
                                                comparison: ">=",
                                                limit: 1,
                                              },
                                              message: "must be >= 1",
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                    }
                                  }
                                  var valid1 = _errs25 === errors;
                                } else {
                                  var valid1 = true;
                                }
                                if (valid1) {
                                  if (data.cursor !== undefined) {
                                    let data10 = data.cursor;
                                    const _errs27 = errors;
                                    const _errs28 = errors;
                                    if (
                                      !(
                                        typeof data10 == "number" &&
                                        !(data10 % 1) &&
                                        !isNaN(data10) &&
                                        isFinite(data10)
                                      )
                                    ) {
                                      validate30.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/cursor",
                                          schemaPath: "#/$defs/cursor/type",
                                          keyword: "type",
                                          params: { type: "integer" },
                                          message: "must be integer",
                                        },
                                      ];
                                      return false;
                                    }
                                    if (errors === _errs28) {
                                      if (
                                        typeof data10 == "number" &&
                                        isFinite(data10)
                                      ) {
                                        if (data10 < 0 || isNaN(data10)) {
                                          validate30.errors = [
                                            {
                                              instancePath:
                                                instancePath + "/cursor",
                                              schemaPath:
                                                "#/$defs/cursor/minimum",
                                              keyword: "minimum",
                                              params: {
                                                comparison: ">=",
                                                limit: 0,
                                              },
                                              message: "must be >= 0",
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                    }
                                    var valid1 = _errs27 === errors;
                                  } else {
                                    var valid1 = true;
                                  }
                                  if (valid1) {
                                    if (data.snapshot_checksum !== undefined) {
                                      let data11 = data.snapshot_checksum;
                                      const _errs30 = errors;
                                      const _errs31 = errors;
                                      if (errors === _errs31) {
                                        if (typeof data11 === "string") {
                                          if (!pattern4.test(data11)) {
                                            validate30.errors = [
                                              {
                                                instancePath:
                                                  instancePath +
                                                  "/snapshot_checksum",
                                                schemaPath:
                                                  "#/$defs/hash/pattern",
                                                keyword: "pattern",
                                                params: {
                                                  pattern:
                                                    "^sha256:[a-f0-9]{64}$",
                                                },
                                                message:
                                                  'must match pattern "' +
                                                  "^sha256:[a-f0-9]{64}$" +
                                                  '"',
                                              },
                                            ];
                                            return false;
                                          }
                                        } else {
                                          validate30.errors = [
                                            {
                                              instancePath:
                                                instancePath +
                                                "/snapshot_checksum",
                                              schemaPath: "#/$defs/hash/type",
                                              keyword: "type",
                                              params: { type: "string" },
                                              message: "must be string",
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                      var valid1 = _errs30 === errors;
                                    } else {
                                      var valid1 = true;
                                    }
                                    if (valid1) {
                                      if (data.chunk_checksum !== undefined) {
                                        let data12 = data.chunk_checksum;
                                        const _errs33 = errors;
                                        const _errs34 = errors;
                                        if (errors === _errs34) {
                                          if (typeof data12 === "string") {
                                            if (!pattern4.test(data12)) {
                                              validate30.errors = [
                                                {
                                                  instancePath:
                                                    instancePath +
                                                    "/chunk_checksum",
                                                  schemaPath:
                                                    "#/$defs/hash/pattern",
                                                  keyword: "pattern",
                                                  params: {
                                                    pattern:
                                                      "^sha256:[a-f0-9]{64}$",
                                                  },
                                                  message:
                                                    'must match pattern "' +
                                                    "^sha256:[a-f0-9]{64}$" +
                                                    '"',
                                                },
                                              ];
                                              return false;
                                            }
                                          } else {
                                            validate30.errors = [
                                              {
                                                instancePath:
                                                  instancePath +
                                                  "/chunk_checksum",
                                                schemaPath: "#/$defs/hash/type",
                                                keyword: "type",
                                                params: { type: "string" },
                                                message: "must be string",
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                        var valid1 = _errs33 === errors;
                                      } else {
                                        var valid1 = true;
                                      }
                                      if (valid1) {
                                        if (data.records !== undefined) {
                                          let data13 = data.records;
                                          const _errs36 = errors;
                                          if (errors === _errs36) {
                                            if (Array.isArray(data13)) {
                                              if (data13.length > 1000) {
                                                validate30.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath + "/records",
                                                    schemaPath:
                                                      "#/allOf/2/properties/records/maxItems",
                                                    keyword: "maxItems",
                                                    params: { limit: 1000 },
                                                    message:
                                                      "must NOT have more than 1000 items",
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                var valid11 = true;
                                                const len0 = data13.length;
                                                for (
                                                  let i0 = 0;
                                                  i0 < len0;
                                                  i0++
                                                ) {
                                                  const _errs38 = errors;
                                                  if (
                                                    !validate33(data13[i0], {
                                                      instancePath:
                                                        instancePath +
                                                        "/records/" +
                                                        i0,
                                                      parentData: data13,
                                                      parentDataProperty: i0,
                                                      rootData,
                                                      dynamicAnchors,
                                                    })
                                                  ) {
                                                    vErrors =
                                                      vErrors === null
                                                        ? validate33.errors
                                                        : vErrors.concat(
                                                            validate33.errors,
                                                          );
                                                    errors = vErrors.length;
                                                  }
                                                  var valid11 =
                                                    _errs38 === errors;
                                                  if (!valid11) {
                                                    break;
                                                  }
                                                }
                                              }
                                            } else {
                                              validate30.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + "/records",
                                                  schemaPath:
                                                    "#/allOf/2/properties/records/type",
                                                  keyword: "type",
                                                  params: { type: "array" },
                                                  message: "must be array",
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                          var valid1 = _errs36 === errors;
                                        } else {
                                          var valid1 = true;
                                        }
                                        if (valid1) {
                                          if (data.created_at !== undefined) {
                                            let data15 = data.created_at;
                                            const _errs39 = errors;
                                            const _errs40 = errors;
                                            if (errors === _errs40) {
                                              if (errors === _errs40) {
                                                if (
                                                  typeof data15 === "string"
                                                ) {
                                                  if (
                                                    !formats2.validate(data15)
                                                  ) {
                                                    validate30.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          "/created_at",
                                                        schemaPath:
                                                          "#/$defs/dateTime/format",
                                                        keyword: "format",
                                                        params: {
                                                          format: "date-time",
                                                        },
                                                        message:
                                                          'must match format "' +
                                                          "date-time" +
                                                          '"',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                } else {
                                                  validate30.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath +
                                                        "/created_at",
                                                      schemaPath:
                                                        "#/$defs/dateTime/type",
                                                      keyword: "type",
                                                      params: {
                                                        type: "string",
                                                      },
                                                      message: "must be string",
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                            }
                                            var valid1 = _errs39 === errors;
                                          } else {
                                            var valid1 = true;
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          validate30.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/2/type",
              keyword: "type",
              params: { type: "object" },
              message: "must be object",
            },
          ];
          return false;
        }
      }
      var valid0 = _errs2 === errors;
    }
  }
  validate30.errors = vErrors;
  return errors === 0;
}
validate30.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema69 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    { $ref: "#/$defs/workspaceDevice" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "workspace_id",
        "device_id",
        "sync_epoch",
        "operations",
      ],
      properties: {
        message_type: { const: "push_request" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        sync_epoch: { $ref: "#/$defs/uuid" },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { $ref: "#/$defs/syncOperation" },
        },
      },
    },
  ],
};
const schema74 = {
  title: "SyncOperationV1",
  type: "object",
  additionalProperties: false,
  required: [
    "operation_id",
    "protocol_version",
    "workspace_id",
    "device_id",
    "entity_type",
    "entity_id",
    "operation_type",
    "base_version",
    "client_occurred_at",
    "payload",
    "payload_hash",
    "dependencies",
  ],
  properties: {
    operation_id: { $ref: "#/$defs/uuid" },
    protocol_version: { $ref: "#/$defs/protocolVersion" },
    workspace_id: { $ref: "#/$defs/uuid" },
    device_id: { $ref: "#/$defs/uuid" },
    entity_type: { $ref: "#/$defs/entityType" },
    entity_id: { $ref: "#/$defs/uuid" },
    operation_type: { enum: ["create", "update", "delete", "restore"] },
    base_version: { type: "integer", minimum: 0 },
    client_occurred_at: { $ref: "#/$defs/dateTime" },
    payload: { $ref: "#/$defs/payload" },
    payload_hash: { $ref: "#/$defs/hash" },
    conflict_resolution: {
      oneOf: [{ $ref: "#/$defs/conflictResolution" }, { type: "null" }],
    },
    dependencies: {
      type: "array",
      maxItems: 100,
      uniqueItems: true,
      items: { $ref: "#/$defs/uuid" },
    },
  },
};
const func0 = equalSyncV1UniqueItem;
const schema84 = {
  type: "object",
  additionalProperties: false,
  required: ["conflict_id", "resolution", "expected_remote_version"],
  properties: {
    conflict_id: { $ref: "#/$defs/uuid" },
    resolution: { enum: ["keep_local", "keep_remote", "merge", "dismiss"] },
    expected_remote_version: { type: "integer", minimum: 1 },
  },
};
function validate40(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate40.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.conflict_id === undefined && (missing0 = "conflict_id")) ||
        (data.resolution === undefined && (missing0 = "resolution")) ||
        (data.expected_remote_version === undefined &&
          (missing0 = "expected_remote_version"))
      ) {
        validate40.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "conflict_id" ||
              key0 === "resolution" ||
              key0 === "expected_remote_version"
            )
          ) {
            validate40.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.conflict_id !== undefined) {
            let data0 = data.conflict_id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === "string") {
                  if (!formats0.test(data0)) {
                    validate40.errors = [
                      {
                        instancePath: instancePath + "/conflict_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate40.errors = [
                    {
                      instancePath: instancePath + "/conflict_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.resolution !== undefined) {
              let data1 = data.resolution;
              const _errs5 = errors;
              if (
                !(
                  data1 === "keep_local" ||
                  data1 === "keep_remote" ||
                  data1 === "merge" ||
                  data1 === "dismiss"
                )
              ) {
                validate40.errors = [
                  {
                    instancePath: instancePath + "/resolution",
                    schemaPath: "#/properties/resolution/enum",
                    keyword: "enum",
                    params: {
                      allowedValues: schema84.properties.resolution.enum,
                    },
                    message: "must be equal to one of the allowed values",
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.expected_remote_version !== undefined) {
                let data2 = data.expected_remote_version;
                const _errs6 = errors;
                if (
                  !(
                    typeof data2 == "number" &&
                    !(data2 % 1) &&
                    !isNaN(data2) &&
                    isFinite(data2)
                  )
                ) {
                  validate40.errors = [
                    {
                      instancePath: instancePath + "/expected_remote_version",
                      schemaPath: "#/properties/expected_remote_version/type",
                      keyword: "type",
                      params: { type: "integer" },
                      message: "must be integer",
                    },
                  ];
                  return false;
                }
                if (errors === _errs6) {
                  if (typeof data2 == "number" && isFinite(data2)) {
                    if (data2 < 1 || isNaN(data2)) {
                      validate40.errors = [
                        {
                          instancePath:
                            instancePath + "/expected_remote_version",
                          schemaPath:
                            "#/properties/expected_remote_version/minimum",
                          keyword: "minimum",
                          params: { comparison: ">=", limit: 1 },
                          message: "must be >= 1",
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate40.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate40.errors = vErrors;
  return errors === 0;
}
validate40.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate39(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate39.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.operation_id === undefined && (missing0 = "operation_id")) ||
        (data.protocol_version === undefined &&
          (missing0 = "protocol_version")) ||
        (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
        (data.device_id === undefined && (missing0 = "device_id")) ||
        (data.entity_type === undefined && (missing0 = "entity_type")) ||
        (data.entity_id === undefined && (missing0 = "entity_id")) ||
        (data.operation_type === undefined && (missing0 = "operation_type")) ||
        (data.base_version === undefined && (missing0 = "base_version")) ||
        (data.client_occurred_at === undefined &&
          (missing0 = "client_occurred_at")) ||
        (data.payload === undefined && (missing0 = "payload")) ||
        (data.payload_hash === undefined && (missing0 = "payload_hash")) ||
        (data.dependencies === undefined && (missing0 = "dependencies"))
      ) {
        validate39.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema74.properties, key0)) {
            validate39.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.operation_id !== undefined) {
            let data0 = data.operation_id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === "string") {
                  if (!formats0.test(data0)) {
                    validate39.errors = [
                      {
                        instancePath: instancePath + "/operation_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate39.errors = [
                    {
                      instancePath: instancePath + "/operation_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.protocol_version !== undefined) {
              const _errs5 = errors;
              if ("sync-v1" !== data.protocol_version) {
                validate39.errors = [
                  {
                    instancePath: instancePath + "/protocol_version",
                    schemaPath: "#/$defs/protocolVersion/const",
                    keyword: "const",
                    params: { allowedValue: "sync-v1" },
                    message: "must be equal to constant",
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workspace_id !== undefined) {
                let data2 = data.workspace_id;
                const _errs7 = errors;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (errors === _errs8) {
                    if (typeof data2 === "string") {
                      if (!formats0.test(data2)) {
                        validate39.errors = [
                          {
                            instancePath: instancePath + "/workspace_id",
                            schemaPath: "#/$defs/uuid/format",
                            keyword: "format",
                            params: { format: "uuid" },
                            message: 'must match format "' + "uuid" + '"',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate39.errors = [
                        {
                          instancePath: instancePath + "/workspace_id",
                          schemaPath: "#/$defs/uuid/type",
                          keyword: "type",
                          params: { type: "string" },
                          message: "must be string",
                        },
                      ];
                      return false;
                    }
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.device_id !== undefined) {
                  let data3 = data.device_id;
                  const _errs10 = errors;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (errors === _errs11) {
                      if (typeof data3 === "string") {
                        if (!formats0.test(data3)) {
                          validate39.errors = [
                            {
                              instancePath: instancePath + "/device_id",
                              schemaPath: "#/$defs/uuid/format",
                              keyword: "format",
                              params: { format: "uuid" },
                              message: 'must match format "' + "uuid" + '"',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate39.errors = [
                          {
                            instancePath: instancePath + "/device_id",
                            schemaPath: "#/$defs/uuid/type",
                            keyword: "type",
                            params: { type: "string" },
                            message: "must be string",
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.entity_type !== undefined) {
                    let data4 = data.entity_type;
                    const _errs13 = errors;
                    const _errs14 = errors;
                    if (errors === _errs14) {
                      if (typeof data4 === "string") {
                        if (!pattern6.test(data4)) {
                          validate39.errors = [
                            {
                              instancePath: instancePath + "/entity_type",
                              schemaPath: "#/$defs/entityType/pattern",
                              keyword: "pattern",
                              params: { pattern: "^[a-z][a-z0-9_]{1,63}$" },
                              message:
                                'must match pattern "' +
                                "^[a-z][a-z0-9_]{1,63}$" +
                                '"',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate39.errors = [
                          {
                            instancePath: instancePath + "/entity_type",
                            schemaPath: "#/$defs/entityType/type",
                            keyword: "type",
                            params: { type: "string" },
                            message: "must be string",
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs13 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.entity_id !== undefined) {
                      let data5 = data.entity_id;
                      const _errs16 = errors;
                      const _errs17 = errors;
                      if (errors === _errs17) {
                        if (errors === _errs17) {
                          if (typeof data5 === "string") {
                            if (!formats0.test(data5)) {
                              validate39.errors = [
                                {
                                  instancePath: instancePath + "/entity_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate39.errors = [
                              {
                                instancePath: instancePath + "/entity_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs16 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.operation_type !== undefined) {
                        let data6 = data.operation_type;
                        const _errs19 = errors;
                        if (
                          !(
                            data6 === "create" ||
                            data6 === "update" ||
                            data6 === "delete" ||
                            data6 === "restore"
                          )
                        ) {
                          validate39.errors = [
                            {
                              instancePath: instancePath + "/operation_type",
                              schemaPath: "#/properties/operation_type/enum",
                              keyword: "enum",
                              params: {
                                allowedValues:
                                  schema74.properties.operation_type.enum,
                              },
                              message:
                                "must be equal to one of the allowed values",
                            },
                          ];
                          return false;
                        }
                        var valid0 = _errs19 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.base_version !== undefined) {
                          let data7 = data.base_version;
                          const _errs20 = errors;
                          if (
                            !(
                              typeof data7 == "number" &&
                              !(data7 % 1) &&
                              !isNaN(data7) &&
                              isFinite(data7)
                            )
                          ) {
                            validate39.errors = [
                              {
                                instancePath: instancePath + "/base_version",
                                schemaPath: "#/properties/base_version/type",
                                keyword: "type",
                                params: { type: "integer" },
                                message: "must be integer",
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs20) {
                            if (typeof data7 == "number" && isFinite(data7)) {
                              if (data7 < 0 || isNaN(data7)) {
                                validate39.errors = [
                                  {
                                    instancePath:
                                      instancePath + "/base_version",
                                    schemaPath:
                                      "#/properties/base_version/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 0 },
                                    message: "must be >= 0",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid0 = _errs20 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.client_occurred_at !== undefined) {
                            let data8 = data.client_occurred_at;
                            const _errs22 = errors;
                            const _errs23 = errors;
                            if (errors === _errs23) {
                              if (errors === _errs23) {
                                if (typeof data8 === "string") {
                                  if (!formats2.validate(data8)) {
                                    validate39.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/client_occurred_at",
                                        schemaPath: "#/$defs/dateTime/format",
                                        keyword: "format",
                                        params: { format: "date-time" },
                                        message:
                                          'must match format "' +
                                          "date-time" +
                                          '"',
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate39.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/client_occurred_at",
                                      schemaPath: "#/$defs/dateTime/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                      message: "must be string",
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid0 = _errs22 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.payload !== undefined) {
                              let data9 = data.payload;
                              const _errs25 = errors;
                              const _errs26 = errors;
                              if (errors === _errs26) {
                                if (
                                  data9 &&
                                  typeof data9 == "object" &&
                                  !Array.isArray(data9)
                                ) {
                                  if (Object.keys(data9).length > 200) {
                                    validate39.errors = [
                                      {
                                        instancePath: instancePath + "/payload",
                                        schemaPath:
                                          "#/$defs/payload/maxProperties",
                                        keyword: "maxProperties",
                                        params: { limit: 200 },
                                        message:
                                          "must NOT have more than 200 properties",
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate39.errors = [
                                    {
                                      instancePath: instancePath + "/payload",
                                      schemaPath: "#/$defs/payload/type",
                                      keyword: "type",
                                      params: { type: "object" },
                                      message: "must be object",
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs25 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.payload_hash !== undefined) {
                                let data10 = data.payload_hash;
                                const _errs29 = errors;
                                const _errs30 = errors;
                                if (errors === _errs30) {
                                  if (typeof data10 === "string") {
                                    if (!pattern4.test(data10)) {
                                      validate39.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/payload_hash",
                                          schemaPath: "#/$defs/hash/pattern",
                                          keyword: "pattern",
                                          params: {
                                            pattern: "^sha256:[a-f0-9]{64}$",
                                          },
                                          message:
                                            'must match pattern "' +
                                            "^sha256:[a-f0-9]{64}$" +
                                            '"',
                                        },
                                      ];
                                      return false;
                                    }
                                  } else {
                                    validate39.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/payload_hash",
                                        schemaPath: "#/$defs/hash/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                        message: "must be string",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid0 = _errs29 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.conflict_resolution !== undefined) {
                                  let data11 = data.conflict_resolution;
                                  const _errs32 = errors;
                                  const _errs33 = errors;
                                  let valid10 = false;
                                  let passing0 = null;
                                  const _errs34 = errors;
                                  if (
                                    !validate40(data11, {
                                      instancePath:
                                        instancePath + "/conflict_resolution",
                                      parentData: data,
                                      parentDataProperty: "conflict_resolution",
                                      rootData,
                                      dynamicAnchors,
                                    })
                                  ) {
                                    vErrors =
                                      vErrors === null
                                        ? validate40.errors
                                        : vErrors.concat(validate40.errors);
                                    errors = vErrors.length;
                                  }
                                  var _valid0 = _errs34 === errors;
                                  if (_valid0) {
                                    valid10 = true;
                                    passing0 = 0;
                                  }
                                  const _errs35 = errors;
                                  if (data11 !== null) {
                                    const err0 = {
                                      instancePath:
                                        instancePath + "/conflict_resolution",
                                      schemaPath:
                                        "#/properties/conflict_resolution/oneOf/1/type",
                                      keyword: "type",
                                      params: { type: "null" },
                                      message: "must be null",
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err0];
                                    } else {
                                      vErrors.push(err0);
                                    }
                                    errors++;
                                  }
                                  var _valid0 = _errs35 === errors;
                                  if (_valid0 && valid10) {
                                    valid10 = false;
                                    passing0 = [passing0, 1];
                                  } else {
                                    if (_valid0) {
                                      valid10 = true;
                                      passing0 = 1;
                                    }
                                  }
                                  if (!valid10) {
                                    const err1 = {
                                      instancePath:
                                        instancePath + "/conflict_resolution",
                                      schemaPath:
                                        "#/properties/conflict_resolution/oneOf",
                                      keyword: "oneOf",
                                      params: { passingSchemas: passing0 },
                                      message:
                                        "must match exactly one schema in oneOf",
                                    };
                                    if (vErrors === null) {
                                      vErrors = [err1];
                                    } else {
                                      vErrors.push(err1);
                                    }
                                    errors++;
                                    validate39.errors = vErrors;
                                    return false;
                                  } else {
                                    errors = _errs33;
                                    if (vErrors !== null) {
                                      if (_errs33) {
                                        vErrors.length = _errs33;
                                      } else {
                                        vErrors = null;
                                      }
                                    }
                                  }
                                  var valid0 = _errs32 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.dependencies !== undefined) {
                                    let data12 = data.dependencies;
                                    const _errs37 = errors;
                                    if (errors === _errs37) {
                                      if (Array.isArray(data12)) {
                                        if (data12.length > 100) {
                                          validate39.errors = [
                                            {
                                              instancePath:
                                                instancePath + "/dependencies",
                                              schemaPath:
                                                "#/properties/dependencies/maxItems",
                                              keyword: "maxItems",
                                              params: { limit: 100 },
                                              message:
                                                "must NOT have more than 100 items",
                                            },
                                          ];
                                          return false;
                                        } else {
                                          var valid11 = true;
                                          const len0 = data12.length;
                                          for (let i0 = 0; i0 < len0; i0++) {
                                            let data13 = data12[i0];
                                            const _errs39 = errors;
                                            const _errs40 = errors;
                                            if (errors === _errs40) {
                                              if (errors === _errs40) {
                                                if (
                                                  typeof data13 === "string"
                                                ) {
                                                  if (!formats0.test(data13)) {
                                                    validate39.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          "/dependencies/" +
                                                          i0,
                                                        schemaPath:
                                                          "#/$defs/uuid/format",
                                                        keyword: "format",
                                                        params: {
                                                          format: "uuid",
                                                        },
                                                        message:
                                                          'must match format "' +
                                                          "uuid" +
                                                          '"',
                                                      },
                                                    ];
                                                    return false;
                                                  }
                                                } else {
                                                  validate39.errors = [
                                                    {
                                                      instancePath:
                                                        instancePath +
                                                        "/dependencies/" +
                                                        i0,
                                                      schemaPath:
                                                        "#/$defs/uuid/type",
                                                      keyword: "type",
                                                      params: {
                                                        type: "string",
                                                      },
                                                      message: "must be string",
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                            }
                                            var valid11 = _errs39 === errors;
                                            if (!valid11) {
                                              break;
                                            }
                                          }
                                          if (valid11) {
                                            let i1 = data12.length;
                                            let j0;
                                            if (i1 > 1) {
                                              outer0: for (; i1--; ) {
                                                for (j0 = i1; j0--; ) {
                                                  if (
                                                    func0(
                                                      data12[i1],
                                                      data12[j0],
                                                    )
                                                  ) {
                                                    validate39.errors = [
                                                      {
                                                        instancePath:
                                                          instancePath +
                                                          "/dependencies",
                                                        schemaPath:
                                                          "#/properties/dependencies/uniqueItems",
                                                        keyword: "uniqueItems",
                                                        params: {
                                                          i: i1,
                                                          j: j0,
                                                        },
                                                        message:
                                                          "must NOT have duplicate items (items ## " +
                                                          j0 +
                                                          " and " +
                                                          i1 +
                                                          " are identical)",
                                                      },
                                                    ];
                                                    return false;
                                                    break outer0;
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      } else {
                                        validate39.errors = [
                                          {
                                            instancePath:
                                              instancePath + "/dependencies",
                                            schemaPath:
                                              "#/properties/dependencies/type",
                                            keyword: "type",
                                            params: { type: "array" },
                                            message: "must be array",
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                    var valid0 = _errs37 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate39.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate39.errors = vErrors;
  return errors === 0;
}
validate39.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate36(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate36.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (
      !validate27(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate27.errors
          : vErrors.concat(validate27.errors);
      errors = vErrors.length;
    }
    var valid0 = _errs1 === errors;
    if (valid0) {
      const _errs2 = errors;
      if (errors === _errs2) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing0;
          if (
            (data.message_type === undefined && (missing0 = "message_type")) ||
            (data.protocol_version === undefined &&
              (missing0 = "protocol_version")) ||
            (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
            (data.device_id === undefined && (missing0 = "device_id")) ||
            (data.sync_epoch === undefined && (missing0 = "sync_epoch")) ||
            (data.operations === undefined && (missing0 = "operations"))
          ) {
            validate36.errors = [
              {
                instancePath,
                schemaPath: "#/allOf/2/required",
                keyword: "required",
                params: { missingProperty: missing0 },
                message: "must have required property '" + missing0 + "'",
              },
            ];
            return false;
          } else {
            const _errs4 = errors;
            for (const key0 in data) {
              if (
                !(
                  key0 === "message_type" ||
                  key0 === "protocol_version" ||
                  key0 === "workspace_id" ||
                  key0 === "device_id" ||
                  key0 === "sync_epoch" ||
                  key0 === "operations"
                )
              ) {
                validate36.errors = [
                  {
                    instancePath,
                    schemaPath: "#/allOf/2/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: key0 },
                    message: "must NOT have additional properties",
                  },
                ];
                return false;
                break;
              }
            }
            if (_errs4 === errors) {
              if (data.message_type !== undefined) {
                const _errs5 = errors;
                if ("push_request" !== data.message_type) {
                  validate36.errors = [
                    {
                      instancePath: instancePath + "/message_type",
                      schemaPath: "#/allOf/2/properties/message_type/const",
                      keyword: "const",
                      params: { allowedValue: "push_request" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.protocol_version !== undefined) {
                  const _errs6 = errors;
                  if ("sync-v1" !== data.protocol_version) {
                    validate36.errors = [
                      {
                        instancePath: instancePath + "/protocol_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs6 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.workspace_id !== undefined) {
                    let data2 = data.workspace_id;
                    const _errs8 = errors;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (errors === _errs9) {
                        if (typeof data2 === "string") {
                          if (!formats0.test(data2)) {
                            validate36.errors = [
                              {
                                instancePath: instancePath + "/workspace_id",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate36.errors = [
                            {
                              instancePath: instancePath + "/workspace_id",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid1 = _errs8 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.device_id !== undefined) {
                      let data3 = data.device_id;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (errors === _errs12) {
                          if (typeof data3 === "string") {
                            if (!formats0.test(data3)) {
                              validate36.errors = [
                                {
                                  instancePath: instancePath + "/device_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate36.errors = [
                              {
                                instancePath: instancePath + "/device_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid1 = _errs11 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.sync_epoch !== undefined) {
                        let data4 = data.sync_epoch;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        if (errors === _errs15) {
                          if (errors === _errs15) {
                            if (typeof data4 === "string") {
                              if (!formats0.test(data4)) {
                                validate36.errors = [
                                  {
                                    instancePath: instancePath + "/sync_epoch",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate36.errors = [
                                {
                                  instancePath: instancePath + "/sync_epoch",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid1 = _errs14 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.operations !== undefined) {
                          let data5 = data.operations;
                          const _errs17 = errors;
                          if (errors === _errs17) {
                            if (Array.isArray(data5)) {
                              if (data5.length > 100) {
                                validate36.errors = [
                                  {
                                    instancePath: instancePath + "/operations",
                                    schemaPath:
                                      "#/allOf/2/properties/operations/maxItems",
                                    keyword: "maxItems",
                                    params: { limit: 100 },
                                    message:
                                      "must NOT have more than 100 items",
                                  },
                                ];
                                return false;
                              } else {
                                if (data5.length < 1) {
                                  validate36.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/operations",
                                      schemaPath:
                                        "#/allOf/2/properties/operations/minItems",
                                      keyword: "minItems",
                                      params: { limit: 1 },
                                      message:
                                        "must NOT have fewer than 1 items",
                                    },
                                  ];
                                  return false;
                                } else {
                                  var valid6 = true;
                                  const len0 = data5.length;
                                  for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs19 = errors;
                                    if (
                                      !validate39(data5[i0], {
                                        instancePath:
                                          instancePath + "/operations/" + i0,
                                        parentData: data5,
                                        parentDataProperty: i0,
                                        rootData,
                                        dynamicAnchors,
                                      })
                                    ) {
                                      vErrors =
                                        vErrors === null
                                          ? validate39.errors
                                          : vErrors.concat(validate39.errors);
                                      errors = vErrors.length;
                                    }
                                    var valid6 = _errs19 === errors;
                                    if (!valid6) {
                                      break;
                                    }
                                  }
                                }
                              }
                            } else {
                              validate36.errors = [
                                {
                                  instancePath: instancePath + "/operations",
                                  schemaPath:
                                    "#/allOf/2/properties/operations/type",
                                  keyword: "type",
                                  params: { type: "array" },
                                  message: "must be array",
                                },
                              ];
                              return false;
                            }
                          }
                          var valid1 = _errs17 === errors;
                        } else {
                          var valid1 = true;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          validate36.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/2/type",
              keyword: "type",
              params: { type: "object" },
              message: "must be object",
            },
          ];
          return false;
        }
      }
      var valid0 = _errs2 === errors;
    }
  }
  validate36.errors = vErrors;
  return errors === 0;
}
validate36.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema87 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    { $ref: "#/$defs/workspaceDevice" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "workspace_id",
        "device_id",
        "sync_epoch",
        "results",
      ],
      properties: {
        message_type: { const: "push_response" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        sync_epoch: { $ref: "#/$defs/uuid" },
        results: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { $ref: "#/$defs/operationResult" },
        },
      },
    },
  ],
};
const schema92 = {
  oneOf: [
    { $ref: "#/$defs/appliedOperationResult" },
    { $ref: "#/$defs/conflictOperationResult" },
    { $ref: "#/$defs/failedOperationResult" },
  ],
};
const schema93 = {
  type: "object",
  additionalProperties: false,
  required: [
    "operation_id",
    "status",
    "retryable",
    "server_version",
    "sequence",
  ],
  properties: {
    operation_id: { $ref: "#/$defs/uuid" },
    status: { enum: ["applied", "duplicate"] },
    retryable: { const: false },
    server_version: { type: "integer", minimum: 1 },
    sequence: { type: "integer", minimum: 1 },
  },
};
function validate48(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate48.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.operation_id === undefined && (missing0 = "operation_id")) ||
        (data.status === undefined && (missing0 = "status")) ||
        (data.retryable === undefined && (missing0 = "retryable")) ||
        (data.server_version === undefined && (missing0 = "server_version")) ||
        (data.sequence === undefined && (missing0 = "sequence"))
      ) {
        validate48.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "operation_id" ||
              key0 === "status" ||
              key0 === "retryable" ||
              key0 === "server_version" ||
              key0 === "sequence"
            )
          ) {
            validate48.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.operation_id !== undefined) {
            let data0 = data.operation_id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === "string") {
                  if (!formats0.test(data0)) {
                    validate48.errors = [
                      {
                        instancePath: instancePath + "/operation_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate48.errors = [
                    {
                      instancePath: instancePath + "/operation_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.status !== undefined) {
              let data1 = data.status;
              const _errs5 = errors;
              if (!(data1 === "applied" || data1 === "duplicate")) {
                validate48.errors = [
                  {
                    instancePath: instancePath + "/status",
                    schemaPath: "#/properties/status/enum",
                    keyword: "enum",
                    params: { allowedValues: schema93.properties.status.enum },
                    message: "must be equal to one of the allowed values",
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.retryable !== undefined) {
                const _errs6 = errors;
                if (false !== data.retryable) {
                  validate48.errors = [
                    {
                      instancePath: instancePath + "/retryable",
                      schemaPath: "#/properties/retryable/const",
                      keyword: "const",
                      params: { allowedValue: false },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.server_version !== undefined) {
                  let data3 = data.server_version;
                  const _errs7 = errors;
                  if (
                    !(
                      typeof data3 == "number" &&
                      !(data3 % 1) &&
                      !isNaN(data3) &&
                      isFinite(data3)
                    )
                  ) {
                    validate48.errors = [
                      {
                        instancePath: instancePath + "/server_version",
                        schemaPath: "#/properties/server_version/type",
                        keyword: "type",
                        params: { type: "integer" },
                        message: "must be integer",
                      },
                    ];
                    return false;
                  }
                  if (errors === _errs7) {
                    if (typeof data3 == "number" && isFinite(data3)) {
                      if (data3 < 1 || isNaN(data3)) {
                        validate48.errors = [
                          {
                            instancePath: instancePath + "/server_version",
                            schemaPath: "#/properties/server_version/minimum",
                            keyword: "minimum",
                            params: { comparison: ">=", limit: 1 },
                            message: "must be >= 1",
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.sequence !== undefined) {
                    let data4 = data.sequence;
                    const _errs9 = errors;
                    if (
                      !(
                        typeof data4 == "number" &&
                        !(data4 % 1) &&
                        !isNaN(data4) &&
                        isFinite(data4)
                      )
                    ) {
                      validate48.errors = [
                        {
                          instancePath: instancePath + "/sequence",
                          schemaPath: "#/properties/sequence/type",
                          keyword: "type",
                          params: { type: "integer" },
                          message: "must be integer",
                        },
                      ];
                      return false;
                    }
                    if (errors === _errs9) {
                      if (typeof data4 == "number" && isFinite(data4)) {
                        if (data4 < 1 || isNaN(data4)) {
                          validate48.errors = [
                            {
                              instancePath: instancePath + "/sequence",
                              schemaPath: "#/properties/sequence/minimum",
                              keyword: "minimum",
                              params: { comparison: ">=", limit: 1 },
                              message: "must be >= 1",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs9 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate48.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate48.errors = vErrors;
  return errors === 0;
}
validate48.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema95 = {
  type: "object",
  additionalProperties: false,
  required: ["operation_id", "status", "retryable", "conflict"],
  properties: {
    operation_id: { $ref: "#/$defs/uuid" },
    status: { const: "conflict" },
    retryable: { const: false },
    conflict: { $ref: "#/$defs/conflict" },
  },
};
const schema97 = {
  type: "object",
  additionalProperties: false,
  required: [
    "conflict_id",
    "conflict_kind",
    "status",
    "entity_type",
    "entity_id",
    "base_version",
    "local_payload_hash",
    "remote_version",
    "remote_payload",
    "remote_payload_hash",
    "resolution_options",
    "created_at",
  ],
  properties: {
    conflict_id: { $ref: "#/$defs/uuid" },
    conflict_kind: {
      enum: ["content", "status", "hierarchy", "delete_update", "permission"],
    },
    status: { const: "open" },
    entity_type: { $ref: "#/$defs/entityType" },
    entity_id: { $ref: "#/$defs/uuid" },
    base_version: { type: "integer", minimum: 0 },
    local_payload_hash: { $ref: "#/$defs/hash" },
    remote_version: { type: "integer", minimum: 1 },
    remote_payload: { $ref: "#/$defs/payload" },
    remote_payload_hash: { $ref: "#/$defs/hash" },
    resolution_options: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: ["keep_local", "keep_remote", "merge", "dismiss"] },
    },
    created_at: { $ref: "#/$defs/dateTime" },
  },
};
function validate51(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate51.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.conflict_id === undefined && (missing0 = "conflict_id")) ||
        (data.conflict_kind === undefined && (missing0 = "conflict_kind")) ||
        (data.status === undefined && (missing0 = "status")) ||
        (data.entity_type === undefined && (missing0 = "entity_type")) ||
        (data.entity_id === undefined && (missing0 = "entity_id")) ||
        (data.base_version === undefined && (missing0 = "base_version")) ||
        (data.local_payload_hash === undefined &&
          (missing0 = "local_payload_hash")) ||
        (data.remote_version === undefined && (missing0 = "remote_version")) ||
        (data.remote_payload === undefined && (missing0 = "remote_payload")) ||
        (data.remote_payload_hash === undefined &&
          (missing0 = "remote_payload_hash")) ||
        (data.resolution_options === undefined &&
          (missing0 = "resolution_options")) ||
        (data.created_at === undefined && (missing0 = "created_at"))
      ) {
        validate51.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema97.properties, key0)) {
            validate51.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.conflict_id !== undefined) {
            let data0 = data.conflict_id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === "string") {
                  if (!formats0.test(data0)) {
                    validate51.errors = [
                      {
                        instancePath: instancePath + "/conflict_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate51.errors = [
                    {
                      instancePath: instancePath + "/conflict_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.conflict_kind !== undefined) {
              let data1 = data.conflict_kind;
              const _errs5 = errors;
              if (
                !(
                  data1 === "content" ||
                  data1 === "status" ||
                  data1 === "hierarchy" ||
                  data1 === "delete_update" ||
                  data1 === "permission"
                )
              ) {
                validate51.errors = [
                  {
                    instancePath: instancePath + "/conflict_kind",
                    schemaPath: "#/properties/conflict_kind/enum",
                    keyword: "enum",
                    params: {
                      allowedValues: schema97.properties.conflict_kind.enum,
                    },
                    message: "must be equal to one of the allowed values",
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.status !== undefined) {
                const _errs6 = errors;
                if ("open" !== data.status) {
                  validate51.errors = [
                    {
                      instancePath: instancePath + "/status",
                      schemaPath: "#/properties/status/const",
                      keyword: "const",
                      params: { allowedValue: "open" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.entity_type !== undefined) {
                  let data3 = data.entity_type;
                  const _errs7 = errors;
                  const _errs8 = errors;
                  if (errors === _errs8) {
                    if (typeof data3 === "string") {
                      if (!pattern6.test(data3)) {
                        validate51.errors = [
                          {
                            instancePath: instancePath + "/entity_type",
                            schemaPath: "#/$defs/entityType/pattern",
                            keyword: "pattern",
                            params: { pattern: "^[a-z][a-z0-9_]{1,63}$" },
                            message:
                              'must match pattern "' +
                              "^[a-z][a-z0-9_]{1,63}$" +
                              '"',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate51.errors = [
                        {
                          instancePath: instancePath + "/entity_type",
                          schemaPath: "#/$defs/entityType/type",
                          keyword: "type",
                          params: { type: "string" },
                          message: "must be string",
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.entity_id !== undefined) {
                    let data4 = data.entity_id;
                    const _errs10 = errors;
                    const _errs11 = errors;
                    if (errors === _errs11) {
                      if (errors === _errs11) {
                        if (typeof data4 === "string") {
                          if (!formats0.test(data4)) {
                            validate51.errors = [
                              {
                                instancePath: instancePath + "/entity_id",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate51.errors = [
                            {
                              instancePath: instancePath + "/entity_id",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid0 = _errs10 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.base_version !== undefined) {
                      let data5 = data.base_version;
                      const _errs13 = errors;
                      if (
                        !(
                          typeof data5 == "number" &&
                          !(data5 % 1) &&
                          !isNaN(data5) &&
                          isFinite(data5)
                        )
                      ) {
                        validate51.errors = [
                          {
                            instancePath: instancePath + "/base_version",
                            schemaPath: "#/properties/base_version/type",
                            keyword: "type",
                            params: { type: "integer" },
                            message: "must be integer",
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs13) {
                        if (typeof data5 == "number" && isFinite(data5)) {
                          if (data5 < 0 || isNaN(data5)) {
                            validate51.errors = [
                              {
                                instancePath: instancePath + "/base_version",
                                schemaPath: "#/properties/base_version/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 0 },
                                message: "must be >= 0",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs13 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.local_payload_hash !== undefined) {
                        let data6 = data.local_payload_hash;
                        const _errs15 = errors;
                        const _errs16 = errors;
                        if (errors === _errs16) {
                          if (typeof data6 === "string") {
                            if (!pattern4.test(data6)) {
                              validate51.errors = [
                                {
                                  instancePath:
                                    instancePath + "/local_payload_hash",
                                  schemaPath: "#/$defs/hash/pattern",
                                  keyword: "pattern",
                                  params: { pattern: "^sha256:[a-f0-9]{64}$" },
                                  message:
                                    'must match pattern "' +
                                    "^sha256:[a-f0-9]{64}$" +
                                    '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate51.errors = [
                              {
                                instancePath:
                                  instancePath + "/local_payload_hash",
                                schemaPath: "#/$defs/hash/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs15 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.remote_version !== undefined) {
                          let data7 = data.remote_version;
                          const _errs18 = errors;
                          if (
                            !(
                              typeof data7 == "number" &&
                              !(data7 % 1) &&
                              !isNaN(data7) &&
                              isFinite(data7)
                            )
                          ) {
                            validate51.errors = [
                              {
                                instancePath: instancePath + "/remote_version",
                                schemaPath: "#/properties/remote_version/type",
                                keyword: "type",
                                params: { type: "integer" },
                                message: "must be integer",
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs18) {
                            if (typeof data7 == "number" && isFinite(data7)) {
                              if (data7 < 1 || isNaN(data7)) {
                                validate51.errors = [
                                  {
                                    instancePath:
                                      instancePath + "/remote_version",
                                    schemaPath:
                                      "#/properties/remote_version/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 1 },
                                    message: "must be >= 1",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid0 = _errs18 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.remote_payload !== undefined) {
                            let data8 = data.remote_payload;
                            const _errs20 = errors;
                            const _errs21 = errors;
                            if (errors === _errs21) {
                              if (
                                data8 &&
                                typeof data8 == "object" &&
                                !Array.isArray(data8)
                              ) {
                                if (Object.keys(data8).length > 200) {
                                  validate51.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/remote_payload",
                                      schemaPath:
                                        "#/$defs/payload/maxProperties",
                                      keyword: "maxProperties",
                                      params: { limit: 200 },
                                      message:
                                        "must NOT have more than 200 properties",
                                    },
                                  ];
                                  return false;
                                }
                              } else {
                                validate51.errors = [
                                  {
                                    instancePath:
                                      instancePath + "/remote_payload",
                                    schemaPath: "#/$defs/payload/type",
                                    keyword: "type",
                                    params: { type: "object" },
                                    message: "must be object",
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid0 = _errs20 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.remote_payload_hash !== undefined) {
                              let data9 = data.remote_payload_hash;
                              const _errs24 = errors;
                              const _errs25 = errors;
                              if (errors === _errs25) {
                                if (typeof data9 === "string") {
                                  if (!pattern4.test(data9)) {
                                    validate51.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/remote_payload_hash",
                                        schemaPath: "#/$defs/hash/pattern",
                                        keyword: "pattern",
                                        params: {
                                          pattern: "^sha256:[a-f0-9]{64}$",
                                        },
                                        message:
                                          'must match pattern "' +
                                          "^sha256:[a-f0-9]{64}$" +
                                          '"',
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate51.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/remote_payload_hash",
                                      schemaPath: "#/$defs/hash/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                      message: "must be string",
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs24 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.resolution_options !== undefined) {
                                let data10 = data.resolution_options;
                                const _errs27 = errors;
                                if (errors === _errs27) {
                                  if (Array.isArray(data10)) {
                                    if (data10.length < 1) {
                                      validate51.errors = [
                                        {
                                          instancePath:
                                            instancePath +
                                            "/resolution_options",
                                          schemaPath:
                                            "#/properties/resolution_options/minItems",
                                          keyword: "minItems",
                                          params: { limit: 1 },
                                          message:
                                            "must NOT have fewer than 1 items",
                                        },
                                      ];
                                      return false;
                                    } else {
                                      var valid7 = true;
                                      const len0 = data10.length;
                                      for (let i0 = 0; i0 < len0; i0++) {
                                        let data11 = data10[i0];
                                        const _errs29 = errors;
                                        if (
                                          !(
                                            data11 === "keep_local" ||
                                            data11 === "keep_remote" ||
                                            data11 === "merge" ||
                                            data11 === "dismiss"
                                          )
                                        ) {
                                          validate51.errors = [
                                            {
                                              instancePath:
                                                instancePath +
                                                "/resolution_options/" +
                                                i0,
                                              schemaPath:
                                                "#/properties/resolution_options/items/enum",
                                              keyword: "enum",
                                              params: {
                                                allowedValues:
                                                  schema97.properties
                                                    .resolution_options.items
                                                    .enum,
                                              },
                                              message:
                                                "must be equal to one of the allowed values",
                                            },
                                          ];
                                          return false;
                                        }
                                        var valid7 = _errs29 === errors;
                                        if (!valid7) {
                                          break;
                                        }
                                      }
                                      if (valid7) {
                                        let i1 = data10.length;
                                        let j0;
                                        if (i1 > 1) {
                                          outer0: for (; i1--; ) {
                                            for (j0 = i1; j0--; ) {
                                              if (
                                                func0(data10[i1], data10[j0])
                                              ) {
                                                validate51.errors = [
                                                  {
                                                    instancePath:
                                                      instancePath +
                                                      "/resolution_options",
                                                    schemaPath:
                                                      "#/properties/resolution_options/uniqueItems",
                                                    keyword: "uniqueItems",
                                                    params: { i: i1, j: j0 },
                                                    message:
                                                      "must NOT have duplicate items (items ## " +
                                                      j0 +
                                                      " and " +
                                                      i1 +
                                                      " are identical)",
                                                  },
                                                ];
                                                return false;
                                                break outer0;
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  } else {
                                    validate51.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/resolution_options",
                                        schemaPath:
                                          "#/properties/resolution_options/type",
                                        keyword: "type",
                                        params: { type: "array" },
                                        message: "must be array",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid0 = _errs27 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.created_at !== undefined) {
                                  let data12 = data.created_at;
                                  const _errs30 = errors;
                                  const _errs31 = errors;
                                  if (errors === _errs31) {
                                    if (errors === _errs31) {
                                      if (typeof data12 === "string") {
                                        if (!formats2.validate(data12)) {
                                          validate51.errors = [
                                            {
                                              instancePath:
                                                instancePath + "/created_at",
                                              schemaPath:
                                                "#/$defs/dateTime/format",
                                              keyword: "format",
                                              params: { format: "date-time" },
                                              message:
                                                'must match format "' +
                                                "date-time" +
                                                '"',
                                            },
                                          ];
                                          return false;
                                        }
                                      } else {
                                        validate51.errors = [
                                          {
                                            instancePath:
                                              instancePath + "/created_at",
                                            schemaPath: "#/$defs/dateTime/type",
                                            keyword: "type",
                                            params: { type: "string" },
                                            message: "must be string",
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                  }
                                  var valid0 = _errs30 === errors;
                                } else {
                                  var valid0 = true;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate51.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate51.errors = vErrors;
  return errors === 0;
}
validate51.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate50(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate50.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.operation_id === undefined && (missing0 = "operation_id")) ||
        (data.status === undefined && (missing0 = "status")) ||
        (data.retryable === undefined && (missing0 = "retryable")) ||
        (data.conflict === undefined && (missing0 = "conflict"))
      ) {
        validate50.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "operation_id" ||
              key0 === "status" ||
              key0 === "retryable" ||
              key0 === "conflict"
            )
          ) {
            validate50.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.operation_id !== undefined) {
            let data0 = data.operation_id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === "string") {
                  if (!formats0.test(data0)) {
                    validate50.errors = [
                      {
                        instancePath: instancePath + "/operation_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate50.errors = [
                    {
                      instancePath: instancePath + "/operation_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.status !== undefined) {
              const _errs5 = errors;
              if ("conflict" !== data.status) {
                validate50.errors = [
                  {
                    instancePath: instancePath + "/status",
                    schemaPath: "#/properties/status/const",
                    keyword: "const",
                    params: { allowedValue: "conflict" },
                    message: "must be equal to constant",
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.retryable !== undefined) {
                const _errs6 = errors;
                if (false !== data.retryable) {
                  validate50.errors = [
                    {
                      instancePath: instancePath + "/retryable",
                      schemaPath: "#/properties/retryable/const",
                      keyword: "const",
                      params: { allowedValue: false },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.conflict !== undefined) {
                  const _errs7 = errors;
                  if (
                    !validate51(data.conflict, {
                      instancePath: instancePath + "/conflict",
                      parentData: data,
                      parentDataProperty: "conflict",
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null
                        ? validate51.errors
                        : vErrors.concat(validate51.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate50.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate50.errors = vErrors;
  return errors === 0;
}
validate50.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema105 = {
  type: "object",
  additionalProperties: false,
  required: ["operation_id", "status", "retryable", "error_code"],
  properties: {
    operation_id: { $ref: "#/$defs/uuid" },
    status: { enum: ["rejected", "blocked_dependency"] },
    retryable: { type: "boolean" },
    error_code: { type: "string", pattern: "^SYNC_[A-Z0-9_]{2,80}$" },
  },
};
const pattern13 = new RegExp("^SYNC_[A-Z0-9_]{2,80}$", "u");
function validate54(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.operation_id === undefined && (missing0 = "operation_id")) ||
        (data.status === undefined && (missing0 = "status")) ||
        (data.retryable === undefined && (missing0 = "retryable")) ||
        (data.error_code === undefined && (missing0 = "error_code"))
      ) {
        validate54.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "operation_id" ||
              key0 === "status" ||
              key0 === "retryable" ||
              key0 === "error_code"
            )
          ) {
            validate54.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.operation_id !== undefined) {
            let data0 = data.operation_id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (errors === _errs3) {
                if (typeof data0 === "string") {
                  if (!formats0.test(data0)) {
                    validate54.errors = [
                      {
                        instancePath: instancePath + "/operation_id",
                        schemaPath: "#/$defs/uuid/format",
                        keyword: "format",
                        params: { format: "uuid" },
                        message: 'must match format "' + "uuid" + '"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate54.errors = [
                    {
                      instancePath: instancePath + "/operation_id",
                      schemaPath: "#/$defs/uuid/type",
                      keyword: "type",
                      params: { type: "string" },
                      message: "must be string",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.status !== undefined) {
              let data1 = data.status;
              const _errs5 = errors;
              if (!(data1 === "rejected" || data1 === "blocked_dependency")) {
                validate54.errors = [
                  {
                    instancePath: instancePath + "/status",
                    schemaPath: "#/properties/status/enum",
                    keyword: "enum",
                    params: { allowedValues: schema105.properties.status.enum },
                    message: "must be equal to one of the allowed values",
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.retryable !== undefined) {
                const _errs6 = errors;
                if (typeof data.retryable !== "boolean") {
                  validate54.errors = [
                    {
                      instancePath: instancePath + "/retryable",
                      schemaPath: "#/properties/retryable/type",
                      keyword: "type",
                      params: { type: "boolean" },
                      message: "must be boolean",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.error_code !== undefined) {
                  let data3 = data.error_code;
                  const _errs8 = errors;
                  if (errors === _errs8) {
                    if (typeof data3 === "string") {
                      if (!pattern13.test(data3)) {
                        validate54.errors = [
                          {
                            instancePath: instancePath + "/error_code",
                            schemaPath: "#/properties/error_code/pattern",
                            keyword: "pattern",
                            params: { pattern: "^SYNC_[A-Z0-9_]{2,80}$" },
                            message:
                              'must match pattern "' +
                              "^SYNC_[A-Z0-9_]{2,80}$" +
                              '"',
                          },
                        ];
                        return false;
                      }
                    } else {
                      validate54.errors = [
                        {
                          instancePath: instancePath + "/error_code",
                          schemaPath: "#/properties/error_code/type",
                          keyword: "type",
                          params: { type: "string" },
                          message: "must be string",
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs8 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate54.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate54.errors = vErrors;
  return errors === 0;
}
validate54.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate47(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate47.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (
    !validate48(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate48.errors : vErrors.concat(validate48.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (
    !validate50(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate50.errors : vErrors.concat(validate50.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (
      !validate54(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate54.errors
          : vErrors.concat(validate54.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
    }
  }
  if (!valid0) {
    const err0 = {
      instancePath,
      schemaPath: "#/oneOf",
      keyword: "oneOf",
      params: { passingSchemas: passing0 },
      message: "must match exactly one schema in oneOf",
    };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
    validate47.errors = vErrors;
    return false;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate47.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate47.evaluated = { dynamicProps: true, dynamicItems: false };
function validate44(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate44.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (
      !validate27(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate27.errors
          : vErrors.concat(validate27.errors);
      errors = vErrors.length;
    }
    var valid0 = _errs1 === errors;
    if (valid0) {
      const _errs2 = errors;
      if (errors === _errs2) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing0;
          if (
            (data.message_type === undefined && (missing0 = "message_type")) ||
            (data.protocol_version === undefined &&
              (missing0 = "protocol_version")) ||
            (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
            (data.device_id === undefined && (missing0 = "device_id")) ||
            (data.sync_epoch === undefined && (missing0 = "sync_epoch")) ||
            (data.results === undefined && (missing0 = "results"))
          ) {
            validate44.errors = [
              {
                instancePath,
                schemaPath: "#/allOf/2/required",
                keyword: "required",
                params: { missingProperty: missing0 },
                message: "must have required property '" + missing0 + "'",
              },
            ];
            return false;
          } else {
            const _errs4 = errors;
            for (const key0 in data) {
              if (
                !(
                  key0 === "message_type" ||
                  key0 === "protocol_version" ||
                  key0 === "workspace_id" ||
                  key0 === "device_id" ||
                  key0 === "sync_epoch" ||
                  key0 === "results"
                )
              ) {
                validate44.errors = [
                  {
                    instancePath,
                    schemaPath: "#/allOf/2/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: key0 },
                    message: "must NOT have additional properties",
                  },
                ];
                return false;
                break;
              }
            }
            if (_errs4 === errors) {
              if (data.message_type !== undefined) {
                const _errs5 = errors;
                if ("push_response" !== data.message_type) {
                  validate44.errors = [
                    {
                      instancePath: instancePath + "/message_type",
                      schemaPath: "#/allOf/2/properties/message_type/const",
                      keyword: "const",
                      params: { allowedValue: "push_response" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.protocol_version !== undefined) {
                  const _errs6 = errors;
                  if ("sync-v1" !== data.protocol_version) {
                    validate44.errors = [
                      {
                        instancePath: instancePath + "/protocol_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs6 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.workspace_id !== undefined) {
                    let data2 = data.workspace_id;
                    const _errs8 = errors;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (errors === _errs9) {
                        if (typeof data2 === "string") {
                          if (!formats0.test(data2)) {
                            validate44.errors = [
                              {
                                instancePath: instancePath + "/workspace_id",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate44.errors = [
                            {
                              instancePath: instancePath + "/workspace_id",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid1 = _errs8 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.device_id !== undefined) {
                      let data3 = data.device_id;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (errors === _errs12) {
                          if (typeof data3 === "string") {
                            if (!formats0.test(data3)) {
                              validate44.errors = [
                                {
                                  instancePath: instancePath + "/device_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate44.errors = [
                              {
                                instancePath: instancePath + "/device_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid1 = _errs11 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.sync_epoch !== undefined) {
                        let data4 = data.sync_epoch;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        if (errors === _errs15) {
                          if (errors === _errs15) {
                            if (typeof data4 === "string") {
                              if (!formats0.test(data4)) {
                                validate44.errors = [
                                  {
                                    instancePath: instancePath + "/sync_epoch",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate44.errors = [
                                {
                                  instancePath: instancePath + "/sync_epoch",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid1 = _errs14 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.results !== undefined) {
                          let data5 = data.results;
                          const _errs17 = errors;
                          if (errors === _errs17) {
                            if (Array.isArray(data5)) {
                              if (data5.length > 100) {
                                validate44.errors = [
                                  {
                                    instancePath: instancePath + "/results",
                                    schemaPath:
                                      "#/allOf/2/properties/results/maxItems",
                                    keyword: "maxItems",
                                    params: { limit: 100 },
                                    message:
                                      "must NOT have more than 100 items",
                                  },
                                ];
                                return false;
                              } else {
                                if (data5.length < 1) {
                                  validate44.errors = [
                                    {
                                      instancePath: instancePath + "/results",
                                      schemaPath:
                                        "#/allOf/2/properties/results/minItems",
                                      keyword: "minItems",
                                      params: { limit: 1 },
                                      message:
                                        "must NOT have fewer than 1 items",
                                    },
                                  ];
                                  return false;
                                } else {
                                  var valid6 = true;
                                  const len0 = data5.length;
                                  for (let i0 = 0; i0 < len0; i0++) {
                                    const _errs19 = errors;
                                    if (
                                      !validate47(data5[i0], {
                                        instancePath:
                                          instancePath + "/results/" + i0,
                                        parentData: data5,
                                        parentDataProperty: i0,
                                        rootData,
                                        dynamicAnchors,
                                      })
                                    ) {
                                      vErrors =
                                        vErrors === null
                                          ? validate47.errors
                                          : vErrors.concat(validate47.errors);
                                      errors = vErrors.length;
                                    }
                                    var valid6 = _errs19 === errors;
                                    if (!valid6) {
                                      break;
                                    }
                                  }
                                }
                              }
                            } else {
                              validate44.errors = [
                                {
                                  instancePath: instancePath + "/results",
                                  schemaPath:
                                    "#/allOf/2/properties/results/type",
                                  keyword: "type",
                                  params: { type: "array" },
                                  message: "must be array",
                                },
                              ];
                              return false;
                            }
                          }
                          var valid1 = _errs17 === errors;
                        } else {
                          var valid1 = true;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          validate44.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/2/type",
              keyword: "type",
              params: { type: "object" },
              message: "must be object",
            },
          ];
          return false;
        }
      }
      var valid0 = _errs2 === errors;
    }
  }
  validate44.errors = vErrors;
  return errors === 0;
}
validate44.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema107 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    { $ref: "#/$defs/workspaceDevice" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "workspace_id",
        "device_id",
        "sync_epoch",
        "cursor",
        "limit",
      ],
      properties: {
        message_type: { const: "pull_request" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        sync_epoch: { $ref: "#/$defs/uuid" },
        cursor: { $ref: "#/$defs/cursor" },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
      },
    },
  ],
};
function validate58(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate58.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (
      !validate27(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate27.errors
          : vErrors.concat(validate27.errors);
      errors = vErrors.length;
    }
    var valid0 = _errs1 === errors;
    if (valid0) {
      const _errs2 = errors;
      if (errors === _errs2) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing0;
          if (
            (data.message_type === undefined && (missing0 = "message_type")) ||
            (data.protocol_version === undefined &&
              (missing0 = "protocol_version")) ||
            (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
            (data.device_id === undefined && (missing0 = "device_id")) ||
            (data.sync_epoch === undefined && (missing0 = "sync_epoch")) ||
            (data.cursor === undefined && (missing0 = "cursor")) ||
            (data.limit === undefined && (missing0 = "limit"))
          ) {
            validate58.errors = [
              {
                instancePath,
                schemaPath: "#/allOf/2/required",
                keyword: "required",
                params: { missingProperty: missing0 },
                message: "must have required property '" + missing0 + "'",
              },
            ];
            return false;
          } else {
            const _errs4 = errors;
            for (const key0 in data) {
              if (
                !(
                  key0 === "message_type" ||
                  key0 === "protocol_version" ||
                  key0 === "workspace_id" ||
                  key0 === "device_id" ||
                  key0 === "sync_epoch" ||
                  key0 === "cursor" ||
                  key0 === "limit"
                )
              ) {
                validate58.errors = [
                  {
                    instancePath,
                    schemaPath: "#/allOf/2/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: key0 },
                    message: "must NOT have additional properties",
                  },
                ];
                return false;
                break;
              }
            }
            if (_errs4 === errors) {
              if (data.message_type !== undefined) {
                const _errs5 = errors;
                if ("pull_request" !== data.message_type) {
                  validate58.errors = [
                    {
                      instancePath: instancePath + "/message_type",
                      schemaPath: "#/allOf/2/properties/message_type/const",
                      keyword: "const",
                      params: { allowedValue: "pull_request" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.protocol_version !== undefined) {
                  const _errs6 = errors;
                  if ("sync-v1" !== data.protocol_version) {
                    validate58.errors = [
                      {
                        instancePath: instancePath + "/protocol_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs6 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.workspace_id !== undefined) {
                    let data2 = data.workspace_id;
                    const _errs8 = errors;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (errors === _errs9) {
                        if (typeof data2 === "string") {
                          if (!formats0.test(data2)) {
                            validate58.errors = [
                              {
                                instancePath: instancePath + "/workspace_id",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate58.errors = [
                            {
                              instancePath: instancePath + "/workspace_id",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid1 = _errs8 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.device_id !== undefined) {
                      let data3 = data.device_id;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (errors === _errs12) {
                          if (typeof data3 === "string") {
                            if (!formats0.test(data3)) {
                              validate58.errors = [
                                {
                                  instancePath: instancePath + "/device_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate58.errors = [
                              {
                                instancePath: instancePath + "/device_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid1 = _errs11 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.sync_epoch !== undefined) {
                        let data4 = data.sync_epoch;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        if (errors === _errs15) {
                          if (errors === _errs15) {
                            if (typeof data4 === "string") {
                              if (!formats0.test(data4)) {
                                validate58.errors = [
                                  {
                                    instancePath: instancePath + "/sync_epoch",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate58.errors = [
                                {
                                  instancePath: instancePath + "/sync_epoch",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid1 = _errs14 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.cursor !== undefined) {
                          let data5 = data.cursor;
                          const _errs17 = errors;
                          const _errs18 = errors;
                          if (
                            !(
                              typeof data5 == "number" &&
                              !(data5 % 1) &&
                              !isNaN(data5) &&
                              isFinite(data5)
                            )
                          ) {
                            validate58.errors = [
                              {
                                instancePath: instancePath + "/cursor",
                                schemaPath: "#/$defs/cursor/type",
                                keyword: "type",
                                params: { type: "integer" },
                                message: "must be integer",
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs18) {
                            if (typeof data5 == "number" && isFinite(data5)) {
                              if (data5 < 0 || isNaN(data5)) {
                                validate58.errors = [
                                  {
                                    instancePath: instancePath + "/cursor",
                                    schemaPath: "#/$defs/cursor/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 0 },
                                    message: "must be >= 0",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid1 = _errs17 === errors;
                        } else {
                          var valid1 = true;
                        }
                        if (valid1) {
                          if (data.limit !== undefined) {
                            let data6 = data.limit;
                            const _errs20 = errors;
                            if (
                              !(
                                typeof data6 == "number" &&
                                !(data6 % 1) &&
                                !isNaN(data6) &&
                                isFinite(data6)
                              )
                            ) {
                              validate58.errors = [
                                {
                                  instancePath: instancePath + "/limit",
                                  schemaPath: "#/allOf/2/properties/limit/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                  message: "must be integer",
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs20) {
                              if (typeof data6 == "number" && isFinite(data6)) {
                                if (data6 > 1000 || isNaN(data6)) {
                                  validate58.errors = [
                                    {
                                      instancePath: instancePath + "/limit",
                                      schemaPath:
                                        "#/allOf/2/properties/limit/maximum",
                                      keyword: "maximum",
                                      params: { comparison: "<=", limit: 1000 },
                                      message: "must be <= 1000",
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (data6 < 1 || isNaN(data6)) {
                                    validate58.errors = [
                                      {
                                        instancePath: instancePath + "/limit",
                                        schemaPath:
                                          "#/allOf/2/properties/limit/minimum",
                                        keyword: "minimum",
                                        params: { comparison: ">=", limit: 1 },
                                        message: "must be >= 1",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              }
                            }
                            var valid1 = _errs20 === errors;
                          } else {
                            var valid1 = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          validate58.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/2/type",
              keyword: "type",
              params: { type: "object" },
              message: "must be object",
            },
          ];
          return false;
        }
      }
      var valid0 = _errs2 === errors;
    }
  }
  validate58.errors = vErrors;
  return errors === 0;
}
validate58.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema113 = {
  allOf: [
    { $ref: "#/$defs/baseMessage" },
    { $ref: "#/$defs/workspaceDevice" },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "message_type",
        "protocol_version",
        "workspace_id",
        "device_id",
        "sync_epoch",
        "from_cursor",
        "next_cursor",
        "has_more",
        "changes",
      ],
      properties: {
        message_type: { const: "pull_response" },
        protocol_version: { $ref: "#/$defs/protocolVersion" },
        workspace_id: { $ref: "#/$defs/uuid" },
        device_id: { $ref: "#/$defs/uuid" },
        sync_epoch: { $ref: "#/$defs/uuid" },
        from_cursor: { $ref: "#/$defs/cursor" },
        next_cursor: { $ref: "#/$defs/cursor" },
        has_more: { type: "boolean" },
        changes: {
          type: "array",
          maxItems: 1000,
          items: { $ref: "#/$defs/change" },
        },
      },
    },
  ],
};
const schema120 = {
  oneOf: [{ $ref: "#/$defs/liveChange" }, { $ref: "#/$defs/tombstoneChange" }],
};
const schema121 = {
  type: "object",
  additionalProperties: false,
  required: [
    "sequence",
    "operation_id",
    "entity_type",
    "entity_id",
    "operation_type",
    "server_version",
    "occurred_at",
    "tombstone",
    "deleted_at",
    "payload",
    "payload_hash",
  ],
  properties: {
    sequence: { type: "integer", minimum: 1 },
    operation_id: { $ref: "#/$defs/uuid" },
    entity_type: { $ref: "#/$defs/entityType" },
    entity_id: { $ref: "#/$defs/uuid" },
    operation_type: { enum: ["create", "update", "restore"] },
    server_version: { type: "integer", minimum: 1 },
    occurred_at: { $ref: "#/$defs/dateTime" },
    tombstone: { const: false },
    deleted_at: { type: "null" },
    payload: { $ref: "#/$defs/payload" },
    payload_hash: { $ref: "#/$defs/hash" },
  },
};
function validate66(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate66.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.sequence === undefined && (missing0 = "sequence")) ||
        (data.operation_id === undefined && (missing0 = "operation_id")) ||
        (data.entity_type === undefined && (missing0 = "entity_type")) ||
        (data.entity_id === undefined && (missing0 = "entity_id")) ||
        (data.operation_type === undefined && (missing0 = "operation_type")) ||
        (data.server_version === undefined && (missing0 = "server_version")) ||
        (data.occurred_at === undefined && (missing0 = "occurred_at")) ||
        (data.tombstone === undefined && (missing0 = "tombstone")) ||
        (data.deleted_at === undefined && (missing0 = "deleted_at")) ||
        (data.payload === undefined && (missing0 = "payload")) ||
        (data.payload_hash === undefined && (missing0 = "payload_hash"))
      ) {
        validate66.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema121.properties, key0)) {
            validate66.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.sequence !== undefined) {
            let data0 = data.sequence;
            const _errs2 = errors;
            if (
              !(
                typeof data0 == "number" &&
                !(data0 % 1) &&
                !isNaN(data0) &&
                isFinite(data0)
              )
            ) {
              validate66.errors = [
                {
                  instancePath: instancePath + "/sequence",
                  schemaPath: "#/properties/sequence/type",
                  keyword: "type",
                  params: { type: "integer" },
                  message: "must be integer",
                },
              ];
              return false;
            }
            if (errors === _errs2) {
              if (typeof data0 == "number" && isFinite(data0)) {
                if (data0 < 1 || isNaN(data0)) {
                  validate66.errors = [
                    {
                      instancePath: instancePath + "/sequence",
                      schemaPath: "#/properties/sequence/minimum",
                      keyword: "minimum",
                      params: { comparison: ">=", limit: 1 },
                      message: "must be >= 1",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.operation_id !== undefined) {
              let data1 = data.operation_id;
              const _errs4 = errors;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (errors === _errs5) {
                  if (typeof data1 === "string") {
                    if (!formats0.test(data1)) {
                      validate66.errors = [
                        {
                          instancePath: instancePath + "/operation_id",
                          schemaPath: "#/$defs/uuid/format",
                          keyword: "format",
                          params: { format: "uuid" },
                          message: 'must match format "' + "uuid" + '"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate66.errors = [
                      {
                        instancePath: instancePath + "/operation_id",
                        schemaPath: "#/$defs/uuid/type",
                        keyword: "type",
                        params: { type: "string" },
                        message: "must be string",
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.entity_type !== undefined) {
                let data2 = data.entity_type;
                const _errs7 = errors;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === "string") {
                    if (!pattern6.test(data2)) {
                      validate66.errors = [
                        {
                          instancePath: instancePath + "/entity_type",
                          schemaPath: "#/$defs/entityType/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[a-z][a-z0-9_]{1,63}$" },
                          message:
                            'must match pattern "' +
                            "^[a-z][a-z0-9_]{1,63}$" +
                            '"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate66.errors = [
                      {
                        instancePath: instancePath + "/entity_type",
                        schemaPath: "#/$defs/entityType/type",
                        keyword: "type",
                        params: { type: "string" },
                        message: "must be string",
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.entity_id !== undefined) {
                  let data3 = data.entity_id;
                  const _errs10 = errors;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (errors === _errs11) {
                      if (typeof data3 === "string") {
                        if (!formats0.test(data3)) {
                          validate66.errors = [
                            {
                              instancePath: instancePath + "/entity_id",
                              schemaPath: "#/$defs/uuid/format",
                              keyword: "format",
                              params: { format: "uuid" },
                              message: 'must match format "' + "uuid" + '"',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate66.errors = [
                          {
                            instancePath: instancePath + "/entity_id",
                            schemaPath: "#/$defs/uuid/type",
                            keyword: "type",
                            params: { type: "string" },
                            message: "must be string",
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.operation_type !== undefined) {
                    let data4 = data.operation_type;
                    const _errs13 = errors;
                    if (
                      !(
                        data4 === "create" ||
                        data4 === "update" ||
                        data4 === "restore"
                      )
                    ) {
                      validate66.errors = [
                        {
                          instancePath: instancePath + "/operation_type",
                          schemaPath: "#/properties/operation_type/enum",
                          keyword: "enum",
                          params: {
                            allowedValues:
                              schema121.properties.operation_type.enum,
                          },
                          message: "must be equal to one of the allowed values",
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs13 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.server_version !== undefined) {
                      let data5 = data.server_version;
                      const _errs14 = errors;
                      if (
                        !(
                          typeof data5 == "number" &&
                          !(data5 % 1) &&
                          !isNaN(data5) &&
                          isFinite(data5)
                        )
                      ) {
                        validate66.errors = [
                          {
                            instancePath: instancePath + "/server_version",
                            schemaPath: "#/properties/server_version/type",
                            keyword: "type",
                            params: { type: "integer" },
                            message: "must be integer",
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs14) {
                        if (typeof data5 == "number" && isFinite(data5)) {
                          if (data5 < 1 || isNaN(data5)) {
                            validate66.errors = [
                              {
                                instancePath: instancePath + "/server_version",
                                schemaPath:
                                  "#/properties/server_version/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 1 },
                                message: "must be >= 1",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.occurred_at !== undefined) {
                        let data6 = data.occurred_at;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        if (errors === _errs17) {
                          if (errors === _errs17) {
                            if (typeof data6 === "string") {
                              if (!formats2.validate(data6)) {
                                validate66.errors = [
                                  {
                                    instancePath: instancePath + "/occurred_at",
                                    schemaPath: "#/$defs/dateTime/format",
                                    keyword: "format",
                                    params: { format: "date-time" },
                                    message:
                                      'must match format "' + "date-time" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate66.errors = [
                                {
                                  instancePath: instancePath + "/occurred_at",
                                  schemaPath: "#/$defs/dateTime/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid0 = _errs16 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.tombstone !== undefined) {
                          const _errs19 = errors;
                          if (false !== data.tombstone) {
                            validate66.errors = [
                              {
                                instancePath: instancePath + "/tombstone",
                                schemaPath: "#/properties/tombstone/const",
                                keyword: "const",
                                params: { allowedValue: false },
                                message: "must be equal to constant",
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs19 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.deleted_at !== undefined) {
                            const _errs20 = errors;
                            if (data.deleted_at !== null) {
                              validate66.errors = [
                                {
                                  instancePath: instancePath + "/deleted_at",
                                  schemaPath: "#/properties/deleted_at/type",
                                  keyword: "type",
                                  params: { type: "null" },
                                  message: "must be null",
                                },
                              ];
                              return false;
                            }
                            var valid0 = _errs20 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.payload !== undefined) {
                              let data9 = data.payload;
                              const _errs22 = errors;
                              const _errs23 = errors;
                              if (errors === _errs23) {
                                if (
                                  data9 &&
                                  typeof data9 == "object" &&
                                  !Array.isArray(data9)
                                ) {
                                  if (Object.keys(data9).length > 200) {
                                    validate66.errors = [
                                      {
                                        instancePath: instancePath + "/payload",
                                        schemaPath:
                                          "#/$defs/payload/maxProperties",
                                        keyword: "maxProperties",
                                        params: { limit: 200 },
                                        message:
                                          "must NOT have more than 200 properties",
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate66.errors = [
                                    {
                                      instancePath: instancePath + "/payload",
                                      schemaPath: "#/$defs/payload/type",
                                      keyword: "type",
                                      params: { type: "object" },
                                      message: "must be object",
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs22 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.payload_hash !== undefined) {
                                let data10 = data.payload_hash;
                                const _errs26 = errors;
                                const _errs27 = errors;
                                if (errors === _errs27) {
                                  if (typeof data10 === "string") {
                                    if (!pattern4.test(data10)) {
                                      validate66.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/payload_hash",
                                          schemaPath: "#/$defs/hash/pattern",
                                          keyword: "pattern",
                                          params: {
                                            pattern: "^sha256:[a-f0-9]{64}$",
                                          },
                                          message:
                                            'must match pattern "' +
                                            "^sha256:[a-f0-9]{64}$" +
                                            '"',
                                        },
                                      ];
                                      return false;
                                    }
                                  } else {
                                    validate66.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/payload_hash",
                                        schemaPath: "#/$defs/hash/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                        message: "must be string",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid0 = _errs26 === errors;
                              } else {
                                var valid0 = true;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate66.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate66.errors = vErrors;
  return errors === 0;
}
validate66.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema128 = {
  type: "object",
  additionalProperties: false,
  required: [
    "sequence",
    "operation_id",
    "entity_type",
    "entity_id",
    "operation_type",
    "server_version",
    "occurred_at",
    "tombstone",
    "deleted_at",
    "payload",
    "payload_hash",
  ],
  properties: {
    sequence: { type: "integer", minimum: 1 },
    operation_id: { $ref: "#/$defs/uuid" },
    entity_type: { $ref: "#/$defs/entityType" },
    entity_id: { $ref: "#/$defs/uuid" },
    operation_type: { const: "delete" },
    server_version: { type: "integer", minimum: 1 },
    occurred_at: { $ref: "#/$defs/dateTime" },
    tombstone: { const: true },
    deleted_at: { $ref: "#/$defs/dateTime" },
    payload: { type: "object", maxProperties: 0 },
    payload_hash: { $ref: "#/$defs/hash" },
  },
};
function validate68(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate68.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.sequence === undefined && (missing0 = "sequence")) ||
        (data.operation_id === undefined && (missing0 = "operation_id")) ||
        (data.entity_type === undefined && (missing0 = "entity_type")) ||
        (data.entity_id === undefined && (missing0 = "entity_id")) ||
        (data.operation_type === undefined && (missing0 = "operation_type")) ||
        (data.server_version === undefined && (missing0 = "server_version")) ||
        (data.occurred_at === undefined && (missing0 = "occurred_at")) ||
        (data.tombstone === undefined && (missing0 = "tombstone")) ||
        (data.deleted_at === undefined && (missing0 = "deleted_at")) ||
        (data.payload === undefined && (missing0 = "payload")) ||
        (data.payload_hash === undefined && (missing0 = "payload_hash"))
      ) {
        validate68.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (!func1.call(schema128.properties, key0)) {
            validate68.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.sequence !== undefined) {
            let data0 = data.sequence;
            const _errs2 = errors;
            if (
              !(
                typeof data0 == "number" &&
                !(data0 % 1) &&
                !isNaN(data0) &&
                isFinite(data0)
              )
            ) {
              validate68.errors = [
                {
                  instancePath: instancePath + "/sequence",
                  schemaPath: "#/properties/sequence/type",
                  keyword: "type",
                  params: { type: "integer" },
                  message: "must be integer",
                },
              ];
              return false;
            }
            if (errors === _errs2) {
              if (typeof data0 == "number" && isFinite(data0)) {
                if (data0 < 1 || isNaN(data0)) {
                  validate68.errors = [
                    {
                      instancePath: instancePath + "/sequence",
                      schemaPath: "#/properties/sequence/minimum",
                      keyword: "minimum",
                      params: { comparison: ">=", limit: 1 },
                      message: "must be >= 1",
                    },
                  ];
                  return false;
                }
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.operation_id !== undefined) {
              let data1 = data.operation_id;
              const _errs4 = errors;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (errors === _errs5) {
                  if (typeof data1 === "string") {
                    if (!formats0.test(data1)) {
                      validate68.errors = [
                        {
                          instancePath: instancePath + "/operation_id",
                          schemaPath: "#/$defs/uuid/format",
                          keyword: "format",
                          params: { format: "uuid" },
                          message: 'must match format "' + "uuid" + '"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate68.errors = [
                      {
                        instancePath: instancePath + "/operation_id",
                        schemaPath: "#/$defs/uuid/type",
                        keyword: "type",
                        params: { type: "string" },
                        message: "must be string",
                      },
                    ];
                    return false;
                  }
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.entity_type !== undefined) {
                let data2 = data.entity_type;
                const _errs7 = errors;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === "string") {
                    if (!pattern6.test(data2)) {
                      validate68.errors = [
                        {
                          instancePath: instancePath + "/entity_type",
                          schemaPath: "#/$defs/entityType/pattern",
                          keyword: "pattern",
                          params: { pattern: "^[a-z][a-z0-9_]{1,63}$" },
                          message:
                            'must match pattern "' +
                            "^[a-z][a-z0-9_]{1,63}$" +
                            '"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate68.errors = [
                      {
                        instancePath: instancePath + "/entity_type",
                        schemaPath: "#/$defs/entityType/type",
                        keyword: "type",
                        params: { type: "string" },
                        message: "must be string",
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.entity_id !== undefined) {
                  let data3 = data.entity_id;
                  const _errs10 = errors;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (errors === _errs11) {
                      if (typeof data3 === "string") {
                        if (!formats0.test(data3)) {
                          validate68.errors = [
                            {
                              instancePath: instancePath + "/entity_id",
                              schemaPath: "#/$defs/uuid/format",
                              keyword: "format",
                              params: { format: "uuid" },
                              message: 'must match format "' + "uuid" + '"',
                            },
                          ];
                          return false;
                        }
                      } else {
                        validate68.errors = [
                          {
                            instancePath: instancePath + "/entity_id",
                            schemaPath: "#/$defs/uuid/type",
                            keyword: "type",
                            params: { type: "string" },
                            message: "must be string",
                          },
                        ];
                        return false;
                      }
                    }
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.operation_type !== undefined) {
                    const _errs13 = errors;
                    if ("delete" !== data.operation_type) {
                      validate68.errors = [
                        {
                          instancePath: instancePath + "/operation_type",
                          schemaPath: "#/properties/operation_type/const",
                          keyword: "const",
                          params: { allowedValue: "delete" },
                          message: "must be equal to constant",
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs13 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.server_version !== undefined) {
                      let data5 = data.server_version;
                      const _errs14 = errors;
                      if (
                        !(
                          typeof data5 == "number" &&
                          !(data5 % 1) &&
                          !isNaN(data5) &&
                          isFinite(data5)
                        )
                      ) {
                        validate68.errors = [
                          {
                            instancePath: instancePath + "/server_version",
                            schemaPath: "#/properties/server_version/type",
                            keyword: "type",
                            params: { type: "integer" },
                            message: "must be integer",
                          },
                        ];
                        return false;
                      }
                      if (errors === _errs14) {
                        if (typeof data5 == "number" && isFinite(data5)) {
                          if (data5 < 1 || isNaN(data5)) {
                            validate68.errors = [
                              {
                                instancePath: instancePath + "/server_version",
                                schemaPath:
                                  "#/properties/server_version/minimum",
                                keyword: "minimum",
                                params: { comparison: ">=", limit: 1 },
                                message: "must be >= 1",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs14 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.occurred_at !== undefined) {
                        let data6 = data.occurred_at;
                        const _errs16 = errors;
                        const _errs17 = errors;
                        if (errors === _errs17) {
                          if (errors === _errs17) {
                            if (typeof data6 === "string") {
                              if (!formats2.validate(data6)) {
                                validate68.errors = [
                                  {
                                    instancePath: instancePath + "/occurred_at",
                                    schemaPath: "#/$defs/dateTime/format",
                                    keyword: "format",
                                    params: { format: "date-time" },
                                    message:
                                      'must match format "' + "date-time" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate68.errors = [
                                {
                                  instancePath: instancePath + "/occurred_at",
                                  schemaPath: "#/$defs/dateTime/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid0 = _errs16 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.tombstone !== undefined) {
                          const _errs19 = errors;
                          if (true !== data.tombstone) {
                            validate68.errors = [
                              {
                                instancePath: instancePath + "/tombstone",
                                schemaPath: "#/properties/tombstone/const",
                                keyword: "const",
                                params: { allowedValue: true },
                                message: "must be equal to constant",
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs19 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.deleted_at !== undefined) {
                            let data8 = data.deleted_at;
                            const _errs20 = errors;
                            const _errs21 = errors;
                            if (errors === _errs21) {
                              if (errors === _errs21) {
                                if (typeof data8 === "string") {
                                  if (!formats2.validate(data8)) {
                                    validate68.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/deleted_at",
                                        schemaPath: "#/$defs/dateTime/format",
                                        keyword: "format",
                                        params: { format: "date-time" },
                                        message:
                                          'must match format "' +
                                          "date-time" +
                                          '"',
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate68.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/deleted_at",
                                      schemaPath: "#/$defs/dateTime/type",
                                      keyword: "type",
                                      params: { type: "string" },
                                      message: "must be string",
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid0 = _errs20 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.payload !== undefined) {
                              let data9 = data.payload;
                              const _errs23 = errors;
                              if (errors === _errs23) {
                                if (
                                  data9 &&
                                  typeof data9 == "object" &&
                                  !Array.isArray(data9)
                                ) {
                                  if (Object.keys(data9).length > 0) {
                                    validate68.errors = [
                                      {
                                        instancePath: instancePath + "/payload",
                                        schemaPath:
                                          "#/properties/payload/maxProperties",
                                        keyword: "maxProperties",
                                        params: { limit: 0 },
                                        message:
                                          "must NOT have more than 0 properties",
                                      },
                                    ];
                                    return false;
                                  }
                                } else {
                                  validate68.errors = [
                                    {
                                      instancePath: instancePath + "/payload",
                                      schemaPath: "#/properties/payload/type",
                                      keyword: "type",
                                      params: { type: "object" },
                                      message: "must be object",
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs23 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.payload_hash !== undefined) {
                                let data10 = data.payload_hash;
                                const _errs25 = errors;
                                const _errs26 = errors;
                                if (errors === _errs26) {
                                  if (typeof data10 === "string") {
                                    if (!pattern4.test(data10)) {
                                      validate68.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/payload_hash",
                                          schemaPath: "#/$defs/hash/pattern",
                                          keyword: "pattern",
                                          params: {
                                            pattern: "^sha256:[a-f0-9]{64}$",
                                          },
                                          message:
                                            'must match pattern "' +
                                            "^sha256:[a-f0-9]{64}$" +
                                            '"',
                                        },
                                      ];
                                      return false;
                                    }
                                  } else {
                                    validate68.errors = [
                                      {
                                        instancePath:
                                          instancePath + "/payload_hash",
                                        schemaPath: "#/$defs/hash/type",
                                        keyword: "type",
                                        params: { type: "string" },
                                        message: "must be string",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid0 = _errs25 === errors;
                              } else {
                                var valid0 = true;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate68.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate68.errors = vErrors;
  return errors === 0;
}
validate68.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate65(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate65.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (
    !validate66(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (
    !validate68(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
  }
  if (!valid0) {
    const err0 = {
      instancePath,
      schemaPath: "#/oneOf",
      keyword: "oneOf",
      params: { passingSchemas: passing0 },
      message: "must match exactly one schema in oneOf",
    };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
    validate65.errors = vErrors;
    return false;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate65.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate65.evaluated = { dynamicProps: true, dynamicItems: false };
function validate62(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate62.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  if (
    !validate22(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
    errors = vErrors.length;
  }
  var valid0 = _errs0 === errors;
  if (valid0) {
    const _errs1 = errors;
    if (
      !validate27(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate27.errors
          : vErrors.concat(validate27.errors);
      errors = vErrors.length;
    }
    var valid0 = _errs1 === errors;
    if (valid0) {
      const _errs2 = errors;
      if (errors === _errs2) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          let missing0;
          if (
            (data.message_type === undefined && (missing0 = "message_type")) ||
            (data.protocol_version === undefined &&
              (missing0 = "protocol_version")) ||
            (data.workspace_id === undefined && (missing0 = "workspace_id")) ||
            (data.device_id === undefined && (missing0 = "device_id")) ||
            (data.sync_epoch === undefined && (missing0 = "sync_epoch")) ||
            (data.from_cursor === undefined && (missing0 = "from_cursor")) ||
            (data.next_cursor === undefined && (missing0 = "next_cursor")) ||
            (data.has_more === undefined && (missing0 = "has_more")) ||
            (data.changes === undefined && (missing0 = "changes"))
          ) {
            validate62.errors = [
              {
                instancePath,
                schemaPath: "#/allOf/2/required",
                keyword: "required",
                params: { missingProperty: missing0 },
                message: "must have required property '" + missing0 + "'",
              },
            ];
            return false;
          } else {
            const _errs4 = errors;
            for (const key0 in data) {
              if (!func1.call(schema113.allOf[2].properties, key0)) {
                validate62.errors = [
                  {
                    instancePath,
                    schemaPath: "#/allOf/2/additionalProperties",
                    keyword: "additionalProperties",
                    params: { additionalProperty: key0 },
                    message: "must NOT have additional properties",
                  },
                ];
                return false;
                break;
              }
            }
            if (_errs4 === errors) {
              if (data.message_type !== undefined) {
                const _errs5 = errors;
                if ("pull_response" !== data.message_type) {
                  validate62.errors = [
                    {
                      instancePath: instancePath + "/message_type",
                      schemaPath: "#/allOf/2/properties/message_type/const",
                      keyword: "const",
                      params: { allowedValue: "pull_response" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid1 = _errs5 === errors;
              } else {
                var valid1 = true;
              }
              if (valid1) {
                if (data.protocol_version !== undefined) {
                  const _errs6 = errors;
                  if ("sync-v1" !== data.protocol_version) {
                    validate62.errors = [
                      {
                        instancePath: instancePath + "/protocol_version",
                        schemaPath: "#/$defs/protocolVersion/const",
                        keyword: "const",
                        params: { allowedValue: "sync-v1" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid1 = _errs6 === errors;
                } else {
                  var valid1 = true;
                }
                if (valid1) {
                  if (data.workspace_id !== undefined) {
                    let data2 = data.workspace_id;
                    const _errs8 = errors;
                    const _errs9 = errors;
                    if (errors === _errs9) {
                      if (errors === _errs9) {
                        if (typeof data2 === "string") {
                          if (!formats0.test(data2)) {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/workspace_id",
                                schemaPath: "#/$defs/uuid/format",
                                keyword: "format",
                                params: { format: "uuid" },
                                message: 'must match format "' + "uuid" + '"',
                              },
                            ];
                            return false;
                          }
                        } else {
                          validate62.errors = [
                            {
                              instancePath: instancePath + "/workspace_id",
                              schemaPath: "#/$defs/uuid/type",
                              keyword: "type",
                              params: { type: "string" },
                              message: "must be string",
                            },
                          ];
                          return false;
                        }
                      }
                    }
                    var valid1 = _errs8 === errors;
                  } else {
                    var valid1 = true;
                  }
                  if (valid1) {
                    if (data.device_id !== undefined) {
                      let data3 = data.device_id;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (errors === _errs12) {
                          if (typeof data3 === "string") {
                            if (!formats0.test(data3)) {
                              validate62.errors = [
                                {
                                  instancePath: instancePath + "/device_id",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/device_id",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid1 = _errs11 === errors;
                    } else {
                      var valid1 = true;
                    }
                    if (valid1) {
                      if (data.sync_epoch !== undefined) {
                        let data4 = data.sync_epoch;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        if (errors === _errs15) {
                          if (errors === _errs15) {
                            if (typeof data4 === "string") {
                              if (!formats0.test(data4)) {
                                validate62.errors = [
                                  {
                                    instancePath: instancePath + "/sync_epoch",
                                    schemaPath: "#/$defs/uuid/format",
                                    keyword: "format",
                                    params: { format: "uuid" },
                                    message:
                                      'must match format "' + "uuid" + '"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate62.errors = [
                                {
                                  instancePath: instancePath + "/sync_epoch",
                                  schemaPath: "#/$defs/uuid/type",
                                  keyword: "type",
                                  params: { type: "string" },
                                  message: "must be string",
                                },
                              ];
                              return false;
                            }
                          }
                        }
                        var valid1 = _errs14 === errors;
                      } else {
                        var valid1 = true;
                      }
                      if (valid1) {
                        if (data.from_cursor !== undefined) {
                          let data5 = data.from_cursor;
                          const _errs17 = errors;
                          const _errs18 = errors;
                          if (
                            !(
                              typeof data5 == "number" &&
                              !(data5 % 1) &&
                              !isNaN(data5) &&
                              isFinite(data5)
                            )
                          ) {
                            validate62.errors = [
                              {
                                instancePath: instancePath + "/from_cursor",
                                schemaPath: "#/$defs/cursor/type",
                                keyword: "type",
                                params: { type: "integer" },
                                message: "must be integer",
                              },
                            ];
                            return false;
                          }
                          if (errors === _errs18) {
                            if (typeof data5 == "number" && isFinite(data5)) {
                              if (data5 < 0 || isNaN(data5)) {
                                validate62.errors = [
                                  {
                                    instancePath: instancePath + "/from_cursor",
                                    schemaPath: "#/$defs/cursor/minimum",
                                    keyword: "minimum",
                                    params: { comparison: ">=", limit: 0 },
                                    message: "must be >= 0",
                                  },
                                ];
                                return false;
                              }
                            }
                          }
                          var valid1 = _errs17 === errors;
                        } else {
                          var valid1 = true;
                        }
                        if (valid1) {
                          if (data.next_cursor !== undefined) {
                            let data6 = data.next_cursor;
                            const _errs20 = errors;
                            const _errs21 = errors;
                            if (
                              !(
                                typeof data6 == "number" &&
                                !(data6 % 1) &&
                                !isNaN(data6) &&
                                isFinite(data6)
                              )
                            ) {
                              validate62.errors = [
                                {
                                  instancePath: instancePath + "/next_cursor",
                                  schemaPath: "#/$defs/cursor/type",
                                  keyword: "type",
                                  params: { type: "integer" },
                                  message: "must be integer",
                                },
                              ];
                              return false;
                            }
                            if (errors === _errs21) {
                              if (typeof data6 == "number" && isFinite(data6)) {
                                if (data6 < 0 || isNaN(data6)) {
                                  validate62.errors = [
                                    {
                                      instancePath:
                                        instancePath + "/next_cursor",
                                      schemaPath: "#/$defs/cursor/minimum",
                                      keyword: "minimum",
                                      params: { comparison: ">=", limit: 0 },
                                      message: "must be >= 0",
                                    },
                                  ];
                                  return false;
                                }
                              }
                            }
                            var valid1 = _errs20 === errors;
                          } else {
                            var valid1 = true;
                          }
                          if (valid1) {
                            if (data.has_more !== undefined) {
                              const _errs23 = errors;
                              if (typeof data.has_more !== "boolean") {
                                validate62.errors = [
                                  {
                                    instancePath: instancePath + "/has_more",
                                    schemaPath:
                                      "#/allOf/2/properties/has_more/type",
                                    keyword: "type",
                                    params: { type: "boolean" },
                                    message: "must be boolean",
                                  },
                                ];
                                return false;
                              }
                              var valid1 = _errs23 === errors;
                            } else {
                              var valid1 = true;
                            }
                            if (valid1) {
                              if (data.changes !== undefined) {
                                let data8 = data.changes;
                                const _errs25 = errors;
                                if (errors === _errs25) {
                                  if (Array.isArray(data8)) {
                                    if (data8.length > 1000) {
                                      validate62.errors = [
                                        {
                                          instancePath:
                                            instancePath + "/changes",
                                          schemaPath:
                                            "#/allOf/2/properties/changes/maxItems",
                                          keyword: "maxItems",
                                          params: { limit: 1000 },
                                          message:
                                            "must NOT have more than 1000 items",
                                        },
                                      ];
                                      return false;
                                    } else {
                                      var valid8 = true;
                                      const len0 = data8.length;
                                      for (let i0 = 0; i0 < len0; i0++) {
                                        const _errs27 = errors;
                                        if (
                                          !validate65(data8[i0], {
                                            instancePath:
                                              instancePath + "/changes/" + i0,
                                            parentData: data8,
                                            parentDataProperty: i0,
                                            rootData,
                                            dynamicAnchors,
                                          })
                                        ) {
                                          vErrors =
                                            vErrors === null
                                              ? validate65.errors
                                              : vErrors.concat(
                                                  validate65.errors,
                                                );
                                          errors = vErrors.length;
                                        }
                                        var valid8 = _errs27 === errors;
                                        if (!valid8) {
                                          break;
                                        }
                                      }
                                    }
                                  } else {
                                    validate62.errors = [
                                      {
                                        instancePath: instancePath + "/changes",
                                        schemaPath:
                                          "#/allOf/2/properties/changes/type",
                                        keyword: "type",
                                        params: { type: "array" },
                                        message: "must be array",
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid1 = _errs25 === errors;
                              } else {
                                var valid1 = true;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } else {
          validate62.errors = [
            {
              instancePath,
              schemaPath: "#/allOf/2/type",
              keyword: "type",
              params: { type: "object" },
              message: "must be object",
            },
          ];
          return false;
        }
      }
      var valid0 = _errs2 === errors;
    }
  }
  validate62.errors = vErrors;
  return errors === 0;
}
validate62.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema135 = {
  oneOf: [
    { $ref: "#/$defs/upgradeControl" },
    { $ref: "#/$defs/rebootstrapControl" },
    { $ref: "#/$defs/cursorExpiredControl" },
  ],
};
const schema136 = {
  type: "object",
  additionalProperties: false,
  required: [
    "message_type",
    "protocol_version",
    "min_supported_version",
    "action",
    "reason_code",
    "server_sync_epoch",
  ],
  properties: {
    message_type: { const: "sync_control" },
    protocol_version: { $ref: "#/$defs/protocolVersion" },
    min_supported_version: { $ref: "#/$defs/protocolVersion" },
    action: { const: "upgrade_required" },
    reason_code: {
      enum: ["PROTOCOL_UNSUPPORTED", "SNAPSHOT_SCHEMA_UNSUPPORTED"],
    },
    server_sync_epoch: { $ref: "#/$defs/uuid" },
  },
};
function validate73(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate73.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.message_type === undefined && (missing0 = "message_type")) ||
        (data.protocol_version === undefined &&
          (missing0 = "protocol_version")) ||
        (data.min_supported_version === undefined &&
          (missing0 = "min_supported_version")) ||
        (data.action === undefined && (missing0 = "action")) ||
        (data.reason_code === undefined && (missing0 = "reason_code")) ||
        (data.server_sync_epoch === undefined &&
          (missing0 = "server_sync_epoch"))
      ) {
        validate73.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "message_type" ||
              key0 === "protocol_version" ||
              key0 === "min_supported_version" ||
              key0 === "action" ||
              key0 === "reason_code" ||
              key0 === "server_sync_epoch"
            )
          ) {
            validate73.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.message_type !== undefined) {
            const _errs2 = errors;
            if ("sync_control" !== data.message_type) {
              validate73.errors = [
                {
                  instancePath: instancePath + "/message_type",
                  schemaPath: "#/properties/message_type/const",
                  keyword: "const",
                  params: { allowedValue: "sync_control" },
                  message: "must be equal to constant",
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.protocol_version !== undefined) {
              const _errs3 = errors;
              if ("sync-v1" !== data.protocol_version) {
                validate73.errors = [
                  {
                    instancePath: instancePath + "/protocol_version",
                    schemaPath: "#/$defs/protocolVersion/const",
                    keyword: "const",
                    params: { allowedValue: "sync-v1" },
                    message: "must be equal to constant",
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.min_supported_version !== undefined) {
                const _errs5 = errors;
                if ("sync-v1" !== data.min_supported_version) {
                  validate73.errors = [
                    {
                      instancePath: instancePath + "/min_supported_version",
                      schemaPath: "#/$defs/protocolVersion/const",
                      keyword: "const",
                      params: { allowedValue: "sync-v1" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.action !== undefined) {
                  const _errs7 = errors;
                  if ("upgrade_required" !== data.action) {
                    validate73.errors = [
                      {
                        instancePath: instancePath + "/action",
                        schemaPath: "#/properties/action/const",
                        keyword: "const",
                        params: { allowedValue: "upgrade_required" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.reason_code !== undefined) {
                    let data4 = data.reason_code;
                    const _errs8 = errors;
                    if (
                      !(
                        data4 === "PROTOCOL_UNSUPPORTED" ||
                        data4 === "SNAPSHOT_SCHEMA_UNSUPPORTED"
                      )
                    ) {
                      validate73.errors = [
                        {
                          instancePath: instancePath + "/reason_code",
                          schemaPath: "#/properties/reason_code/enum",
                          keyword: "enum",
                          params: {
                            allowedValues:
                              schema136.properties.reason_code.enum,
                          },
                          message: "must be equal to one of the allowed values",
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs8 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.server_sync_epoch !== undefined) {
                      let data5 = data.server_sync_epoch;
                      const _errs9 = errors;
                      const _errs10 = errors;
                      if (errors === _errs10) {
                        if (errors === _errs10) {
                          if (typeof data5 === "string") {
                            if (!formats0.test(data5)) {
                              validate73.errors = [
                                {
                                  instancePath:
                                    instancePath + "/server_sync_epoch",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate73.errors = [
                              {
                                instancePath:
                                  instancePath + "/server_sync_epoch",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs9 === errors;
                    } else {
                      var valid0 = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate73.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate73.errors = vErrors;
  return errors === 0;
}
validate73.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema140 = {
  type: "object",
  additionalProperties: false,
  required: [
    "message_type",
    "protocol_version",
    "min_supported_version",
    "action",
    "reason_code",
    "server_sync_epoch",
  ],
  properties: {
    message_type: { const: "sync_control" },
    protocol_version: { $ref: "#/$defs/protocolVersion" },
    min_supported_version: { $ref: "#/$defs/protocolVersion" },
    action: { const: "rebootstrap_required" },
    reason_code: { const: "EPOCH_MISMATCH" },
    server_sync_epoch: { $ref: "#/$defs/uuid" },
  },
};
function validate75(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate75.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.message_type === undefined && (missing0 = "message_type")) ||
        (data.protocol_version === undefined &&
          (missing0 = "protocol_version")) ||
        (data.min_supported_version === undefined &&
          (missing0 = "min_supported_version")) ||
        (data.action === undefined && (missing0 = "action")) ||
        (data.reason_code === undefined && (missing0 = "reason_code")) ||
        (data.server_sync_epoch === undefined &&
          (missing0 = "server_sync_epoch"))
      ) {
        validate75.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "message_type" ||
              key0 === "protocol_version" ||
              key0 === "min_supported_version" ||
              key0 === "action" ||
              key0 === "reason_code" ||
              key0 === "server_sync_epoch"
            )
          ) {
            validate75.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.message_type !== undefined) {
            const _errs2 = errors;
            if ("sync_control" !== data.message_type) {
              validate75.errors = [
                {
                  instancePath: instancePath + "/message_type",
                  schemaPath: "#/properties/message_type/const",
                  keyword: "const",
                  params: { allowedValue: "sync_control" },
                  message: "must be equal to constant",
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.protocol_version !== undefined) {
              const _errs3 = errors;
              if ("sync-v1" !== data.protocol_version) {
                validate75.errors = [
                  {
                    instancePath: instancePath + "/protocol_version",
                    schemaPath: "#/$defs/protocolVersion/const",
                    keyword: "const",
                    params: { allowedValue: "sync-v1" },
                    message: "must be equal to constant",
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.min_supported_version !== undefined) {
                const _errs5 = errors;
                if ("sync-v1" !== data.min_supported_version) {
                  validate75.errors = [
                    {
                      instancePath: instancePath + "/min_supported_version",
                      schemaPath: "#/$defs/protocolVersion/const",
                      keyword: "const",
                      params: { allowedValue: "sync-v1" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.action !== undefined) {
                  const _errs7 = errors;
                  if ("rebootstrap_required" !== data.action) {
                    validate75.errors = [
                      {
                        instancePath: instancePath + "/action",
                        schemaPath: "#/properties/action/const",
                        keyword: "const",
                        params: { allowedValue: "rebootstrap_required" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.reason_code !== undefined) {
                    const _errs8 = errors;
                    if ("EPOCH_MISMATCH" !== data.reason_code) {
                      validate75.errors = [
                        {
                          instancePath: instancePath + "/reason_code",
                          schemaPath: "#/properties/reason_code/const",
                          keyword: "const",
                          params: { allowedValue: "EPOCH_MISMATCH" },
                          message: "must be equal to constant",
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs8 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.server_sync_epoch !== undefined) {
                      let data5 = data.server_sync_epoch;
                      const _errs9 = errors;
                      const _errs10 = errors;
                      if (errors === _errs10) {
                        if (errors === _errs10) {
                          if (typeof data5 === "string") {
                            if (!formats0.test(data5)) {
                              validate75.errors = [
                                {
                                  instancePath:
                                    instancePath + "/server_sync_epoch",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate75.errors = [
                              {
                                instancePath:
                                  instancePath + "/server_sync_epoch",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs9 === errors;
                    } else {
                      var valid0 = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate75.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate75.errors = vErrors;
  return errors === 0;
}
validate75.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
const schema144 = {
  type: "object",
  additionalProperties: false,
  required: [
    "message_type",
    "protocol_version",
    "min_supported_version",
    "action",
    "reason_code",
    "server_sync_epoch",
  ],
  properties: {
    message_type: { const: "sync_control" },
    protocol_version: { $ref: "#/$defs/protocolVersion" },
    min_supported_version: { $ref: "#/$defs/protocolVersion" },
    action: { const: "cursor_expired" },
    reason_code: { const: "CURSOR_EXPIRED" },
    server_sync_epoch: { $ref: "#/$defs/uuid" },
  },
};
function validate77(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate77.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  if (errors === 0) {
    if (data && typeof data == "object" && !Array.isArray(data)) {
      let missing0;
      if (
        (data.message_type === undefined && (missing0 = "message_type")) ||
        (data.protocol_version === undefined &&
          (missing0 = "protocol_version")) ||
        (data.min_supported_version === undefined &&
          (missing0 = "min_supported_version")) ||
        (data.action === undefined && (missing0 = "action")) ||
        (data.reason_code === undefined && (missing0 = "reason_code")) ||
        (data.server_sync_epoch === undefined &&
          (missing0 = "server_sync_epoch"))
      ) {
        validate77.errors = [
          {
            instancePath,
            schemaPath: "#/required",
            keyword: "required",
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 in data) {
          if (
            !(
              key0 === "message_type" ||
              key0 === "protocol_version" ||
              key0 === "min_supported_version" ||
              key0 === "action" ||
              key0 === "reason_code" ||
              key0 === "server_sync_epoch"
            )
          ) {
            validate77.errors = [
              {
                instancePath,
                schemaPath: "#/additionalProperties",
                keyword: "additionalProperties",
                params: { additionalProperty: key0 },
                message: "must NOT have additional properties",
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.message_type !== undefined) {
            const _errs2 = errors;
            if ("sync_control" !== data.message_type) {
              validate77.errors = [
                {
                  instancePath: instancePath + "/message_type",
                  schemaPath: "#/properties/message_type/const",
                  keyword: "const",
                  params: { allowedValue: "sync_control" },
                  message: "must be equal to constant",
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.protocol_version !== undefined) {
              const _errs3 = errors;
              if ("sync-v1" !== data.protocol_version) {
                validate77.errors = [
                  {
                    instancePath: instancePath + "/protocol_version",
                    schemaPath: "#/$defs/protocolVersion/const",
                    keyword: "const",
                    params: { allowedValue: "sync-v1" },
                    message: "must be equal to constant",
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.min_supported_version !== undefined) {
                const _errs5 = errors;
                if ("sync-v1" !== data.min_supported_version) {
                  validate77.errors = [
                    {
                      instancePath: instancePath + "/min_supported_version",
                      schemaPath: "#/$defs/protocolVersion/const",
                      keyword: "const",
                      params: { allowedValue: "sync-v1" },
                      message: "must be equal to constant",
                    },
                  ];
                  return false;
                }
                var valid0 = _errs5 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.action !== undefined) {
                  const _errs7 = errors;
                  if ("cursor_expired" !== data.action) {
                    validate77.errors = [
                      {
                        instancePath: instancePath + "/action",
                        schemaPath: "#/properties/action/const",
                        keyword: "const",
                        params: { allowedValue: "cursor_expired" },
                        message: "must be equal to constant",
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.reason_code !== undefined) {
                    const _errs8 = errors;
                    if ("CURSOR_EXPIRED" !== data.reason_code) {
                      validate77.errors = [
                        {
                          instancePath: instancePath + "/reason_code",
                          schemaPath: "#/properties/reason_code/const",
                          keyword: "const",
                          params: { allowedValue: "CURSOR_EXPIRED" },
                          message: "must be equal to constant",
                        },
                      ];
                      return false;
                    }
                    var valid0 = _errs8 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.server_sync_epoch !== undefined) {
                      let data5 = data.server_sync_epoch;
                      const _errs9 = errors;
                      const _errs10 = errors;
                      if (errors === _errs10) {
                        if (errors === _errs10) {
                          if (typeof data5 === "string") {
                            if (!formats0.test(data5)) {
                              validate77.errors = [
                                {
                                  instancePath:
                                    instancePath + "/server_sync_epoch",
                                  schemaPath: "#/$defs/uuid/format",
                                  keyword: "format",
                                  params: { format: "uuid" },
                                  message: 'must match format "' + "uuid" + '"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate77.errors = [
                              {
                                instancePath:
                                  instancePath + "/server_sync_epoch",
                                schemaPath: "#/$defs/uuid/type",
                                keyword: "type",
                                params: { type: "string" },
                                message: "must be string",
                              },
                            ];
                            return false;
                          }
                        }
                      }
                      var valid0 = _errs9 === errors;
                    } else {
                      var valid0 = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate77.errors = [
        {
          instancePath,
          schemaPath: "#/type",
          keyword: "type",
          params: { type: "object" },
          message: "must be object",
        },
      ];
      return false;
    }
  }
  validate77.errors = vErrors;
  return errors === 0;
}
validate77.evaluated = {
  props: true,
  dynamicProps: false,
  dynamicItems: false,
};
function validate72(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate72.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (
    !validate73(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate73.errors : vErrors.concat(validate73.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (
    !validate75(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate75.errors : vErrors.concat(validate75.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (
      !validate77(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate77.errors
          : vErrors.concat(validate77.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
    }
  }
  if (!valid0) {
    const err0 = {
      instancePath,
      schemaPath: "#/oneOf",
      keyword: "oneOf",
      params: { passingSchemas: passing0 },
      message: "must match exactly one schema in oneOf",
    };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
    validate72.errors = vErrors;
    return false;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate72.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate72.evaluated = { dynamicProps: true, dynamicItems: false };
function validate20(
  data,
  {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data,
    dynamicAnchors = {},
  } = {},
) {
  /*# sourceURL="https://schemas.logion.dev/sync-v1.schema.json" */ let vErrors =
    null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = undefined;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = undefined;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (
    !validate21(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (
    !validate25(data, {
      instancePath,
      parentData,
      parentDataProperty,
      rootData,
      dynamicAnchors,
    })
  ) {
    vErrors =
      vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (
      !validate30(data, {
        instancePath,
        parentData,
        parentDataProperty,
        rootData,
        dynamicAnchors,
      })
    ) {
      vErrors =
        vErrors === null
          ? validate30.errors
          : vErrors.concat(validate30.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
      const _errs4 = errors;
      if (
        !validate36(data, {
          instancePath,
          parentData,
          parentDataProperty,
          rootData,
          dynamicAnchors,
        })
      ) {
        vErrors =
          vErrors === null
            ? validate36.errors
            : vErrors.concat(validate36.errors);
        errors = vErrors.length;
      }
      var _valid0 = _errs4 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
          if (props0 !== true) {
            props0 = true;
          }
        }
        const _errs5 = errors;
        if (
          !validate44(data, {
            instancePath,
            parentData,
            parentDataProperty,
            rootData,
            dynamicAnchors,
          })
        ) {
          vErrors =
            vErrors === null
              ? validate44.errors
              : vErrors.concat(validate44.errors);
          errors = vErrors.length;
        }
        var _valid0 = _errs5 === errors;
        if (_valid0 && valid0) {
          valid0 = false;
          passing0 = [passing0, 4];
        } else {
          if (_valid0) {
            valid0 = true;
            passing0 = 4;
            if (props0 !== true) {
              props0 = true;
            }
          }
          const _errs6 = errors;
          if (
            !validate58(data, {
              instancePath,
              parentData,
              parentDataProperty,
              rootData,
              dynamicAnchors,
            })
          ) {
            vErrors =
              vErrors === null
                ? validate58.errors
                : vErrors.concat(validate58.errors);
            errors = vErrors.length;
          }
          var _valid0 = _errs6 === errors;
          if (_valid0 && valid0) {
            valid0 = false;
            passing0 = [passing0, 5];
          } else {
            if (_valid0) {
              valid0 = true;
              passing0 = 5;
              if (props0 !== true) {
                props0 = true;
              }
            }
            const _errs7 = errors;
            if (
              !validate62(data, {
                instancePath,
                parentData,
                parentDataProperty,
                rootData,
                dynamicAnchors,
              })
            ) {
              vErrors =
                vErrors === null
                  ? validate62.errors
                  : vErrors.concat(validate62.errors);
              errors = vErrors.length;
            }
            var _valid0 = _errs7 === errors;
            if (_valid0 && valid0) {
              valid0 = false;
              passing0 = [passing0, 6];
            } else {
              if (_valid0) {
                valid0 = true;
                passing0 = 6;
                if (props0 !== true) {
                  props0 = true;
                }
              }
              const _errs8 = errors;
              if (
                !validate72(data, {
                  instancePath,
                  parentData,
                  parentDataProperty,
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors =
                  vErrors === null
                    ? validate72.errors
                    : vErrors.concat(validate72.errors);
                errors = vErrors.length;
              } else {
                var props1 = validate72.evaluated.props;
              }
              var _valid0 = _errs8 === errors;
              if (_valid0 && valid0) {
                valid0 = false;
                passing0 = [passing0, 7];
              } else {
                if (_valid0) {
                  valid0 = true;
                  passing0 = 7;
                  if (props0 !== true && props1 !== undefined) {
                    if (props1 === true) {
                      props0 = true;
                    } else {
                      props0 = props0 || {};
                      Object.assign(props0, props1);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  if (!valid0) {
    const err0 = {
      instancePath,
      schemaPath: "#/oneOf",
      keyword: "oneOf",
      params: { passingSchemas: passing0 },
      message: "must match exactly one schema in oneOf",
    };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
    validate20.errors = vErrors;
    return false;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate20.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate20.evaluated = { dynamicProps: true, dynamicItems: false };
