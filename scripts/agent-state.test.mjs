import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AgentStateValidationError,
  initializeRun,
  resolveCurrentRun,
  validateRun,
} from "./agent-state.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(
  repoRoot,
  ".agents",
  "coordination",
  "fixtures",
  "minimal-run",
);
const agentStateScript = join(repoRoot, "scripts", "agent-state.mjs");

async function copyFixture() {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-state-"));
  const runDir = join(root, "run-minimal");
  await cp(fixture, runDir, { recursive: true });
  const contextPath = join(runDir, "context.json");
  const context = await readJson(contextPath);
  context.mode = "active";
  await writeJson(contextPath, context);
  await replaceBaseCommit(runDir, currentCommit());
  return { root, runDir };
}

async function withFixture(callback) {
  const { root, runDir } = await copyFixture();
  try {
    await callback(runDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256FileBytes(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function refreshObservationDigests(runDir) {
  const observationsDir = join(runDir, "observations");
  const graphPath = join(runDir, "graph.json");
  const graph = await readJson(graphPath);
  const acceptedDigests = new Map();
  for (const name of await readdir(observationsDir)) {
    if (!name.endsWith(".json")) continue;
    const observationPath = join(observationsDir, name);
    const observation = await readJson(observationPath);
    observation.handoffSha256 = await sha256FileBytes(
      join(runDir, ...observation.handoff.split("/")),
    );
    await writeJson(observationPath, observation);
    const graphNode = graph.nodes.find(
      (node) => node.id === observation.observationId,
    );
    if (graphNode) graphNode.data.handoffSha256 = observation.handoffSha256;
    acceptedDigests.set(
      observation.observationId,
      await sha256FileBytes(observationPath),
    );
  }
  await writeJson(graphPath, graph);
  const events = await readEvents(runDir);
  for (const event of events) {
    if (
      event.type !== "task.accepted" ||
      !Array.isArray(event.data.observations)
    ) {
      continue;
    }
    event.data.observationDigests = Object.fromEntries(
      event.data.observations.map((observationId) => [
        observationId,
        acceptedDigests.get(observationId),
      ]),
    );
  }
  await writeEvents(runDir, events);
}

async function readEvents(runDir) {
  return (await readFile(join(runDir, "tasks.jsonl"), "utf8"))
    .trim()
    .split(/\r?\n/gu)
    .map((line) => JSON.parse(line));
}

async function writeEvents(runDir, events) {
  await writeFile(
    join(runDir, "tasks.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function runInitializerCrash(root, failpoint, runId) {
  const runsRoot = join(root, "runs");
  const pointerPath = join(root, "current-run.json");
  const result = spawnSync(
    process.execPath,
    [
      agentStateScript,
      "init",
      "--run-id",
      runId,
      "--objective",
      "Exercise crash recovery",
      "--base-commit",
      currentCommit(),
      "--branch",
      "codex/fixture",
      "--runs-root",
      runsRoot,
      "--pointer-path",
      pointerPath,
      "--pointer-base",
      root,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        LOGION_AGENT_STATE_FAILPOINT: failpoint,
      },
    },
  );
  assert.equal(result.status, 86, result.stderr || result.stdout);
  return { runsRoot, pointerPath };
}

async function assertNoTransactionArtifacts(root, runsRoot) {
  const runEntries = await readdir(runsRoot);
  assert.equal(
    runEntries.some((name) =>
      /^(?:\.staging-|\.orphan-|\.transaction-|\.agent-state-init\.lock$)/u.test(
        name,
      ),
    ),
    false,
  );
  const pointerEntries = await readdir(root);
  assert.equal(
    pointerEntries.some((name) => name.startsWith(".pointer-")),
    false,
  );
}

async function replaceBaseCommit(runDir, baseCommit) {
  const contextPath = join(runDir, "context.json");
  const context = await readJson(contextPath);
  context.base.commit = baseCommit;
  await writeJson(contextPath, context);

  const events = await readEvents(runDir);
  for (const event of events) event.baseCommit = baseCommit;
  await writeEvents(runDir, events);

  const handoffsDir = join(runDir, "handoffs");
  for (const name of await readdir(handoffsDir)) {
    if (!name.endsWith(".json")) continue;
    const handoffPath = join(handoffsDir, name);
    const handoff = await readJson(handoffPath);
    handoff.baseCommit = baseCommit;
    await writeJson(handoffPath, handoff);
  }

  const graphPath = join(runDir, "graph.json");
  const graph = await readJson(graphPath);
  for (const node of graph.nodes) {
    if (node.type === "commit") node.data.commit = baseCommit;
  }
  await writeJson(graphPath, graph);
  await refreshObservationDigests(runDir);
}

async function withPointerFixture(callback) {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-pointer-"));
  const runsRoot = join(root, "runs");
  const runDir = join(runsRoot, "run-minimal");
  const pointerPath = join(root, "current-run.json");
  try {
    await cp(fixture, runDir, { recursive: true });
    const contextPath = join(runDir, "context.json");
    const context = await readJson(contextPath);
    context.mode = "active";
    await writeJson(contextPath, context);
    await callback({ root, runsRoot, runDir, pointerPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function configureConcurrentReviewWriter(
  runDir,
  { allowedPaths, branch, worktree, useDisjointGraphFile = false },
) {
  const events = await readEvents(runDir);
  const created = events.find(
    (event) => event.eventId === "event-review-created",
  );
  created.data.ownerRoleId = "kimi";
  created.data.access = "write";
  created.data.dependencies = [];
  created.data.allowedPaths = allowedPaths;
  created.data.branch = branch;
  created.data.worktree = worktree;

  events.find(
    (event) => event.eventId === "event-review-assigned",
  ).data.assigneeRoleId = "kimi";
  events.find((event) => event.eventId === "event-review-started").actorRoleId =
    "kimi";
  events.find(
    (event) => event.eventId === "event-review-completed",
  ).actorRoleId = "kimi";

  const times = new Map([
    ["event-review-assigned", "2026-08-03T00:04:00Z"],
    ["event-review-started", "2026-08-03T00:04:15Z"],
    ["event-review-completed", "2026-08-03T00:05:00Z"],
    ["event-review-accepted", "2026-08-03T00:07:00Z"],
  ]);
  for (const event of events) {
    if (times.has(event.eventId)) event.at = times.get(event.eventId);
  }
  events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  await writeEvents(runDir, events);

  const handoffPath = join(runDir, "handoffs", "task-review.json");
  const handoff = await readJson(handoffPath);
  handoff.workingBranch = branch;
  await writeJson(handoffPath, handoff);

  const graphPath = join(runDir, "graph.json");
  const graph = await readJson(graphPath);
  graph.edges.find((edge) => edge.id === "edge-review-model").to = "model-kimi";
  if (useDisjointGraphFile) {
    graph.nodes.push({
      id: "file-review-disjoint",
      type: "file",
      label: "Disjoint review fixture file",
      data: { path: ".python-version" },
    });
    graph.edges.find((edge) => edge.id === "edge-review-file").to =
      "file-review-disjoint";
  }
  await writeJson(graphPath, graph);
  await refreshObservationDigests(runDir);
}

async function configureRetryReference(runDir, retryOfEventId) {
  const events = await readEvents(runDir);
  const failed = events.find((event) => event.eventId === "event-ui-completed");
  failed.eventId = "event-ui-failed";
  failed.type = "task.failed";
  failed.data = {};

  const retried = events.find((event) => event.eventId === "event-ui-accepted");
  retried.eventId = "event-ui-retried";
  retried.type = "task.retried";
  retried.data = { retryOfEventId, assigneeRoleId: "kimi" };

  events.push(
    {
      schemaVersion: 1,
      eventId: "event-ui-restarted",
      runId: retried.runId,
      taskId: retried.taskId,
      type: "task.started",
      at: "2026-08-03T00:08:10Z",
      baseCommit: retried.baseCommit,
      actorRoleId: "kimi",
      data: {},
    },
    {
      schemaVersion: 1,
      eventId: "event-ui-recompleted",
      runId: retried.runId,
      taskId: retried.taskId,
      type: "task.completed",
      at: "2026-08-03T00:08:20Z",
      baseCommit: retried.baseCommit,
      actorRoleId: "kimi",
      data: { handoff: "handoffs/task-ui.json" },
    },
    {
      schemaVersion: 1,
      eventId: "event-ui-reaccepted",
      runId: retried.runId,
      taskId: retried.taskId,
      type: "task.accepted",
      at: "2026-08-03T00:08:30Z",
      baseCommit: retried.baseCommit,
      actorRoleId: "codex",
      data: { basis: ["check-ui-fixture"] },
    },
  );
  events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  await writeEvents(runDir, events);
}

async function expectValidationFailure(runDir, expectedMessage) {
  await assert.rejects(
    () => validateRun(runDir),
    (error) => {
      assert.ok(error instanceof AgentStateValidationError);
      assert.match(error.message, expectedMessage);
      return true;
    },
  );
}

test("validates and replays the tracked minimal Run", async () => {
  const result = await validateRun(fixture);
  assert.equal(result.eventCount, 10);
  assert.deepEqual(result.taskStates, {
    "task-ui": "accepted",
    "task-review": "accepted",
  });
});

test("keeps the tracked state contract parseable", async () => {
  const schema = await readJson(
    join(repoRoot, ".agents", "coordination", "state.schema.json"),
  );
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.ok(schema.$defs.context);
  assert.ok(schema.$defs.taskEvent);
  assert.ok(schema.$defs.graph);
  assert.ok(schema.$defs.handoff);
  assert.ok(schema.$defs.pointer);
  assert.ok(schema.$defs.rolesDocument);
  assert.ok(schema.$defs.receiptCheck.required.includes("acceptanceCheckId"));
});

test("rejects sensitive values before they become durable context", async () => {
  await withFixture(async (runDir) => {
    const path = join(runDir, "context.json");
    const context = await readJson(path);
    const fakeSecret = ["sk", "proj", "1234567890abcdefghijkl"].join("-");
    context.objective = `Use ${fakeSecret} in a task`;
    await writeJson(path, context);
    await expectValidationFailure(runDir, /API-key pattern/u);
  });
});

test("rejects sensitive JSON keys even when their values look harmless", async () => {
  await withFixture(async (runDir) => {
    const path = join(runDir, "context.json");
    const context = await readJson(path);
    context.apiKey = "placeholder";
    await writeJson(path, context);
    await expectValidationFailure(runDir, /forbidden key/u);
  });
});

test("rejects duplicate JSON keys before last-wins parsing can hide secrets", async () => {
  await withFixture(async (runDir) => {
    const contextPath = join(runDir, "context.json");
    const context = await readFile(contextPath, "utf8");
    const duplicate = context.replace(
      /\{\r?\n/u,
      '{\n  "externalRefs": { "clientSecret": "placeholder" },\n  "externalRefs": {},\n',
    );
    await writeFile(contextPath, duplicate, "utf8");
    await expectValidationFailure(runDir, /duplicate JSON key/iu);
  });
});

test("rejects a ready seat whose observed model differs from its role", async () => {
  await withFixture(async (runDir) => {
    const path = join(runDir, "context.json");
    const context = await readJson(path);
    context.actors.find(
      (actor) => actor.roleId === "kimi",
    ).modelEvidence.modelId = "another-model";
    await writeJson(path, context);
    await expectValidationFailure(runDir, /expected kimi-k3/u);
  });
});

test("requires strict RFC3339 model-evidence timestamps", async (t) => {
  for (const [name, observedAt] of [
    ["missing-zone", "2026-08-03T00:00:00"],
    ["invalid-calendar-date", "2026-02-30T00:00:00Z"],
  ]) {
    await t.test(name, async () => {
      await withFixture(async (runDir) => {
        const contextPath = join(runDir, "context.json");
        const context = await readJson(contextPath);
        context.actors.find(
          (actor) => actor.roleId === "kimi",
        ).modelEvidence.observedAt = observedAt;
        await writeJson(contextPath, context);
        await expectValidationFailure(runDir, /invalid model evidence time/iu);
      });
    });
  }

  await t.test("explicit-offset", async () => {
    await withFixture(async (runDir) => {
      const contextPath = join(runDir, "context.json");
      const context = await readJson(contextPath);
      context.actors.find(
        (actor) => actor.roleId === "kimi",
      ).modelEvidence.observedAt = "2026-08-03T08:00:00+08:00";
      await writeJson(contextPath, context);
      assert.equal((await validateRun(runDir)).runId, "run-minimal");
    });
  });
});

test("rejects model evidence recorded after task assignment", async () => {
  await withFixture(async (runDir) => {
    const contextPath = join(runDir, "context.json");
    const context = await readJson(contextPath);
    context.actors.find(
      (actor) => actor.roleId === "kimi",
    ).modelEvidence.observedAt = "2026-08-03T00:02:01Z";
    await writeJson(contextPath, context);
    await expectValidationFailure(
      runDir,
      /predates role kimi model evidence/iu,
    );
  });
});

test("rejects completed work without its handoff receipt", async () => {
  await withFixture(async (runDir) => {
    await rm(join(runDir, "handoffs", "task-review.json"));
    await expectValidationFailure(
      runDir,
      /completed without a handoff receipt/u,
    );
  });
});

test("rejects replay results that disagree with expected final state", async () => {
  await withFixture(async (runDir) => {
    const path = join(runDir, "context.json");
    const context = await readJson(path);
    context.expectedFinalState["task-review"] = "completed";
    await writeJson(path, context);
    await expectValidationFailure(
      runDir,
      /replayed state.*expected completed/u,
    );
  });
});

test("rejects overlapping concurrent writers", async () => {
  await withFixture(async (runDir) => {
    const path = join(runDir, "tasks.jsonl");
    const events = (await readFile(path, "utf8"))
      .trim()
      .split(/\r?\n/gu)
      .map((line) => JSON.parse(line));
    const created = events.find(
      (event) => event.eventId === "event-review-created",
    );
    created.data.ownerRoleId = "kimi";
    created.data.access = "write";
    created.data.dependencies = [];
    const times = new Map([
      ["event-review-assigned", "2026-08-03T00:04:00Z"],
      ["event-review-started", "2026-08-03T00:04:15Z"],
      ["event-review-completed", "2026-08-03T00:05:00Z"],
      ["event-review-accepted", "2026-08-03T00:07:00Z"],
    ]);
    for (const event of events) {
      if (times.has(event.eventId)) event.at = times.get(event.eventId);
    }
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    await writeFile(
      path,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    await expectValidationFailure(
      runDir,
      /overlapping concurrent write paths/u,
    );
  });
});

test("initializes a local Run without overwriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-init-"));
  try {
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const result = await initializeRun({
      runId: "run-initializer-test",
      objective: "Verify local Run initialization",
      baseCommit,
      branch: "codex/fixture",
      runsRoot: root,
    });
    assert.equal(result.summary.runId, "run-initializer-test");
    await assert.rejects(
      () =>
        initializeRun({
          runId: "run-initializer-test",
          objective: "Do not overwrite",
          baseCommit,
          branch: "codex/fixture",
          runsRoot: root,
        }),
      /Run already exists/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a sensitive branch before any Run state becomes durable", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-branch-"));
  try {
    const fakeSecret = ["sk", "proj", "1234567890abcdefghijkl"].join("-");
    await assert.rejects(
      () =>
        initializeRun({
          runId: "run-sensitive-branch",
          objective: "Reject a sensitive branch before persistence",
          baseCommit: currentCommit(),
          branch: `codex/${fakeSecret}`,
          runsRoot: root,
        }),
      /API-key pattern/iu,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers initialization transactions after real process crashes", async (t) => {
  for (const failpoint of [
    "after-transaction-created",
    "after-intent-durable",
    "after-stage-files-durable",
    "after-stage-durable",
    "after-run-published",
  ]) {
    await t.test(failpoint, async () => {
      const root = await mkdtemp(join(tmpdir(), "logion-agent-crash-"));
      const runId = `run-${failpoint}`;
      try {
        const { runsRoot, pointerPath } = runInitializerCrash(
          root,
          failpoint,
          runId,
        );
        const recovered = await initializeRun({
          runId,
          objective: "Recover and recreate the interrupted Run",
          baseCommit: currentCommit(),
          branch: "codex/fixture",
          runsRoot,
          pointerPath,
          pointerBase: root,
        });
        assert.equal(recovered.summary.runId, runId);
        assert.equal(
          await resolveCurrentRun({ pointerPath, pointerBase: root, runsRoot }),
          recovered.runDir,
        );
        await assertNoTransactionArtifacts(root, runsRoot);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test("after-pointer-published", async () => {
    const root = await mkdtemp(join(tmpdir(), "logion-agent-crash-"));
    const runId = "run-after-pointer-published";
    try {
      const { runsRoot, pointerPath } = runInitializerCrash(
        root,
        "after-pointer-published",
        runId,
      );
      await assert.rejects(
        () =>
          initializeRun({
            runId: "run-after-pointer-recovery",
            objective: "Trigger recovery without replacing the committed Run",
            baseCommit: currentCommit(),
            branch: "codex/fixture",
            runsRoot,
            pointerPath,
            pointerBase: root,
          }),
        /current Run pointer already exists/iu,
      );
      const resolved = await resolveCurrentRun({
        pointerPath,
        pointerBase: root,
        runsRoot,
      });
      assert.equal(resolved, join(runsRoot, runId));
      assert.equal((await validateRun(resolved)).runId, runId);
      await assertNoTransactionArtifacts(root, runsRoot);
      assert.equal(
        await resolveCurrentRun({ pointerPath, pointerBase: root, runsRoot }),
        resolved,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("crash recovery preserves unexplained Run files for manual review", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-crash-review-"));
  const runId = "run-crash-unknown-file";
  try {
    const { runsRoot, pointerPath } = runInitializerCrash(
      root,
      "after-run-published",
      runId,
    );
    const unknownPath = join(runsRoot, runId, "unexpected.txt");
    await writeFile(unknownPath, "do not delete\n", "utf8");
    await assert.rejects(
      () =>
        initializeRun({
          runId,
          objective: "Do not delete unexplained recovery state",
          baseCommit: currentCommit(),
          branch: "codex/fixture",
          runsRoot,
          pointerPath,
          pointerBase: root,
        }),
      /unsupported entry/iu,
    );
    assert.equal(existsSync(unknownPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-manifest recovery preserves an unexplained staging file", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-stage-review-"));
  const runId = "run-stage-unknown-file";
  try {
    const { runsRoot, pointerPath } = runInitializerCrash(
      root,
      "after-stage-files-durable",
      runId,
    );
    const stageName = (await readdir(runsRoot)).find((name) =>
      name.startsWith(".staging-"),
    );
    assert.ok(stageName);
    const unknownPath = join(runsRoot, stageName, "unexpected.txt");
    await writeFile(unknownPath, "do not delete\n", "utf8");
    await assert.rejects(
      () =>
        initializeRun({
          runId,
          objective: "Do not delete unexplained staging state",
          baseCommit: currentCommit(),
          branch: "codex/fixture",
          runsRoot,
          pointerPath,
          pointerBase: root,
        }),
      /Partial agent-state Run contains an unsupported entry/iu,
    );
    assert.equal(existsSync(unknownPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects run identifiers that could escape the state directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-init-"));
  try {
    await assert.rejects(
      () =>
        initializeRun({
          runId: "run-../escape",
          objective: "Escape the run directory",
          baseCommit: "ebf93ee192598430393f93e9313665c36446f84e",
          branch: "codex/fixture",
          runsRoot: root,
        }),
      /run-lowercase-hyphenated-id/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects accepted work when the coordinator acceptance basis is absent", async () => {
  await withFixture(async (runDir) => {
    const events = await readEvents(runDir);
    events.find((event) => event.eventId === "event-ui-accepted").data = {};
    await writeEvents(runDir, events);
    await expectValidationFailure(runDir, /basis/iu);
  });
});

test("rejects a Worker receipt that impersonates Codex evidence", async () => {
  await withFixture(async (runDir) => {
    const handoffPath = join(runDir, "handoffs", "task-ui.json");
    const handoff = await readJson(handoffPath);
    handoff.checks[0].evidenceRoleId = "codex";
    await writeJson(handoffPath, handoff);
    await expectValidationFailure(runDir, /not owned by the task reporter/iu);
  });
});

test("rejects a handoff changed after coordinator observation", async () => {
  await withFixture(async (runDir) => {
    const handoffPath = join(runDir, "handoffs", "task-ui.json");
    const handoff = await readJson(handoffPath);
    handoff.suggestedNextAction = "A later mutation must invalidate evidence.";
    await writeJson(handoffPath, handoff);
    await expectValidationFailure(runDir, /handoff digest does not match/iu);
  });
});

test("rejects invalid UTF-8 instead of hashing replacement text", async () => {
  await withFixture(async (runDir) => {
    const handoffPath = join(runDir, "handoffs", "task-ui.json");
    const handoff = await readJson(handoffPath);
    handoff.suggestedNextAction = "Validate replacement marker � safely.";
    await writeJson(handoffPath, handoff);
    await refreshObservationDigests(runDir);
    const bytes = await readFile(handoffPath);
    const marker = Buffer.from("�", "utf8");
    const markerOffset = bytes.indexOf(marker);
    assert.notEqual(markerOffset, -1);
    const invalid = Buffer.concat([
      bytes.subarray(0, markerOffset),
      Buffer.from([0xff]),
      bytes.subarray(markerOffset + marker.length),
    ]);
    await writeFile(handoffPath, invalid);
    await expectValidationFailure(runDir, /not valid UTF-8/iu);
  });
});

test("rejects accepted work without selected coordinator observations", async () => {
  await withFixture(async (runDir) => {
    const events = await readEvents(runDir);
    const accepted = events.find(
      (event) => event.eventId === "event-ui-accepted",
    );
    accepted.data.observations = [];
    accepted.data.observationDigests = {};
    await writeEvents(runDir, events);
    await expectValidationFailure(runDir, /coordinator observations/iu);
  });
});

test("rejects coordinator evidence observed after acceptance", async () => {
  await withFixture(async (runDir) => {
    const observationPath = join(
      runDir,
      "observations",
      "observation-ui-fixture.json",
    );
    const observation = await readJson(observationPath);
    observation.observedAt = "2026-08-03T00:09:00Z";
    await writeJson(observationPath, observation);
    const events = await readEvents(runDir);
    const accepted = events.find(
      (event) => event.eventId === "event-ui-accepted",
    );
    accepted.data.observationDigests["observation-ui-fixture"] =
      await sha256FileBytes(observationPath);
    await writeEvents(runDir, events);
    await expectValidationFailure(
      runDir,
      /outside its completion-to-acceptance window/iu,
    );
  });
});

test("rejects accepted work whose linked graph check failed", async () => {
  await withFixture(async (runDir) => {
    const graphPath = join(runDir, "graph.json");
    const graph = await readJson(graphPath);
    graph.nodes.find(
      (node) => node.id === "observation-ui-fixture",
    ).data.status = "failed";
    await writeJson(graphPath, graph);
    await expectValidationFailure(
      runDir,
      /(?:graph check.*inconsistent|acceptance check.*inconsistent|accepted.*failed|failed.*accepted)/iu,
    );
  });
});

test("rejects graph decision state that contradicts context", async () => {
  await withFixture(async (runDir) => {
    const graphPath = join(runDir, "graph.json");
    const graph = await readJson(graphPath);
    graph.nodes.find((node) => node.id === "decision-local-graph").data.status =
      "superseded";
    await writeJson(graphPath, graph);
    await expectValidationFailure(
      runDir,
      /graph decision node.*inconsistent with context/iu,
    );
  });
});

test("rejects graph model identity that contradicts roles", async () => {
  await withFixture(async (runDir) => {
    const graphPath = join(runDir, "graph.json");
    const graph = await readJson(graphPath);
    graph.nodes.find((node) => node.id === "model-kimi").data.modelId =
      "different-model";
    await writeJson(graphPath, graph);
    await expectValidationFailure(
      runDir,
      /graph model node.*inconsistent with roles/iu,
    );
  });
});

test("rejects graph edges with invalid endpoint semantics", async () => {
  await withFixture(async (runDir) => {
    const graphPath = join(runDir, "graph.json");
    const graph = await readJson(graphPath);
    graph.edges.find((edge) => edge.id === "edge-ui-file").type = "depends-on";
    await writeJson(graphPath, graph);
    await expectValidationFailure(
      runDir,
      /invalid task -> file endpoints for depends-on/iu,
    );
  });
});

test("rejects a passed observation that says the check was not executed", async () => {
  await withFixture(async (runDir) => {
    const observed = "The test was planned but not executed.";
    const observationPath = join(
      runDir,
      "observations",
      "observation-ui-fixture.json",
    );
    const observation = await readJson(observationPath);
    observation.command = null;
    observation.exitCode = null;
    observation.observed = observed;
    await writeJson(observationPath, observation);

    const graphPath = join(runDir, "graph.json");
    const graph = await readJson(graphPath);
    const graphObservation = graph.nodes.find(
      (node) => node.id === "observation-ui-fixture",
    );
    graphObservation.data.command = null;
    graphObservation.data.observed = observed;
    await writeJson(graphPath, graph);
    await expectValidationFailure(
      runDir,
      /describes unexecuted work as passed/iu,
    );
  });
});

const fakeJwt = [
  "eyJhbGciOiJub25lIn0",
  "eyJzdWIiOiJzeW50aGV0aWMtZml4dHVyZSJ9",
  "c3ludGhldGljLXNpZ25hdHVyZQ",
].join(".");
const fakeBearer = ["Bear", "er synthetic-fixture-token"].join("");

test("rejects Windows device names and alternate data streams", async (t) => {
  const unsafePaths = [
    "con.txt",
    "dir/PRN.md",
    "NUL.json",
    "COM1.log",
    "LPT9.anything",
    "CLOCK$",
    "CLOCK$.txt",
    "CONIN$",
    "CONOUT$.txt",
    "COM¹",
    "LPT².txt",
    "file.txt:stream",
    "file.txt::$DATA",
    "file.txt：stream",
    "C:relative.txt",
  ];
  for (const unsafePath of unsafePaths) {
    await t.test(unsafePath, async () => {
      await withFixture(async (runDir) => {
        const events = await readEvents(runDir);
        events.find(
          (event) => event.eventId === "event-ui-created",
        ).data.allowedPaths = [unsafePath];
        await writeEvents(runDir, events);
        await expectValidationFailure(runDir, /(?:unsafe|state schema)/iu);
      });
    });
  }
});

test("rejects secrets hidden behind two or three encoding layers", async (t) => {
  const encodedSecrets = [
    encodeURIComponent(encodeURIComponent(fakeBearer)),
    Buffer.from(Buffer.from(fakeBearer).toString("base64"), "utf8").toString(
      "base64",
    ),
    Buffer.from(encodeURIComponent(fakeBearer), "utf8").toString("base64"),
    encodeURIComponent(Buffer.from(fakeBearer, "utf8").toString("base64")),
    `${encodeURIComponent(fakeBearer)}%ZZ`,
    `encoded=${Buffer.from(fakeBearer, "utf8").toString("base64")}`,
    Buffer.from(
      Buffer.from(
        Buffer.from(fakeBearer, "utf8").toString("base64"),
        "utf8",
      ).toString("base64"),
      "utf8",
    ).toString("base64"),
    encodeURIComponent(`${"a".repeat(70_000)}${fakeBearer}`),
  ];
  for (const [index, encodedSecret] of encodedSecrets.entries()) {
    await t.test(`encoded-${index + 1}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "logion-agent-secret-"));
      try {
        await assert.rejects(
          () =>
            initializeRun({
              runId: `run-encoded-secret-${index + 1}`,
              objective: encodedSecret,
              baseCommit: currentCommit(),
              branch: "codex/fixture",
              runsRoot: root,
            }),
          /(?:bearer credential|safe scan budget)/iu,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("rejects private IPv6 addresses and generic credential URIs", async (t) => {
  const sensitiveTexts = [
    "Private node ::1",
    "Private node 0:0:0:0:0:0:0:1",
    "Private node fd12:3456::1",
    "Private node fe80::1%25synthetic-zone",
    "Mapped node ::ffff:10.0.0.1",
    "Mapped node ::ffff:c0a8:101",
    "Mapped node ::ffff:6440:1",
    "Mapped node ::ffff:7f00:1",
    String.raw`https:\\synthetic:fixture@example.com/repo`,
    "ssh://synthetic:fixture@example.com/repo",
    "postgresql://synthetic:fixture@example.com/database",
    "redis://synthetic-token@example.com/cache",
  ];
  for (const [index, sensitiveText] of sensitiveTexts.entries()) {
    await t.test(`sensitive-text-${index + 1}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "logion-agent-sensitive-"));
      try {
        await assert.rejects(
          () =>
            initializeRun({
              runId: `run-sensitive-text-${index + 1}`,
              objective: sensitiveText,
              baseCommit: currentCommit(),
              branch: "codex/fixture",
              runsRoot: root,
            }),
          /(?:private IPv6|private or Tailscale IP|URI-embedded credentials)/iu,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

const sensitiveStateCases = [
  ["clientSecret", "placeholder-value"],
  ["providerUrl", "https://relay.internal.invalid/v1"],
  ["terminalTranscript", "synthetic command output"],
  ["sessionEvidence", fakeJwt],
  ["authorization", fakeBearer],
];

test("rejects contract-forbidden sensitive context fields and values", async (t) => {
  for (const [key, value] of sensitiveStateCases) {
    await t.test(key, async () => {
      await withFixture(async (runDir) => {
        const contextPath = join(runDir, "context.json");
        const context = await readJson(contextPath);
        context.externalRefs = { [key]: value };
        await writeJson(contextPath, context);
        await expectValidationFailure(
          runDir,
          /(?:sensitive|forbidden|secret|provider|transcript|token|credential|authorization|JWT|Bearer)/iu,
        );
      });
    });
  }
});

test("rejects fields excluded by the tracked JSON Schema", async () => {
  await withFixture(async (runDir) => {
    const contextPath = join(runDir, "context.json");
    const context = await readJson(contextPath);
    context.undeclaredTopLevelField = "not part of the state contract";
    await writeJson(contextPath, context);
    await expectValidationFailure(
      runDir,
      /(?:additional|unexpected|undeclared|schema)/iu,
    );
  });
});

test("reports a null handoff as an AgentStateValidationError", async () => {
  await withFixture(async (runDir) => {
    await writeFile(join(runDir, "handoffs", "task-ui.json"), "null\n", "utf8");
    await expectValidationFailure(
      runDir,
      /(?:handoff.*object|invalid.*handoff|handoff.*invalid)/iu,
    );
  });
});

test("rejects contract-forbidden sensitive fields in current-run.json", async (t) => {
  await withPointerFixture(async ({ root, runsRoot, pointerPath }) => {
    for (const [key, value] of sensitiveStateCases) {
      await t.test(key, async () => {
        await writeJson(pointerPath, {
          schemaVersion: 1,
          runId: "run-minimal",
          path: "runs/run-minimal",
          [key]: value,
        });
        await assert.rejects(
          () =>
            resolveCurrentRun({
              pointerPath,
              pointerBase: root,
              runsRoot,
            }),
          (error) => {
            assert.ok(error instanceof AgentStateValidationError);
            assert.match(
              error.message,
              /(?:sensitive|forbidden|secret|provider|transcript|token|credential|authorization|JWT|Bearer|additional)/iu,
            );
            return true;
          },
        );
      });
    }
  });
});

test("rejects a current-run pointer whose runId disagrees with its path", async () => {
  await withPointerFixture(async ({ root, runsRoot, pointerPath }) => {
    await writeJson(pointerPath, {
      schemaVersion: 1,
      runId: "run-another",
      path: "runs/run-minimal",
    });
    await assert.rejects(
      () =>
        resolveCurrentRun({
          pointerPath,
          pointerBase: root,
          runsRoot,
        }),
      (error) => {
        assert.ok(error instanceof AgentStateValidationError);
        assert.match(error.message, /path.*runId/iu);
        return true;
      },
    );
  });
});

test("rejects a current-run pointer whose runId disagrees with context.json", async () => {
  await withPointerFixture(async ({ root, runsRoot, pointerPath }) => {
    const mismatchedRunDir = join(runsRoot, "run-another");
    await cp(fixture, mismatchedRunDir, { recursive: true });
    const contextPath = join(mismatchedRunDir, "context.json");
    const context = await readJson(contextPath);
    context.mode = "active";
    await writeJson(contextPath, context);
    await writeJson(pointerPath, {
      schemaVersion: 1,
      runId: "run-another",
      path: "runs/run-another",
    });
    await assert.rejects(
      () =>
        resolveCurrentRun({
          pointerPath,
          pointerBase: root,
          runsRoot,
        }),
      (error) => {
        assert.ok(error instanceof AgentStateValidationError);
        assert.match(error.message, /runId.*context\.json/iu);
        return true;
      },
    );
  });
});

test("normalizes a null current context into AgentStateValidationError", async () => {
  await withPointerFixture(async ({ root, runsRoot, runDir, pointerPath }) => {
    await writeJson(pointerPath, {
      schemaVersion: 1,
      runId: "run-minimal",
      path: "runs/run-minimal",
    });
    await writeJson(join(runDir, "context.json"), null);
    await assert.rejects(
      () => resolveCurrentRun({ pointerPath, pointerBase: root, runsRoot }),
      (error) => {
        assert.ok(error instanceof AgentStateValidationError);
        assert.match(error.message, /must contain an object/iu);
        return true;
      },
    );
  });
});

test("rejects symbolic links before reading current Run state", async (t) => {
  await t.test("pointer symlink", async (subtest) => {
    await withPointerFixture(async ({ root, runsRoot, pointerPath }) => {
      const targetPath = join(root, "pointer-target.json");
      await writeJson(targetPath, {
        schemaVersion: 1,
        runId: "run-minimal",
        path: "runs/run-minimal",
      });
      try {
        await symlink(targetPath, pointerPath, "file");
      } catch (error) {
        if (new Set(["EPERM", "EACCES"]).has(error?.code)) {
          subtest.skip("Symbolic links are unavailable in this environment");
          return;
        }
        throw error;
      }
      await assert.rejects(
        () => resolveCurrentRun({ pointerPath, pointerBase: root, runsRoot }),
        /symbolic link/iu,
      );
    });
  });

  await t.test("Run directory junction", async (subtest) => {
    await withPointerFixture(
      async ({ root, runsRoot, runDir, pointerPath }) => {
        await writeJson(pointerPath, {
          schemaVersion: 1,
          runId: "run-minimal",
          path: "runs/run-minimal",
        });
        const realRun = join(runsRoot, "real-run");
        await cp(runDir, realRun, { recursive: true });
        await rm(runDir, { recursive: true, force: true });
        try {
          await symlink(realRun, runDir, "junction");
        } catch (error) {
          if (new Set(["EPERM", "EACCES"]).has(error?.code)) {
            subtest.skip("Directory links are unavailable in this environment");
            return;
          }
          throw error;
        }
        await assert.rejects(
          () => resolveCurrentRun({ pointerPath, pointerBase: root, runsRoot }),
          /symbolic link/iu,
        );
      },
    );
  });

  await t.test("context symlink", async (subtest) => {
    await withPointerFixture(
      async ({ root, runsRoot, runDir, pointerPath }) => {
        await writeJson(pointerPath, {
          schemaVersion: 1,
          runId: "run-minimal",
          path: "runs/run-minimal",
        });
        const contextPath = join(runDir, "context.json");
        const targetPath = join(root, "context-target.json");
        await writeFile(
          targetPath,
          await readFile(contextPath, "utf8"),
          "utf8",
        );
        await rm(contextPath);
        try {
          await symlink(targetPath, contextPath, "file");
        } catch (error) {
          if (new Set(["EPERM", "EACCES"]).has(error?.code)) {
            subtest.skip("Symbolic links are unavailable in this environment");
            return;
          }
          throw error;
        }
        await assert.rejects(
          () => resolveCurrentRun({ pointerPath, pointerBase: root, runsRoot }),
          /symbolic link/iu,
        );
      },
    );
  });
});

test("refuses to replace a second active Run pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-active-run-"));
  const runsRoot = join(root, "runs");
  const pointerPath = join(root, "current-run.json");
  try {
    const baseCommit = currentCommit();
    await initializeRun({
      runId: "run-first-active",
      objective: "Keep the first active Run",
      baseCommit,
      branch: "codex/fixture",
      runsRoot,
      pointerPath,
      pointerBase: root,
    });

    let error;
    try {
      await initializeRun({
        runId: "run-second-active",
        objective: "Do not replace the first active Run",
        baseCommit,
        branch: "codex/fixture",
        runsRoot,
        pointerPath,
        pointerBase: root,
      });
    } catch (caught) {
      error = caught;
    }
    if (error) assert.match(error.message, /current Run pointer.*exists/iu);
    const pointer = await readJson(pointerPath);
    assert.deepEqual(
      {
        rejected: Boolean(error),
        pointerRunId: pointer.runId,
        secondRunExists: existsSync(join(runsRoot, "run-second-active")),
      },
      {
        rejected: true,
        pointerRunId: "run-first-active",
        secondRunExists: false,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unreachable base leaves neither a Run nor a current pointer", async () => {
  const root = await mkdtemp(join(tmpdir(), "logion-agent-invalid-base-"));
  const runsRoot = join(root, "runs");
  const pointerPath = join(root, "current-run.json");
  try {
    let error;
    try {
      await initializeRun({
        runId: "run-unreachable-base",
        objective: "Reject an unreachable base without residue",
        baseCommit: "0".repeat(40),
        branch: "codex/fixture",
        runsRoot,
        pointerPath,
        pointerBase: root,
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(
      error,
      "initialization unexpectedly accepted an unreachable base",
    );
    assert.match(error.message, /base commit.*not reachable/iu);
    assert.deepEqual(
      {
        runExists: existsSync(join(runsRoot, "run-unreachable-base")),
        pointerExists: existsSync(pointerPath),
        stagingEntries: existsSync(runsRoot)
          ? (await readdir(runsRoot)).filter((name) =>
              name.startsWith(".staging-"),
            )
          : [],
      },
      { runExists: false, pointerExists: false, stagingEntries: [] },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const windowsCollisionCases = [
  {
    name: "allowed path",
    options: {
      allowedPaths: ["APPS/WEB/SRC/COMPONENTS"],
      branch: "codex/fixture-deepseek-review",
      worktree: "macos-deepseek-review-fixture",
    },
    expected: /overlapping concurrent write paths/iu,
  },
  {
    name: "branch",
    options: {
      allowedPaths: [".python-version"],
      branch: "CODEX/FIXTURE-KIMI-UI",
      worktree: "macos-deepseek-review-fixture",
      useDisjointGraphFile: true,
    },
    expected: /same branch/iu,
  },
  {
    name: "worktree",
    options: {
      allowedPaths: [".python-version"],
      branch: "codex/fixture-deepseek-review",
      worktree: "MACOS-KIMI-UI-FIXTURE",
      useDisjointGraphFile: true,
    },
    expected: /same worktree/iu,
  },
];

test("rejects case-only Windows writer ownership collisions", async (t) => {
  for (const collision of windowsCollisionCases) {
    await t.test(collision.name, async () => {
      await withFixture(async (runDir) => {
        await configureConcurrentReviewWriter(runDir, collision.options);
        await expectValidationFailure(runDir, collision.expected);
      });
    });
  }
});

const invalidRetryReferences = [
  {
    name: "nonexistent event",
    retryOfEventId: "event-does-not-exist",
    expected: /does not reference this task's prior failed or rejected event/iu,
  },
  {
    name: "event from another task",
    retryOfEventId: "event-review-created",
    expected: /does not reference this task's prior failed or rejected event/iu,
  },
  {
    name: "non-terminal event from the same task",
    retryOfEventId: "event-ui-created",
    expected: /does not reference this task's prior failed or rejected event/iu,
  },
];

test("rejects invalid retry event references", async (t) => {
  for (const retryCase of invalidRetryReferences) {
    await t.test(retryCase.name, async () => {
      await withFixture(async (runDir) => {
        await configureRetryReference(runDir, retryCase.retryOfEventId);
        await expectValidationFailure(runDir, retryCase.expected);
      });
    });
  }
});

test("rejects a retry that references a stale earlier terminal event", async () => {
  await withFixture(async (runDir) => {
    const events = await readEvents(runDir);
    const firstFailure = events.find(
      (event) => event.eventId === "event-ui-completed",
    );
    firstFailure.eventId = "event-ui-first-failure";
    firstFailure.type = "task.failed";
    firstFailure.data = { reason: "First failed attempt" };

    const firstRetry = events.find(
      (event) => event.eventId === "event-ui-accepted",
    );
    firstRetry.eventId = "event-ui-first-retry";
    firstRetry.type = "task.retried";
    firstRetry.data = {
      retryOfEventId: "event-ui-first-failure",
      assigneeRoleId: "kimi",
    };

    events.push(
      {
        schemaVersion: 1,
        eventId: "event-ui-second-start",
        runId: firstRetry.runId,
        taskId: firstRetry.taskId,
        type: "task.started",
        at: "2026-08-03T00:08:10Z",
        baseCommit: firstRetry.baseCommit,
        actorRoleId: "kimi",
        data: {},
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-second-failure",
        runId: firstRetry.runId,
        taskId: firstRetry.taskId,
        type: "task.failed",
        at: "2026-08-03T00:08:20Z",
        baseCommit: firstRetry.baseCommit,
        actorRoleId: "kimi",
        data: { reason: "Second failed attempt" },
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-stale-retry",
        runId: firstRetry.runId,
        taskId: firstRetry.taskId,
        type: "task.retried",
        at: "2026-08-03T00:08:30Z",
        baseCommit: firstRetry.baseCommit,
        actorRoleId: "codex",
        data: {
          retryOfEventId: "event-ui-first-failure",
          assigneeRoleId: "kimi",
        },
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-final-start",
        runId: firstRetry.runId,
        taskId: firstRetry.taskId,
        type: "task.started",
        at: "2026-08-03T00:08:40Z",
        baseCommit: firstRetry.baseCommit,
        actorRoleId: "kimi",
        data: {},
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-final-completion",
        runId: firstRetry.runId,
        taskId: firstRetry.taskId,
        type: "task.completed",
        at: "2026-08-03T00:08:50Z",
        baseCommit: firstRetry.baseCommit,
        actorRoleId: "kimi",
        data: { handoff: "handoffs/task-ui.json" },
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-final-acceptance",
        runId: firstRetry.runId,
        taskId: firstRetry.taskId,
        type: "task.accepted",
        at: "2026-08-03T00:08:55Z",
        baseCommit: firstRetry.baseCommit,
        actorRoleId: "codex",
        data: { basis: ["check-ui-fixture"] },
      },
    );
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    await writeEvents(runDir, events);
    await expectValidationFailure(
      runDir,
      /does not reference this task's latest failed or rejected event/iu,
    );
  });
});

test("rejects a completed event with a null handoff reference", async () => {
  await withFixture(async (runDir) => {
    const events = await readEvents(runDir);
    events.find(
      (event) => event.eventId === "event-ui-completed",
    ).data.handoff = null;
    await writeEvents(runDir, events);
    await expectValidationFailure(
      runDir,
      /(?:unsafe handoff path|handoff.*required|handoff.*string)/iu,
    );
  });
});

test("rejects self-declared fixture mode outside the tracked fixture root", async () => {
  await withFixture(async (runDir) => {
    const contextPath = join(runDir, "context.json");
    const context = await readJson(contextPath);
    context.mode = "fixture";
    await writeJson(contextPath, context);
    await replaceBaseCommit(runDir, "0".repeat(40));
    await expectValidationFailure(
      runDir,
      /fixture mode.*tracked coordination fixtures root/iu,
    );
  });
});

test("preserves distinct receipts across completed, rejected, retried, and completed", async () => {
  await withFixture(async (runDir) => {
    const events = await readEvents(runDir);
    const accepted = events.find(
      (event) => event.eventId === "event-ui-accepted",
    );
    accepted.data = {
      basis: ["criterion-ui-fixture"],
      observations: ["observation-ui-fixture-retry"],
      observationDigests: {},
    };
    events.push(
      {
        schemaVersion: 1,
        eventId: "event-ui-rejected",
        runId: accepted.runId,
        taskId: accepted.taskId,
        type: "task.rejected",
        at: "2026-08-03T00:06:20Z",
        baseCommit: accepted.baseCommit,
        actorRoleId: "codex",
        data: {
          basis: ["criterion-ui-fixture"],
          reason: "The first acceptance attempt failed.",
        },
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-retried",
        runId: accepted.runId,
        taskId: accepted.taskId,
        type: "task.retried",
        at: "2026-08-03T00:06:30Z",
        baseCommit: accepted.baseCommit,
        actorRoleId: "codex",
        data: {
          retryOfEventId: "event-ui-rejected",
          assigneeRoleId: "kimi",
        },
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-restarted",
        runId: accepted.runId,
        taskId: accepted.taskId,
        type: "task.started",
        at: "2026-08-03T00:06:40Z",
        baseCommit: accepted.baseCommit,
        actorRoleId: "kimi",
        data: {},
      },
      {
        schemaVersion: 1,
        eventId: "event-ui-recompleted",
        runId: accepted.runId,
        taskId: accepted.taskId,
        type: "task.completed",
        at: "2026-08-03T00:07:00Z",
        baseCommit: accepted.baseCommit,
        actorRoleId: "kimi",
        data: { handoff: "handoffs/task-ui-retry.json" },
      },
    );
    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    await writeEvents(runDir, events);

    const firstHandoffPath = join(runDir, "handoffs", "task-ui.json");
    const firstHandoff = await readJson(firstHandoffPath);
    firstHandoff.outcome = "failed";
    firstHandoff.checks[0].status = "failed";
    firstHandoff.checks[0].observed =
      "Worker diff check reported a failure on attempt one.";
    await writeJson(firstHandoffPath, firstHandoff);

    const coordinatorCommand =
      "pnpm agent:state:validate -- .agents/coordination/fixtures/minimal-run";
    const firstCoordinatorObserved =
      "Coordinator fixture validation exited with a failure on attempt one.";
    const retryCoordinatorObserved =
      "Coordinator fixture validation exited successfully on attempt two.";
    const retryHandoff = {
      ...firstHandoff,
      handoffId: "handoff-ui-retry",
      outcome: "succeeded",
      commandsActuallyRun: ["git diff --check"],
      checks: [
        {
          id: "worker-check-ui-retry",
          name: "Worker diff check retry",
          status: "passed",
          command: "git diff --check",
          observed: "Worker diff check passed on attempt two.",
          evidenceRoleId: "kimi",
          acceptanceCheckId: null,
        },
      ],
      knownRisks: ["This receipt belongs only to the second attempt."],
      suggestedNextAction: "Accept only the second completion receipt.",
    };
    await writeJson(
      join(runDir, "handoffs", "task-ui-retry.json"),
      retryHandoff,
    );
    const firstDigest = await sha256FileBytes(firstHandoffPath);
    const retryDigest = await sha256FileBytes(
      join(runDir, "handoffs", "task-ui-retry.json"),
    );

    const firstObservationPath = join(
      runDir,
      "observations",
      "observation-ui-fixture.json",
    );
    const firstObservation = await readJson(firstObservationPath);
    Object.assign(firstObservation, {
      handoffSha256: firstDigest,
      status: "failed",
      command: coordinatorCommand,
      exitCode: 1,
      observed: firstCoordinatorObserved,
      reason: "The first coordinator acceptance check failed.",
    });
    await writeJson(firstObservationPath, firstObservation);

    const retryObservation = {
      schemaVersion: 1,
      observationId: "observation-ui-fixture-retry",
      taskId: "task-ui",
      completionEventId: "event-ui-recompleted",
      handoff: "handoffs/task-ui-retry.json",
      handoffSha256: retryDigest,
      acceptanceCheckId: "criterion-ui-fixture",
      name: "Coordinator fixture validation retry",
      status: "passed",
      command: coordinatorCommand,
      exitCode: 0,
      observed: retryCoordinatorObserved,
      reason: null,
      observedAt: "2026-08-03T00:07:30Z",
      observerRoleId: "codex",
    };
    await writeJson(
      join(runDir, "observations", "observation-ui-fixture-retry.json"),
      retryObservation,
    );
    accepted.data.observationDigests = {
      "observation-ui-fixture-retry": await sha256FileBytes(
        join(runDir, "observations", "observation-ui-fixture-retry.json"),
      ),
    };
    await writeEvents(runDir, events);

    const graphPath = join(runDir, "graph.json");
    const graph = await readJson(graphPath);
    const firstCheck = graph.nodes.find(
      (node) => node.id === "observation-ui-fixture",
    );
    firstCheck.data.status = "failed";
    firstCheck.data.observed = firstCoordinatorObserved;
    firstCheck.data.handoffSha256 = firstDigest;
    graph.nodes.push(
      {
        id: "handoff-ui-retry",
        type: "handoff",
        label: "UI retry handoff",
        data: { path: "handoffs/task-ui-retry.json" },
      },
      {
        id: "observation-ui-fixture-retry",
        type: "check",
        label: "Coordinator fixture validation retry",
        data: {
          status: "passed",
          command: coordinatorCommand,
          observed: retryCoordinatorObserved,
          evidenceRoleId: "codex",
          acceptanceCheckId: "criterion-ui-fixture",
          observationPath: "observations/observation-ui-fixture-retry.json",
          completionEventId: "event-ui-recompleted",
          handoffSha256: retryDigest,
        },
      },
    );
    graph.edges.push(
      {
        id: "edge-ui-retry-handoff",
        from: "task-ui",
        to: "handoff-ui-retry",
        type: "reported-by",
      },
      {
        id: "edge-ui-retry-check",
        from: "task-ui",
        to: "observation-ui-fixture-retry",
        type: "verified-by",
      },
    );
    await writeJson(graphPath, graph);

    const result = await validateRun(runDir);
    assert.equal(result.taskStates["task-ui"], "accepted");
    assert.equal(result.handoffCount, 3);
    assert.equal(result.observationCount, 3);

    const staleEvents = await readEvents(runDir);
    const finalAcceptance = staleEvents.find(
      (event) => event.eventId === "event-ui-accepted",
    );
    finalAcceptance.data.observations = ["observation-ui-fixture"];
    finalAcceptance.data.observationDigests = {
      "observation-ui-fixture": await sha256FileBytes(firstObservationPath),
    };
    await writeEvents(runDir, staleEvents);
    await expectValidationFailure(
      runDir,
      /invalid coordinator observation observation-ui-fixture/iu,
    );
  });
});

test("rejects unsupported Run files instead of leaving them outside secret scanning", async (t) => {
  const fakeToken = ["sk", "proj", "syntheticfixturetoken123456"].join("-");
  await t.test("unknown root file", async () => {
    await withFixture(async (runDir) => {
      await writeFile(join(runDir, "debug.log"), fakeToken, "utf8");
      await expectValidationFailure(
        runDir,
        /Run directory contains an unsupported entry/iu,
      );
    });
  });
  await t.test("uppercase handoff extension", async () => {
    await withFixture(async (runDir) => {
      await writeFile(
        join(runDir, "handoffs", "secret.JSON"),
        fakeToken,
        "utf8",
      );
      await expectValidationFailure(
        runDir,
        /handoffs contains an unsupported entry/iu,
      );
    });
  });
});

test("reports malformed collection fields as AgentStateValidationError", async (t) => {
  await t.test("context actors object", async () => {
    await withFixture(async (runDir) => {
      const path = join(runDir, "context.json");
      const context = await readJson(path);
      context.actors = {};
      await writeJson(path, context);
      await expectValidationFailure(runDir, /context\.actors|must be array/iu);
    });
  });
  await t.test("handoff unrunChecks object", async () => {
    await withFixture(async (runDir) => {
      const path = join(runDir, "handoffs", "task-ui.json");
      const handoff = await readJson(path);
      handoff.unrunChecks = {};
      await writeJson(path, handoff);
      await expectValidationFailure(runDir, /unrunChecks|must be array/iu);
    });
  });
});

test("keeps Worker not-run checks in the dedicated unrunChecks collection", async () => {
  await withFixture(async (runDir) => {
    const handoffPath = join(runDir, "handoffs", "task-ui.json");
    const handoff = await readJson(handoffPath);
    handoff.checks[0].status = "not_run";
    handoff.checks[0].reason = "Synthetic unavailable check";
    await writeJson(handoffPath, handoff);
    await refreshObservationDigests(runDir);
    await expectValidationFailure(
      runDir,
      /(?:checks\[0\].*invalid status|state schema)/iu,
    );
  });
});

test("rejects duplicate Worker unrun-check names", async () => {
  await withFixture(async (runDir) => {
    const handoffPath = join(runDir, "handoffs", "task-ui.json");
    const handoff = await readJson(handoffPath);
    handoff.unrunChecks.push({ ...handoff.unrunChecks[0] });
    await writeJson(handoffPath, handoff);
    await refreshObservationDigests(runDir);
    await expectValidationFailure(runDir, /unrunChecks repeats/iu);
  });
});
