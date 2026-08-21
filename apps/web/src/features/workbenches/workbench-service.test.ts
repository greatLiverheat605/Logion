import { describe, expect, it, vi } from "vitest";
import { canonicalize } from "json-canonicalize";

import {
  type ApiClient,
  type ApiRequestOptions,
  LogionApiError,
} from "@/lib/api/client";

import { createWorkbenchDocument } from "./workbench-model";
import {
  mergeWorkbenchDocuments,
  parseWorkbenchPreference,
  WorkbenchConflictError,
  type WorkbenchPreference,
  WorkbenchService,
  workbenchExportFingerprint,
  workbenchMigrationIdempotencyKey,
} from "./workbench-service";

function clientWith(
  implementation: (path: string, options?: ApiRequestOptions) => unknown,
): ApiClient {
  return { request: vi.fn(implementation) as ApiClient["request"] };
}

const document = createWorkbenchDocument({
  accent: "cyan",
  description: "研究来源与证据",
  icon: "microscope",
  name: "论文推进",
  templateId: "fixed.research",
});

function preference(revision = 1): WorkbenchPreference {
  return {
    contract: "workbench.preference",
    schemaVersion: 1,
    revision,
    payload: {
      activeWorkbenchId: "fixed.learning",
      defaultSpaceByWorkbench: {},
      defaultViewByWorkbench: {},
      density: "comfortable",
      hiddenFixedWorkbenchIds: [],
      workbenchOrder: ["fixed.learning"],
    },
  };
}

function definition(revision = 1) {
  return {
    accent: document.payload.accent,
    createdAt: "2026-08-20T00:00:00Z",
    description: document.payload.description,
    document,
    icon: document.payload.icon,
    id: "123e4567-e89b-42d3-a456-426614174000",
    lifecycle: "active" as const,
    name: document.payload.name,
    ownerUserId: "223e4567-e89b-42d3-a456-426614174000",
    revision,
    templateId: document.payload.templateId,
    updatedAt: "2026-08-20T00:00:00Z",
  };
}

describe("WorkbenchService", () => {
  it("strictly parses a revision-bound preference", () => {
    expect(parseWorkbenchPreference(JSON.stringify(preference()), 1)).toEqual(
      preference(),
    );
    expect(() =>
      parseWorkbenchPreference(JSON.stringify(preference()), 2),
    ).toThrow("invalid");
    expect(() =>
      parseWorkbenchPreference(
        JSON.stringify({
          ...preference(),
          payload: {
            ...preference().payload,
            defaultViewByWorkbench: { constructor: "unsafe" },
          },
        }),
        1,
      ),
    ).toThrow("invalid");
  });

  it("loads definitions and a valid preference without trusting list items as documents", async () => {
    const summary = { ...definition() };
    delete (summary as Partial<typeof summary>).document;
    const api = clientWith((path) =>
      path.endsWith("/settings")
        ? Promise.resolve({
            settings: [
              {
                key: "workbench.preference",
                value: JSON.stringify(preference()),
                version: 1,
              },
            ],
          })
        : Promise.resolve({ items: [summary], nextCursor: null }),
    );

    await expect(new WorkbenchService(api).load()).resolves.toEqual({
      definitions: [summary],
      preference: preference(),
    });
  });

  it("writes the outer version and matching inner revision", async () => {
    const calls: Array<{ path: string; options?: ApiRequestOptions }> = [];
    const api = clientWith((path, options) => {
      calls.push({ path, options });
      if (path.endsWith("/settings") && options?.method === "PUT") {
        const body = JSON.parse(String(options.body));
        const value = JSON.parse(body.settings[0].value);
        return Promise.resolve({
          settings: [
            {
              key: "workbench.preference",
              value: JSON.stringify(value),
              version: 1,
            },
          ],
        });
      }
      return path.endsWith("/settings")
        ? Promise.resolve({ settings: [] })
        : Promise.resolve({ items: [], nextCursor: null });
    });
    const service = new WorkbenchService(api);
    await service.load();

    await expect(service.savePreference(preference().payload)).resolves.toEqual(
      preference(),
    );
    const write = JSON.parse(String(calls.at(-1)?.options?.body));
    expect(write.settings[0].version).toBe(0);
    expect(JSON.parse(write.settings[0].value).revision).toBe(1);
  });

  it("turns only typed definition conflicts into a three-way conflict", async () => {
    const details = {
      base: document,
      baseRevision: 1,
      conflictPaths: ["/payload/name"],
      entity: "definition" as const,
      local: { ...document, payload: { ...document.payload, name: "本地" } },
      remote: { ...document, payload: { ...document.payload, name: "远端" } },
      remoteRevision: 2,
    };
    const api = clientWith(() =>
      Promise.reject(
        new LogionApiError({
          code: "WORKBENCH_VERSION_CONFLICT",
          details,
          message: "conflict",
          status: 409,
        }),
      ),
    );

    await expect(
      new WorkbenchService(api).replace(definition(), details.local),
    ).rejects.toEqual(new WorkbenchConflictError(details));
  });

  it("three-way merges stable records without losing non-conflicting remote changes", () => {
    const local = structuredClone(document);
    const remote = structuredClone(document);
    local.payload.name = "Local name";
    local.payload.accent = "violet";
    local.payload.modules[0]!.kind = "task-queue";
    remote.payload.description = "Remote description";
    remote.payload.accent = "amber";
    remote.payload.modules[0]!.title = "Remote title";
    remote.payload.modules[1]!.kind = "topics";
    remote.payload.modules.reverse();
    remote.payload.layout.items[1]!.order = 7;

    const merged = mergeWorkbenchDocuments(document, local, remote);

    expect(merged.payload.name).toBe("Local name");
    expect(merged.payload.description).toBe("Remote description");
    expect(merged.payload.accent).toBe("violet");
    expect(
      merged.payload.modules.find(
        (item) => item.id === document.payload.modules[0]!.id,
      )?.kind,
    ).toBe("task-queue");
    expect(
      merged.payload.modules.find(
        (item) => item.id === document.payload.modules[0]!.id,
      )?.title,
    ).toBe("Remote title");
    expect(
      merged.payload.modules.find(
        (item) => item.id === document.payload.modules[1]!.id,
      )?.kind,
    ).toBe("topics");
    expect(merged.payload.modules.map((item) => item.id)).toEqual(
      remote.payload.modules.map((item) => item.id),
    );
    expect(
      merged.payload.layout.items.find(
        (item) => item.moduleId === document.payload.modules[1]!.id,
      )?.order,
    ).toBe(7);
  });

  it("merges non-conflicting fields on every stable entity type", () => {
    const base = structuredClone(document);
    base.payload.fieldDefinitions = [
      {
        id: "status",
        label: "Status",
        maxLength: 20,
        required: false,
        type: "text",
      },
    ];
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.payload.fieldDefinitions[0]!.label = "Local status";
    const remoteField = remote.payload.fieldDefinitions[0]!;
    if (remoteField.type !== "text") throw new Error("Expected text field");
    remoteField.maxLength = 40;

    const merged = mergeWorkbenchDocuments(base, local, remote);

    expect(merged.payload.fieldDefinitions[0]).toMatchObject({
      label: "Local status",
      maxLength: 40,
    });
  });

  it("accepts nullable module titles from API conflict documents", () => {
    const base = structuredClone(document);
    base.payload.modules[0] = {
      ...base.payload.modules[0]!,
      title: null,
    };
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.payload.modules[0]!.kind = "projects";

    const merged = mergeWorkbenchDocuments(base, local, remote);

    expect(merged.payload.modules[0]).toMatchObject({
      kind: "projects",
      title: null,
    });
  });

  it("merges same-id records added independently on both sides", () => {
    const base = structuredClone(document);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.payload.modules.push({
      id: "shared-module",
      kind: "projects",
      title: "Local module",
    });
    remote.payload.modules.push({
      id: "shared-module",
      kind: "projects",
      filterIds: [],
    });
    local.payload.layout.items.push({
      moduleId: "shared-module",
      order: 2,
      region: "main",
      span: 1,
    });
    remote.payload.layout.items.push({
      moduleId: "shared-module",
      order: 2,
      region: "main",
      span: 1,
    });

    const merged = mergeWorkbenchDocuments(base, local, remote);

    expect(
      merged.payload.modules.find((item) => item.id === "shared-module"),
    ).toMatchObject({
      filterIds: [],
      title: "Local module",
    });
  });

  it("falls back when a variant merge leaves forbidden fields behind", () => {
    const base = structuredClone(document);
    base.payload.fieldDefinitions = [
      {
        id: "status",
        label: "Status",
        maxLength: 20,
        required: false,
        type: "text",
      },
    ];
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.payload.fieldDefinitions = [
      {
        id: "status",
        label: "Number status",
        maximum: 10,
        minimum: 0,
        required: false,
        type: "number",
      },
    ];
    const remoteField = remote.payload.fieldDefinitions[0]!;
    if (remoteField.type !== "text") throw new Error("Expected text field");
    remoteField.maxLength = 40;

    const merged = mergeWorkbenchDocuments(base, local, remote, "remote");

    expect(merged.payload.fieldDefinitions[0]).toEqual(remoteField);
  });

  it("keeps references bounded when reconciling over-capacity stable records", () => {
    const base = structuredClone(document);
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.payload.filters = Array.from({ length: 20 }, (_, index) => ({
      id: `local-filter-${index + 1}`,
      kind: "target-kind-in" as const,
      targetKinds: ["task" as const],
    }));
    remote.payload.filters = Array.from({ length: 20 }, (_, index) => ({
      id: `remote-filter-${index + 1}`,
      kind: "target-kind-in" as const,
      targetKinds: ["task" as const],
    }));
    local.payload.modules[0]!.filterIds = local.payload.filters.map(
      (item) => item.id,
    );
    remote.payload.modules[1]!.filterIds = remote.payload.filters.map(
      (item) => item.id,
    );

    const merged = mergeWorkbenchDocuments(base, local, remote);
    const filterIds = new Set(merged.payload.filters.map((item) => item.id));

    expect(merged.payload.filters.length).toBeLessThanOrEqual(32);
    expect(
      merged.payload.modules.every(
        (module) => module.filterIds?.every((id) => filterIds.has(id)) ?? true,
      ),
    ).toBe(true);
  });

  it("reconciles module deletion conflicts to exact layout coverage", () => {
    const local = structuredClone(document);
    const remote = structuredClone(document);
    local.payload.modules[0]!.title = "Local title";
    const removed = remote.payload.modules[0]!.id;
    remote.payload.modules = remote.payload.modules.filter(
      (module) => module.id !== removed,
    );
    remote.payload.layout.items = remote.payload.layout.items.filter(
      (item) => item.moduleId !== removed,
    );

    const merged = mergeWorkbenchDocuments(document, local, remote);

    expect(
      merged.payload.modules.find((module) => module.id === removed)?.title,
    ).toBe("Local title");
    expect(
      new Set(merged.payload.layout.items.map((item) => item.moduleId)),
    ).toEqual(new Set(merged.payload.modules.map((module) => module.id)));
  });

  it("restores referenced filters and fields and clamps merged layout spans", () => {
    const base = structuredClone(document);
    base.payload.fieldDefinitions = [
      {
        id: "priority",
        label: "Priority",
        maximum: 10,
        minimum: 0,
        required: false,
        type: "number",
      },
    ];
    base.payload.filters = [
      {
        fieldId: "priority",
        id: "priority-filter",
        kind: "attribute-equals",
        value: 5,
      },
    ];
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.payload.layout.columns = 1;
    local.payload.modules[0]!.filterIds = ["priority-filter"];
    remote.payload.filters = [];
    remote.payload.fieldDefinitions = [];
    remote.payload.layout.items[0]!.span = 2;

    const merged = mergeWorkbenchDocuments(base, local, remote);

    expect(merged.payload.filters.map((item) => item.id)).toContain(
      "priority-filter",
    );
    expect(merged.payload.fieldDefinitions.map((item) => item.id)).toContain(
      "priority",
    );
    expect(merged.payload.layout.items[0]!.span).toBe(1);
  });

  it("keeps merged stable-record arrays within schema capacity", () => {
    const makeDocument = (prefix: string) => {
      const modules = Array.from({ length: 24 }, (_, index) => ({
        id: `${prefix}-${index + 1}`,
        kind: "next-action" as const,
      }));
      return {
        ...structuredClone(document),
        payload: {
          ...document.payload,
          layout: {
            columns: 2 as const,
            items: modules.map((module, index) => ({
              moduleId: module.id,
              order: Math.floor(index / 2),
              region: index % 2 === 0 ? ("main" as const) : ("side" as const),
              span: 1,
            })),
          },
          modules,
        },
      };
    };

    const merged = mergeWorkbenchDocuments(
      document,
      makeDocument("local"),
      makeDocument("remote"),
    );

    expect(merged.payload.modules).toHaveLength(24);
    expect(
      merged.payload.modules.every((module) => module.id.startsWith("local-")),
    ).toBe(true);
  });

  it("falls back when a valid merge exceeds canonical document capacity", () => {
    const makeDocument = (prefix: string) => {
      const fieldDefinitions = Array.from({ length: 6 }, (_, fieldIndex) => ({
        id: `${prefix}_field_${fieldIndex + 1}`,
        label: `${prefix} ${"L".repeat(70)}`,
        options: Array.from({ length: 32 }, (_, optionIndex) => ({
          id: `${prefix}_option_${fieldIndex + 1}_${optionIndex + 1}`,
          label: `${prefix} ${"O".repeat(70)}`,
        })),
        required: false,
        type: "single-select" as const,
      }));
      return {
        ...structuredClone(document),
        payload: { ...document.payload, fieldDefinitions },
      };
    };
    const local = makeDocument("local");
    const remote = makeDocument("remote");
    const canonicalApiSize = (value: typeof local) =>
      new TextEncoder().encode(
        canonicalize({
          ...value,
          payload: {
            ...value.payload,
            modules: value.payload.modules.map((module) => ({
              ...module,
              ...(module.title === undefined ? { title: null } : {}),
              ...(module.filterIds === undefined ? { filterIds: [] } : {}),
              ...(module.quickCreateIds === undefined
                ? { quickCreateIds: [] }
                : {}),
            })),
            fieldDefinitions: value.payload.fieldDefinitions.map((field) => ({
              ...field,
              ...(field.required === undefined ? { required: false } : {}),
            })),
          },
        }),
      ).byteLength;

    expect(canonicalApiSize(local)).toBeLessThanOrEqual(32 * 1024);
    expect(canonicalApiSize(remote)).toBeLessThanOrEqual(32 * 1024);
    expect(
      canonicalApiSize({
        ...local,
        payload: {
          ...local.payload,
          fieldDefinitions: [
            ...local.payload.fieldDefinitions,
            ...remote.payload.fieldDefinitions,
          ],
        },
      }),
    ).toBeGreaterThan(32 * 1024);

    const merged = mergeWorkbenchDocuments(document, local, remote);

    expect(merged.payload.fieldDefinitions).toEqual(
      local.payload.fieldDefinitions,
    );
  });

  it("derives deterministic migration keys from both source and content", async () => {
    const same = await workbenchMigrationIdempotencyKey("legacy-1", document);
    const repeated = await workbenchMigrationIdempotencyKey(
      "legacy-1",
      structuredClone(document),
    );
    const changed = structuredClone(document);
    changed.payload.description = "Changed source content";

    expect(repeated).toBe(same);
    expect(
      await workbenchMigrationIdempotencyKey("legacy-1", changed),
    ).not.toBe(same);
    expect(same).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("uses RFC 8785 fingerprints and preserves raw import JSON for server duplicate-key rejection", async () => {
    const payload = {
      contract: "workbench.export" as const,
      document,
      schemaVersion: 1 as const,
    };
    const raw = `{"contract":"workbench.export","schemaVersion":1,"document":${JSON.stringify(document)}}`;
    const api = clientWith((_path, options) =>
      Promise.resolve({
        createdAt: "2026-08-20T00:00:00Z",
        definitionId: definition().id,
        idempotencyKey: "test-idempotency-key",
        operation: "workbench.import.v1",
        receiptId: "423e4567-e89b-42d3-a456-426614174000",
        retryable: false,
        sourceFingerprint: JSON.parse(String(options?.body)).sourceFingerprint,
        status: "succeeded",
      }),
    );
    const service = new WorkbenchService(api);

    const expected = await workbenchExportFingerprint(payload);
    await service.import(raw);

    const options = vi.mocked(api.request).mock.calls[0]?.[1];
    expect(String(options?.body)).toBe(
      `{"sourceFingerprint":${JSON.stringify(expected)},"payload":${raw}}`,
    );
    expect(options).toMatchObject({ csrf: true, method: "POST" });
  });

  it("sends DELETE JSON impact and export CSRF without exposing forbidden headers", async () => {
    const api = clientWith(() => Promise.resolve({}));
    const service = new WorkbenchService(api);
    const impact = {
      fallbackWorkbenchId: "fixed.learning" as const,
      formalObjectDeleteCount: 0 as const,
      impactFingerprint: "signed",
      linkCount: 2,
      linkSetRevision: 4,
      preferenceWillFallback: true,
      revision: 3,
      workbenchId: definition().id,
    };

    await service.delete(impact);
    await service.export(definition().id, true);

    const deleteOptions = vi.mocked(api.request).mock.calls[0]?.[1];
    expect(deleteOptions).toMatchObject({ csrf: true, method: "DELETE" });
    expect(JSON.parse(String(deleteOptions?.body))).toEqual({
      expectedLinkSetRevision: 4,
      expectedRevision: 3,
      impactFingerprint: "signed",
    });
    expect(deleteOptions?.headers).toHaveProperty("Idempotency-Key");
    expect(vi.mocked(api.request).mock.calls[1]).toEqual([
      `/app/api/workbench-exports/${definition().id}`,
      { csrf: true, method: "POST", query: { include_links: "true" } },
    ]);
  });
});
