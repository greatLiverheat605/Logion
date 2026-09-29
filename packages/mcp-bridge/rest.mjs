const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_SUBMISSION_BYTES = 65536;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = [
  "resource",
  "source_text",
  "source_excerpt",
  "note",
  "research_question",
  "topic",
  "research_claim",
];
export class BridgeError extends Error {}
const invalid = () => {
  throw new BridgeError("AGENT_ARGUMENT_INVALID");
};
const id = (value) =>
  typeof value === "string" && uuid.test(value) ? value : invalid();
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value;
}
function keys(value, allowed) {
  object(value);
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function page(args) {
  const result = {};
  if (args.cursor !== undefined) result.cursor = id(args.cursor);
  if (args.limit !== undefined) {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20)
      invalid();
    result.limit = args.limit;
  }
  return result;
}
export function config(env) {
  let base;
  try {
    base = new URL(env.LOGION_MCP_BASE_URL);
  } catch {
    throw new BridgeError("AGENT_CONFIGURATION_INVALID");
  }
  const local = ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        local &&
        env.LOGION_MCP_ALLOW_LOOPBACK_HTTP === "1")
    )
  )
    throw new BridgeError("AGENT_CONFIGURATION_INVALID");
  const token = env.LOGION_AGENT_TOKEN;
  if (
    typeof token !== "string" ||
    !/^logion_pat_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/.test(token)
  )
    throw new BridgeError("AGENT_CONFIGURATION_INVALID");
  return { base: base.origin, token };
}
export function requestFor(name, input) {
  const args = object(input);
  if (name === "search_literature") {
    keys(args, ["query", "cursor", "limit"]);
    if (
      args.query !== undefined &&
      (typeof args.query !== "string" || args.query.length > 200)
    )
      invalid();
    return {
      path: "/api/v1/agent/resources",
      query: {
        ...page(args),
        ...(args.query !== undefined ? { q: args.query } : {}),
      },
    };
  }
  if (name === "read_literature") {
    keys(args, ["resource_id"]);
    return { path: `/api/v1/agent/entities/resource/${id(args.resource_id)}` };
  }
  if (name === "read_excerpts") {
    keys(args, ["resource_id", "cursor", "limit"]);
    return {
      path: `/api/v1/agent/resources/${id(args.resource_id)}/excerpts`,
      query: page(args),
    };
  }
  if (name === "list_research_questions" || name === "list_concepts") {
    keys(args, ["cursor", "limit"]);
    return {
      path: `/api/v1/agent/entities/${name === "list_concepts" ? "topic" : "research_question"}`,
      query: page(args),
    };
  }
  if (name === "read_context") {
    keys(args, ["entity_type", "entity_id"]);
    if (!kinds.includes(args.entity_type)) invalid();
    return {
      path: `/api/v1/agent/entities/${args.entity_type}/${id(args.entity_id)}`,
    };
  }
  if (name === "submit_inbox") {
    keys(args, ["submission_key", "payload"]);
    if (
      typeof args.submission_key !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(args.submission_key)
    )
      invalid();
    const payload = object(args.payload);
    const fields = {
      source: [
        "kind",
        "title",
        "resource_type",
        "source_url",
        "csl",
        "doi",
        "arxiv_id",
        "pmid",
        "citation_key",
      ],
      report: ["kind", "title", "markdown_body"],
      summary: ["kind", "title", "markdown_body"],
      edge: [
        "kind",
        "from_type",
        "from_id",
        "to_type",
        "to_id",
        "relation",
        "reason",
        "evidence_excerpt_id",
      ],
    };
    if (!Object.hasOwn(fields, payload.kind)) invalid();
    keys(payload, fields[payload.kind]);
    if (payload.kind === "edge") {
      if (
        !["resource", "claim"].includes(payload.from_type) ||
        !["resource", "question", "topic"].includes(payload.to_type)
      )
        invalid();
      id(payload.from_id);
      id(payload.to_id);
      if (payload.evidence_excerpt_id != null) id(payload.evidence_excerpt_id);
    } else if (typeof payload.title !== "string" || !payload.title.trim())
      invalid();
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_SUBMISSION_BYTES)
      invalid();
    return { path: "/api/v1/agent/inbox", body: args };
  }
  invalid();
}
export async function callRest(configuration, name, args) {
  const request = requestFor(name, args);
  const url = new URL(request.path, configuration.base);
  for (const [key, value] of Object.entries(request.query ?? {}))
    url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: request.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${configuration.token}`,
        Accept: "application/json",
        ...(request.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new BridgeError(`AGENT_HTTP_${response.status}`);
    }
    if (
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      await response.body?.cancel();
      throw new BridgeError("AGENT_RESPONSE_INVALID");
    }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new BridgeError("AGENT_RESPONSE_TOO_LARGE");
    }
    const chunks = [];
    let size = 0;
    if (!response.body) throw new BridgeError("AGENT_RESPONSE_INVALID");
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        controller.abort();
        throw new BridgeError("AGENT_RESPONSE_TOO_LARGE");
      }
      chunks.push(chunk);
    }
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new BridgeError("AGENT_RESPONSE_INVALID");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new BridgeError("AGENT_RESPONSE_INVALID");
    return value;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError("AGENT_CONNECTION_FAILED");
  } finally {
    clearTimeout(timer);
  }
}
