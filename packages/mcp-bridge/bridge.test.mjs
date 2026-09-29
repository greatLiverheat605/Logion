import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callRest, config, requestFor } from "./rest.mjs";
import { exportSkills, names } from "./export-skills.mjs";

const token = () =>
  `logion_pat_${randomUUID().replaceAll("-", "")}_${randomBytes(32).toString("base64url")}`;
async function fixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return { base: `http://127.0.0.1:${server.address().port}`, token: token() };
}
function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

test("configuration rejects transport/credential ambiguity and non-loopback HTTP", () => {
  const valid = {
    LOGION_MCP_BASE_URL: "https://example.com",
    LOGION_AGENT_TOKEN: token(),
  };
  assert.equal(config(valid).base, "https://example.com");
  for (const url of [
    "http://example.com",
    "https://example.com/path",
    "https://example.com?q=x",
    "https://example.com#x",
    "https://user:password@example.com",
    "file:///tmp/example",
    "http://127.0.0.1",
  ]) {
    assert.throws(
      () => config({ ...valid, LOGION_MCP_BASE_URL: url }),
      /AGENT_CONFIGURATION_INVALID/,
    );
  }
  assert.equal(
    config({
      ...valid,
      LOGION_MCP_BASE_URL: "http://127.0.0.1:1234",
      LOGION_MCP_ALLOW_LOOPBACK_HTTP: "1",
    }).base,
    "http://127.0.0.1:1234",
  );
  assert.throws(
    () => config({ ...valid, LOGION_AGENT_TOKEN: "invalid" }),
    /AGENT_CONFIGURATION_INVALID/,
  );
});

test("fixed routes reject idea endpoints, writable locators, unbounded and unknown arguments", () => {
  for (const [name, args] of [
    ["read_context", { entity_type: "research_idea", entity_id: randomUUID() }],
    ["delete_resource", { resource_id: randomUUID() }],
    ["search_literature", { url: "https://example.com" }],
    ["search_literature", { limit: 21 }],
    ["read_literature", { resource_id: "../../ideas" }],
    [
      "submit_inbox",
      {
        submission_key: "test",
        payload: { kind: "source", title: "x", file_locator: {} },
      },
    ],
    [
      "submit_inbox",
      {
        submission_key: "test",
        payload: {
          kind: "edge",
          from_type: "idea",
          from_id: randomUUID(),
          to_type: "resource",
          to_id: randomUUID(),
          relation: "supports",
        },
      },
    ],
    [
      "submit_inbox",
      {
        submission_key: "test",
        payload: {
          kind: "report",
          title: "x",
          markdown_body: "文".repeat(24000),
        },
      },
    ],
  ])
    assert.throws(() => requestFor(name, args), /AGENT_ARGUMENT_INVALID/);
});

test("stdio exposes bounded tools and sends PAT only to fixed REST paths", async (t) => {
  const requests = [];
  const configuration = await fixture(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      url: req.url,
      method: req.method,
      authorized: req.headers.authorization === `Bearer ${configuration.token}`,
      body: body ? JSON.parse(body) : null,
    });
    json(res, { items: [], receipt: "synthetic-only" });
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("server.mjs", import.meta.url))],
    env: {
      LOGION_MCP_BASE_URL: configuration.base,
      LOGION_AGENT_TOKEN: configuration.token,
      LOGION_MCP_ALLOW_LOOPBACK_HTTP: "1",
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const client = new Client({ name: "synthetic-test", version: "1.0" });
  t.after(() => client.close());
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 7);
  assert(!JSON.stringify(listed).includes(configuration.token));
  const identity = randomUUID();
  const cases = [
    [
      "search_literature",
      { query: "paper & evidence", limit: 2 },
      "/api/v1/agent/resources?limit=2&q=paper+%26+evidence",
    ],
    [
      "read_literature",
      { resource_id: identity },
      `/api/v1/agent/entities/resource/${identity}`,
    ],
    [
      "read_excerpts",
      { resource_id: identity },
      `/api/v1/agent/resources/${identity}/excerpts`,
    ],
    ["list_research_questions", {}, "/api/v1/agent/entities/research_question"],
    ["list_concepts", {}, "/api/v1/agent/entities/topic"],
    [
      "read_context",
      { entity_type: "note", entity_id: identity },
      `/api/v1/agent/entities/note/${identity}`,
    ],
    [
      "submit_inbox",
      {
        submission_key: "test",
        payload: { kind: "source", title: "Synthetic source" },
      },
      "/api/v1/agent/inbox",
    ],
  ];
  for (const [name, args, path] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    assert.equal(requests.at(-1).url, path);
    assert(requests.at(-1).authorized);
  }
  assert.equal(requests.at(-1).method, "POST");
  assert.equal(requests.at(-1).body.payload.title, "Synthetic source");
  const blocked = await client.callTool({
    name: "read_context",
    arguments: { entity_type: "research_idea", entity_id: identity },
  });
  assert.equal(blocked.isError, true);
  assert.equal(requests.length, 7);
  await client.close();
  assert.equal(stderr, "");
});

test("HTTP failures are redacted and never retried", async (t) => {
  let calls = 0;
  const configuration = await fixture(t, (req, res) => {
    calls++;
    json(res, { secret: "must-not-escape", token: configuration.token }, 401);
  });
  await assert.rejects(callRest(configuration, "search_literature", {}), {
    message: "AGENT_HTTP_401",
  });
  assert.equal(calls, 1);
});

test("redirects cannot forward authorization", async (t) => {
  let destinationCalls = 0;
  const destination = await fixture(t, (req, res) => {
    destinationCalls++;
    json(res, {});
  });
  const configuration = await fixture(t, (req, res) => {
    res.writeHead(302, { location: destination.base });
    res.end();
  });
  await assert.rejects(callRest(configuration, "search_literature", {}), {
    message: "AGENT_CONNECTION_FAILED",
  });
  assert.equal(destinationCalls, 0);
});

test("streaming response bounds and JSON validation fail closed", async (t) => {
  for (const mode of ["stream", "length", "html", "malformed"]) {
    const configuration = await fixture(t, (req, res) => {
      if (mode === "html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html>private</html>");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        ...(mode === "length" ? { "content-length": 600000 } : {}),
      });
      if (mode === "stream") {
        res.write('{"text":"');
        res.end("x".repeat(600000) + '"}');
      } else res.end("not json");
    });
    await assert.rejects(callRest(configuration, "search_literature", {}), {
      message:
        mode === "stream" || mode === "length"
          ? "AGENT_RESPONSE_TOO_LARGE"
          : "AGENT_RESPONSE_INVALID",
    });
  }
});

test("export uses server source bytes, is discoverable, and refuses overwrite", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "logion-skills-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const destination = join(dir, "export");
  const hashes = await exportSkills(destination);
  assert.deepEqual(
    Object.keys(hashes),
    names.map((name) => `${name}/SKILL.md`),
  );
  for (const name of names) {
    const original = await readFile(
      new URL(`../skills/${name}/SKILL.md`, import.meta.url),
    );
    const exported = await readFile(join(destination, name, "SKILL.md"));
    assert.deepEqual(exported, original);
    assert.equal(
      hashes[`${name}/SKILL.md`],
      createHash("sha256").update(original).digest("hex"),
    );
    assert.match(
      exported.toString(),
      new RegExp(`^---\nname: ${name}\ndescription: .+\n---\n`),
    );
  }
  assert.deepEqual(
    JSON.parse(
      await readFile(join(destination, "logion-skills.sha256.json"), "utf8"),
    ),
    hashes,
  );
  await writeFile(join(destination, "owner.txt"), "preserve", "utf8");
  await assert.rejects(exportSkills(destination), { code: "EEXIST" });
  assert.equal(
    await readFile(join(destination, "owner.txt"), "utf8"),
    "preserve",
  );
  assert.equal((await readdir(destination)).length, 8);
});
