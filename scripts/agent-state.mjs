import Ajv2020 from "ajv/dist/2020.js";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync, readFileSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const coordinationRoot = join(repoRoot, ".agents", "coordination");
const defaultRunsRoot = join(coordinationRoot, "runs");
const defaultPointerPath = join(coordinationRoot, "current-run.json");
const fixturesRoot = join(coordinationRoot, "fixtures");
const rolesPath = join(coordinationRoot, "roles.json");
const stateSchemaPath = join(coordinationRoot, "state.schema.json");

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const stateSchemaRawBytes = readFileSync(stateSchemaPath);
const stateSchema = parseJsonText(
  decodeStrictUtf8(stateSchemaRawBytes, "state.schema.json"),
  "state.schema.json",
);
const schemaValidator = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
});
schemaValidator.addSchema(stateSchema);
const schemaDefinitionValidators = new Map();

const stableIdPattern = /^[a-z]+-[a-z0-9][a-z0-9-]*$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const stateFilePattern = /^[a-z]+-[a-z0-9][a-z0-9-]*\.json$/u;
const transactionIdPattern = /^tx-[a-f0-9]{32}$/u;
const initializationFailpointExitCode = 86;
const eventTypes = new Set([
  "task.created",
  "task.assigned",
  "task.started",
  "task.blocked",
  "task.resumed",
  "task.completed",
  "task.failed",
  "task.retried",
  "task.accepted",
  "task.rejected",
]);
const graphNodeTypes = new Set([
  "run",
  "requirement",
  "invariant",
  "decision",
  "question",
  "task",
  "file",
  "commit",
  "check",
  "handoff",
  "model",
]);
const graphEdgeTypes = new Set([
  "includes",
  "constrains",
  "authorizes",
  "implements",
  "touches",
  "produces",
  "verified-by",
  "reported-by",
  "depends-on",
  "decided-by",
  "uses-model",
]);
const sensitiveKeys = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "password",
  "secret",
  "sshprivatekey",
  "pairingcode",
  "dispatchcapability",
  "databaseurl",
  "providerendpoint",
  "terminalhandle",
]);
const sensitiveKeyFragments = [
  "authorization",
  "baseurl",
  "bearer",
  "clientsecret",
  "credential",
  "databaseurl",
  "dispatchcapability",
  "hostname",
  "hostip",
  "password",
  "privatekey",
  "providerendpoint",
  "providerurl",
  "secret",
  "sshkey",
  "terminalhandle",
  "terminaltranscript",
  "token",
];
const contextExternalRefRules = new Map([["orcaRunId", /^run_[a-f0-9]+$/u]]);
const handoffExternalRefRules = new Map([
  ["orcaTaskId", /^task_[a-f0-9]+$/u],
  ["orcaDispatchId", /^ctx_[a-f0-9]+$/u],
  ["orcaMessageId", /^msg_[a-f0-9]+$/u],
]);
const allowedExampleDomains = new Set([
  "example.com",
  "example.net",
  "example.org",
]);

export class AgentStateValidationError extends Error {
  constructor(errors) {
    super(`Agent state validation failed:\n- ${errors.join("\n- ")}`);
    this.name = "AgentStateValidationError";
    this.errors = errors;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function validateSchemaDefinition(name, value, label, errors) {
  if (!stateSchema.$defs?.[name]) {
    errors.push(`state.schema.json is missing $defs.${name}`);
    return;
  }
  let validate = schemaDefinitionValidators.get(name);
  if (!validate) {
    validate = schemaValidator.compile({
      $ref: `${stateSchema.$id}#/$defs/${name}`,
    });
    schemaDefinitionValidators.set(name, validate);
  }
  if (validate(value)) return;
  for (const issue of validate.errors ?? []) {
    const location = issue.instancePath || "$";
    errors.push(
      `${label} violates state schema at ${location}: ${issue.message}`,
    );
  }
}

function normalizeKey(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replaceAll(/\/+$/gu, "");
}

function canonicalIdentifier(value) {
  return String(value)
    .normalize("NFKC")
    .replaceAll("\\", "/")
    .replaceAll(/\/+$/gu, "")
    .split("/")
    .map((segment) => segment.replaceAll(/[ .]+$/gu, ""))
    .join("/")
    .toLowerCase();
}

function canonicalPath(value) {
  return normalizePath(String(value).normalize("NFKC"))
    .split("/")
    .map((segment) => segment.replaceAll(/[ .]+$/gu, "").toLowerCase())
    .join("/");
}

function isWindowsDeviceSegment(segment) {
  const normalized = String(segment)
    .normalize("NFKC")
    .replaceAll(/[ .]+$/gu, "");
  const baseName = normalized
    .split(".", 1)[0]
    .replaceAll(/[ .]+$/gu, "")
    .toLowerCase();
  return /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9]|lpt[1-9])$/u.test(
    baseName,
  );
}

function isRelativeSafePath(value) {
  const normalizedValue =
    typeof value === "string" ? value.normalize("NFKC") : value;
  if (
    typeof normalizedValue !== "string" ||
    normalizedValue.length === 0 ||
    normalizedValue.includes(":") ||
    isAbsolute(normalizedValue) ||
    /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(normalizedValue)
  ) {
    return false;
  }
  const normalized = normalizePath(normalizedValue);
  return !normalized
    .split("/")
    .some(
      (segment) =>
        segment === ".." ||
        segment === "" ||
        segment === "." ||
        segment !== segment.replaceAll(/[ .]+$/gu, "") ||
        isWindowsDeviceSegment(segment),
    );
}

function resolvesInside(root, candidate) {
  const relativeResult = relative(resolve(root), resolve(root, candidate));
  return (
    relativeResult !== "" &&
    relativeResult !== ".." &&
    !relativeResult.startsWith(`..\\`) &&
    !relativeResult.startsWith("../") &&
    !isAbsolute(relativeResult)
  );
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d{1,9})?(?:Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u.exec(
      value,
    );
  if (!match?.groups) return false;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  const offsetHour = Number(match.groups.offsetHour ?? 0);
  const offsetMinute = Number(match.groups.offsetMinute ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function pathOverlaps(left, right) {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function pathWithin(candidate, allowedRoot) {
  const path = canonicalPath(candidate);
  const root = canonicalPath(allowedRoot);
  return path === root || path.startsWith(`${root}/`);
}

function intervalsOverlap(left, right) {
  const leftEnd = left.end ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.end ?? Number.POSITIVE_INFINITY;
  return left.start < rightEnd && right.start < leftEnd;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function decodeStrictUtf8(rawBytes, label) {
  try {
    return strictUtf8Decoder.decode(rawBytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function sameFileIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameFileVersion(left, right) {
  return (
    sameFileIdentity(left, right) &&
    left?.size === right?.size &&
    left?.mtimeNs === right?.mtimeNs &&
    left?.ctimeNs === right?.ctimeNs
  );
}

async function readRegularFileBytes(path, label, expectedRootReal = null) {
  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(path, flags);
    const openedStat = await handle.stat({ bigint: true });
    if (!openedStat.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    const pathStat = await lstat(path, { bigint: true });
    if (
      !pathStat.isFile() ||
      pathStat.isSymbolicLink() ||
      !sameFileIdentity(openedStat, pathStat)
    ) {
      throw new Error(
        `${label} changed identity or resolved through a symbolic link`,
      );
    }
    const pathReal = await realpath(path);
    if (expectedRootReal && !realPathWithin(expectedRootReal, pathReal)) {
      throw new Error(`${label} escapes its expected real root`);
    }
    const rawBytes = await handle.readFile();
    const [closedOverStat, finalPathStat] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      !finalPathStat.isFile() ||
      finalPathStat.isSymbolicLink() ||
      !sameFileVersion(openedStat, closedOverStat) ||
      !sameFileIdentity(closedOverStat, finalPathStat)
    ) {
      throw new Error(`${label} changed while it was being read`);
    }
    return rawBytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} is missing or unreadable`);
  } finally {
    await handle?.close();
  }
}

async function readUtf8FileStrict(path, label, expectedRootReal = null) {
  const rawBytes = await readRegularFileBytes(path, label, expectedRootReal);
  return { rawBytes, raw: decodeStrictUtf8(rawBytes, label) };
}

function findDuplicateJsonKeys(raw) {
  let offset = 0;
  const duplicates = [];
  const skipWhitespace = () => {
    while (/\s/u.test(raw[offset] ?? "")) offset += 1;
  };
  const readString = () => {
    const start = offset;
    offset += 1;
    while (offset < raw.length) {
      if (raw[offset] === "\\") {
        offset += 2;
      } else if (raw[offset] === '"') {
        offset += 1;
        return JSON.parse(raw.slice(start, offset));
      } else {
        offset += 1;
      }
    }
    return "";
  };
  const parseValue = (path) => {
    skipWhitespace();
    if (raw[offset] === "{") {
      offset += 1;
      const keys = new Set();
      skipWhitespace();
      if (raw[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        skipWhitespace();
        const key = readString();
        const childPath = `${path}.${key}`;
        if (keys.has(key)) duplicates.push(childPath);
        keys.add(key);
        skipWhitespace();
        offset += 1;
        parseValue(childPath);
        skipWhitespace();
        if (raw[offset] === "}") {
          offset += 1;
          return;
        }
        offset += 1;
      }
      return;
    }
    if (raw[offset] === "[") {
      offset += 1;
      let index = 0;
      skipWhitespace();
      if (raw[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        parseValue(`${path}[${index}]`);
        index += 1;
        skipWhitespace();
        if (raw[offset] === "]") {
          offset += 1;
          return;
        }
        offset += 1;
      }
      return;
    }
    if (raw[offset] === '"') {
      readString();
      return;
    }
    while (offset < raw.length && !/[\s,\]}]/u.test(raw[offset])) offset += 1;
  };
  parseValue("$");
  return duplicates;
}

function parseJsonText(raw, label) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  const duplicates = findDuplicateJsonKeys(raw);
  if (duplicates.length > 0) {
    throw new Error(`${label} contains duplicate JSON key ${duplicates[0]}`);
  }
  return value;
}

async function parseJson(path, label, expectedRootReal = null) {
  const { rawBytes, raw } = await readUtf8FileStrict(
    path,
    label,
    expectedRootReal,
  );
  return { rawBytes, raw, value: parseJsonText(raw, label) };
}

async function parseJsonRegularFile(path, label, expectedRootReal = null) {
  return parseJson(path, label, expectedRootReal);
}

function realPathWithin(rootPath, candidatePath, allowSame = false) {
  const relativeResult = relative(rootPath, candidatePath);
  return (
    (allowSame && relativeResult === "") ||
    (relativeResult !== "" &&
      relativeResult !== ".." &&
      !relativeResult.startsWith(`..\\`) &&
      !relativeResult.startsWith("../") &&
      !isAbsolute(relativeResult))
  );
}

async function requireRealDirectory(path, label) {
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch {
    throw new Error(`${label} is missing or unreadable`);
  }
  if (!pathStat.isDirectory() || pathStat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symbolic link`);
  }
  return realpath(path);
}

async function requireRealDescendant(root, path, label, expectedType) {
  const rootReal = await requireRealDirectory(root, `${label} root`);
  const lexicalRelative = relative(resolve(root), resolve(path));
  if (
    lexicalRelative === "" ||
    lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..\\`) ||
    lexicalRelative.startsWith("../") ||
    isAbsolute(lexicalRelative)
  ) {
    throw new Error(`${label} escapes its real root`);
  }
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch {
    throw new Error(`${label} is missing or unreadable`);
  }
  if (pathStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  if (expectedType === "file" && !pathStat.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (expectedType === "directory" && !pathStat.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  const pathReal = await realpath(path);
  if (!realPathWithin(rootReal, pathReal)) {
    throw new Error(`${label} escapes its real root`);
  }
  return pathReal;
}

function decodePercentSegments(raw) {
  let changed = false;
  const value = raw.replaceAll(/(?:%[0-9a-f]{2})+/giu, (encodedRun) => {
    try {
      const decodedRun = decodeURIComponent(encodedRun);
      if (decodedRun !== encodedRun) changed = true;
      return decodedRun;
    } catch {
      return encodedRun.replaceAll(/%([0-9a-f]{2})/giu, (encodedByte, hex) => {
        const byte = Number.parseInt(hex, 16);
        if (byte > 0x7f) return encodedByte;
        changed = true;
        return String.fromCodePoint(byte);
      });
    }
  });
  return changed ? value : null;
}

function decodeBase64Token(token) {
  if (
    token.length < 20 ||
    token.length > 16_384 ||
    token.length % 4 === 1 ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(token)
  ) {
    return null;
  }
  try {
    const normalized = token.replaceAll("-", "+").replaceAll("_", "/");
    const withoutPadding = normalized.replace(/=+$/u, "");
    const padded = withoutPadding.padEnd(
      withoutPadding.length + ((4 - (withoutPadding.length % 4)) % 4),
      "=",
    );
    const bytes = Buffer.from(padded, "base64");
    if (bytes.toString("base64").replace(/=+$/u, "") !== withoutPadding) {
      return null;
    }
    const value = decodeStrictUtf8(bytes, "encoded text");
    const characters = [...value];
    const printable = characters.filter(
      (character) =>
        character === "\n" ||
        character === "\r" ||
        character === "\t" ||
        character >= " ",
    ).length;
    return value.length > 0 && printable / characters.length >= 0.9
      ? value
      : null;
  } catch {
    return null;
  }
}

function decodeOneTextLayer(raw) {
  const decoded = new Set();
  let overflow = false;
  const percentDecoded = decodePercentSegments(raw);
  if (percentDecoded && percentDecoded !== raw) decoded.add(percentDecoded);

  const tokens = new Set();
  const compact = raw.trim();
  if (/^[A-Za-z0-9+/_-]+={0,2}$/u.test(compact)) tokens.add(compact);
  let tokenCount = 0;
  for (const match of raw.matchAll(/[A-Za-z0-9+/_-]{20,}={0,2}/gu)) {
    tokenCount += 1;
    if (tokenCount > 128 || match[0].length > 16_384) {
      overflow = true;
      break;
    }
    tokens.add(match[0]);
  }
  for (const token of tokens) {
    const value = decodeBase64Token(token);
    if (value !== null) decoded.add(value);
  }
  return { decoded, overflow };
}

function decodedTextCandidates(raw, maxDepth = 3) {
  const decoded = new Set();
  let frontier = [raw];
  let totalLength = 0;
  let overflow = false;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = [];
    for (const candidate of frontier) {
      const layer = decodeOneTextLayer(candidate);
      overflow ||= layer.overflow;
      for (const value of layer.decoded) {
        if (value === raw || decoded.has(value)) continue;
        totalLength += value.length;
        if (decoded.size >= 32 || totalLength > 65_536) {
          overflow = true;
          continue;
        }
        decoded.add(value);
        next.push(value);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return { decoded, overflow };
}

function parseIpv6Words(candidate) {
  const address = candidate.replace(/%[0-9A-Za-z._~-]+$/u, "");
  if (isIP(address) !== 6 || address.includes(".")) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (parts.length !== 8) return null;
  const words = parts.map((part) => Number.parseInt(part || "0", 16));
  return words.every((word) => Number.isInteger(word) && word <= 0xffff)
    ? words
    : null;
}

function isSensitiveIpv4Octets([first, second]) {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isSensitiveIpv6(words) {
  if (!words) return false;
  const loopback =
    words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const uniqueLocal = (words[0] & 0xfe00) === 0xfc00;
  const linkLocal = (words[0] & 0xffc0) === 0xfe80;
  const siteLocal = (words[0] & 0xffc0) === 0xfec0;
  const mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  const ipv4Octets = [
    words[6] >> 8,
    words[6] & 0xff,
    words[7] >> 8,
    words[7] & 0xff,
  ];
  return (
    loopback ||
    uniqueLocal ||
    linkLocal ||
    siteLocal ||
    ((mapped || compatible) && isSensitiveIpv4Octets(ipv4Octets))
  );
}

function scanRawText(raw, label, errors, decode = true) {
  if (raw.length > 1_048_576) {
    errors.push(`${label} exceeds the safe text scan size`);
  }
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/gu, "contains private-key material"],
    [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gu, "contains an API-key pattern"],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "contains a GitHub token pattern"],
    [/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/gu, "contains a Slack token pattern"],
    [/\bAKIA[0-9A-Z]{16}\b/gu, "contains an AWS access-key pattern"],
    [/\bAIza[0-9A-Za-z_-]{32,}\b/gu, "contains a Google API-key pattern"],
    [
      /\b(?:rk|sk)_live_[0-9A-Za-z]{16,}\b/gu,
      "contains a live payment-key pattern",
    ],
    [/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/giu, "contains a bearer credential"],
    [
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
      "contains a JWT pattern",
    ],
    [
      /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+@/giu,
      "contains URI-embedded credentials",
    ],
    [
      /(?:[A-Z]:\\Users\\[^\\\s]+\\|(?<![A-Z0-9])\/Users\/[^/\s]+\/|(?<![A-Z0-9])\/home\/[^/\s]+\/)/giu,
      "contains a user home path",
    ],
    [/\bterm_[a-z0-9-]+\b/giu, "contains an Orca terminal handle"],
    [/\b[a-z0-9][a-z0-9-]{1,62}\.local\b/giu, "contains a private hostname"],
    [
      /\b(?:0\.(?:\d{1,3}\.){2}\d{1,3}|10\.(?:\d{1,3}\.){2}\d{1,3}|127\.(?:\d{1,3}\.){2}\d{1,3}|169\.254\.(?:\d{1,3}\.)\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3}\.)\d{1,3})\b/gu,
      "contains a private or Tailscale IP address",
    ],
    [
      /(?<![0-9a-f:])(?:::1|f[cd][0-9a-f]{2}(?::[0-9a-f]{0,4}){1,7}|fe[89ab][0-9a-f](?::[0-9a-f]{0,4}){1,7})(?:%[0-9a-z._~-]+)?(?![0-9a-f:])/giu,
      "contains a private IPv6 address",
    ],
  ];
  for (const [pattern, message] of patterns) {
    if (pattern.test(raw)) errors.push(`${label} ${message}`);
  }

  for (const match of raw.matchAll(
    /(?<![0-9A-Za-z])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?:%[0-9A-Za-z._~-]+)?(?![0-9A-Za-z:])/gu,
  )) {
    if (isSensitiveIpv6(parseIpv6Words(match[0]))) {
      errors.push(`${label} contains a private IPv6 address`);
    }
  }

  const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu;
  for (const match of raw.matchAll(emailPattern)) {
    const domain = match[1].toLowerCase();
    const allowed = [...allowedExampleDomains].some(
      (candidate) => domain === candidate || domain.endsWith(`.${candidate}`),
    );
    if (!allowed) errors.push(`${label} contains a real email address`);
  }

  const urlPattern = /https?:\/\/([^/\s"']+)/giu;
  for (const match of raw.matchAll(urlPattern)) {
    const hostname = match[1].split(":")[0].toLowerCase();
    const allowed =
      hostname === "github.com" ||
      hostname === "api.github.com" ||
      [...allowedExampleDomains].some(
        (candidate) =>
          hostname === candidate || hostname.endsWith(`.${candidate}`),
      );
    if (!allowed) errors.push(`${label} contains an unapproved external URL`);
  }

  for (const match of raw.matchAll(/\b(?:https?|ftp):[\\/]+[^\s"'<>]+/giu)) {
    try {
      const parsed = new URL(match[0]);
      if (parsed.username || parsed.password) {
        errors.push(`${label} contains URI-embedded credentials`);
      }
      if (new Set(["http:", "https:"]).has(parsed.protocol)) {
        const hostname = parsed.hostname.toLowerCase();
        const allowed =
          hostname === "github.com" ||
          hostname === "api.github.com" ||
          [...allowedExampleDomains].some(
            (candidate) =>
              hostname === candidate || hostname.endsWith(`.${candidate}`),
          );
        if (!allowed)
          errors.push(`${label} contains an unapproved external URL`);
      }
    } catch {
      // Malformed URLs remain ordinary text unless another scanner rejects them.
    }
  }

  if (decode) {
    const candidates = decodedTextCandidates(raw);
    if (candidates.overflow) {
      errors.push(
        `${label} contains encoded content beyond the safe scan budget`,
      );
    }
    for (const candidate of candidates.decoded) {
      scanRawText(candidate, `${label} (decoded)`, errors, false);
    }
  }
}

function scanSensitiveKeys(value, label, errors, path = "$") {
  if (typeof value === "string") {
    scanRawText(value, `${label} ${path}`, errors);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanSensitiveKeys(item, label, errors, `${path}[${index}]`),
    );
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key);
    if (
      sensitiveKeys.has(normalizedKey) ||
      sensitiveKeyFragments.some((fragment) => normalizedKey.includes(fragment))
    ) {
      errors.push(`${label} contains forbidden key ${path}.${key}`);
    }
    scanSensitiveKeys(child, label, errors, `${path}.${key}`);
  }
}

function assertAllowedKeys(value, allowedKeys, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key))
      errors.push(`${label} contains unsupported field ${key}`);
  }
  return true;
}

function validateExternalRefs(value, rules, label, errors) {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const [key, reference] of Object.entries(value)) {
    const pattern = rules.get(key);
    if (!pattern) {
      errors.push(`${label} contains unsupported reference ${key}`);
    } else if (typeof reference !== "string" || !pattern.test(reference)) {
      errors.push(`${label}.${key} has an invalid reference value`);
    }
  }
}

function validateStableId(value, label, errors) {
  if (typeof value !== "string" || !stableIdPattern.test(value)) {
    errors.push(`${label} must be a stable lowercase hyphenated ID`);
    return false;
  }
  return true;
}

function validateCommit(value, label, errors) {
  if (typeof value !== "string" || !commitPattern.test(value)) {
    errors.push(`${label} must be a 40-character lowercase Git commit`);
    return false;
  }
  return true;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateNamedRecords(
  records,
  label,
  allowedStatuses,
  allowedKeys,
  errors,
) {
  if (!Array.isArray(records)) {
    errors.push(`${label} must be an array`);
    return;
  }
  const ids = new Set();
  for (const [index, record] of records.entries()) {
    if (!isObject(record)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    assertAllowedKeys(record, allowedKeys, `${label}[${index}]`, errors);
    if (validateStableId(record.id, `${label}[${index}].id`, errors)) {
      if (ids.has(record.id)) errors.push(`${label} repeats ID ${record.id}`);
      ids.add(record.id);
    }
    const text = record.summary ?? record.question;
    if (typeof text !== "string" || text.trim().length === 0) {
      errors.push(`${label}[${index}] needs summary or question text`);
    }
    if (
      allowedStatuses &&
      (typeof record.status !== "string" || !allowedStatuses.has(record.status))
    ) {
      errors.push(`${label}[${index}] has invalid status`);
    }
    if (record.status === "resolved" && !record.resolution) {
      errors.push(`${label}[${index}] is resolved without a resolution`);
    }
  }
}

function validateRoles(rolesDocument, errors) {
  assertAllowedKeys(
    rolesDocument,
    new Set(["schemaVersion", "roles"]),
    "roles.json",
    errors,
  );
  if (
    rolesDocument?.schemaVersion !== 1 ||
    !Array.isArray(rolesDocument.roles)
  ) {
    errors.push("roles.json must use schemaVersion 1 and contain roles[]");
    return new Map();
  }
  const roles = new Map();
  for (const [index, role] of rolesDocument.roles.entries()) {
    if (!isObject(role) || typeof role.id !== "string") {
      errors.push(`roles[${index}] is invalid`);
      continue;
    }
    assertAllowedKeys(
      role,
      new Set([
        "id",
        "client",
        "modelId",
        "host",
        "dispatch",
        "access",
        "defaultScope",
        "prohibitions",
        "evidenceSources",
      ]),
      `roles[${index}]`,
      errors,
    );
    if (roles.has(role.id)) errors.push(`roles.json repeats role ${role.id}`);
    if (!role.modelId || !role.access || !Array.isArray(role.evidenceSources)) {
      errors.push(`role ${role.id} lacks modelId, access, or evidenceSources`);
    }
    if (
      !new Set(["coordinator-writer", "bounded-writer", "read-only"]).has(
        role.access,
      )
    ) {
      errors.push(`role ${role.id} has invalid access ${role.access}`);
    }
    roles.set(role.id, role);
  }
  if (!roles.has("codex"))
    errors.push("roles.json must define the codex coordinator");
  return roles;
}

function validateContext(context, roles, errors) {
  if (!isObject(context) || context.schemaVersion !== 1) {
    errors.push("context.json must be an object with schemaVersion 1");
    return;
  }
  assertAllowedKeys(
    context,
    new Set([
      "schemaVersion",
      "runId",
      "mode",
      "objective",
      "authority",
      "base",
      "actors",
      "invariants",
      "decisions",
      "openQuestions",
      "externalRefs",
      "artifactRefs",
      "expectedFinalState",
    ]),
    "context.json",
    errors,
  );
  validateStableId(context.runId, "context.runId", errors);
  if (!new Set(["active", "fixture", "closed"]).has(context.mode)) {
    errors.push("context.mode must be active, fixture, or closed");
  }
  if (
    typeof context.objective !== "string" ||
    context.objective.trim().length === 0
  ) {
    errors.push("context.objective is required");
  }
  if (
    context.authority?.systemOfRecord !== "windows-local-ledger" ||
    context.authority?.singleWriterRoleId !== "codex"
  ) {
    errors.push(
      "context.authority must keep Codex as the Windows ledger writer",
    );
  }
  assertAllowedKeys(
    context.authority,
    new Set(["singleWriterRoleId", "systemOfRecord"]),
    "context.authority",
    errors,
  );
  if (!isObject(context.base)) {
    errors.push("context.base is required");
  } else {
    assertAllowedKeys(
      context.base,
      new Set(["repository", "commit", "branch"]),
      "context.base",
      errors,
    );
    validateCommit(context.base.commit, "context.base.commit", errors);
    if (!context.base.repository || !context.base.branch) {
      errors.push("context.base requires repository and branch");
    }
  }

  if (!Array.isArray(context.actors)) {
    errors.push("context.actors must be an array");
  } else {
    const actorIds = new Set();
    for (const [index, actor] of context.actors.entries()) {
      assertAllowedKeys(
        actor,
        new Set(["roleId", "status", "modelEvidence"]),
        `context.actors[${index}]`,
        errors,
      );
      const role = roles.get(actor?.roleId);
      if (!role) {
        errors.push(`context.actors[${index}] references an unknown role`);
        continue;
      }
      if (actorIds.has(actor.roleId)) {
        errors.push(`context.actors repeats role ${actor.roleId}`);
      }
      actorIds.add(actor.roleId);
      if (!new Set(["pending", "ready", "unavailable"]).has(actor.status)) {
        errors.push(`actor ${actor.roleId} has invalid status`);
      }
      if (actor.status === "ready") {
        const evidence = actor.modelEvidence;
        if (!isObject(evidence)) {
          errors.push(`ready actor ${actor.roleId} lacks model evidence`);
          continue;
        }
        assertAllowedKeys(
          evidence,
          new Set(["source", "modelId", "observedAt"]),
          `context.actors[${index}].modelEvidence`,
          errors,
        );
        if (evidence.modelId !== role.modelId) {
          errors.push(
            `ready actor ${actor.roleId} reports ${evidence.modelId ?? "no model"}, expected ${role.modelId}`,
          );
        }
        if (!arrayOrEmpty(role.evidenceSources).includes(evidence.source)) {
          errors.push(`actor ${actor.roleId} uses unsupported evidence source`);
        }
        if (!isIsoDate(evidence.observedAt)) {
          errors.push(`actor ${actor.roleId} has invalid model evidence time`);
        }
      }
    }
  }

  validateNamedRecords(
    context.invariants,
    "context.invariants",
    null,
    new Set(["id", "summary"]),
    errors,
  );
  validateNamedRecords(
    context.decisions,
    "context.decisions",
    new Set(["accepted", "superseded"]),
    new Set(["id", "status", "summary", "rationale"]),
    errors,
  );
  validateNamedRecords(
    context.openQuestions,
    "context.openQuestions",
    new Set(["open", "resolved"]),
    new Set(["id", "status", "question", "resolution"]),
    errors,
  );
  validateExternalRefs(
    context.externalRefs,
    contextExternalRefRules,
    "context.externalRefs",
    errors,
  );
  if (!Array.isArray(context.artifactRefs)) {
    errors.push("context.artifactRefs must be an array");
  }
  if (!isObject(context.expectedFinalState)) {
    errors.push("context.expectedFinalState must be an object");
  } else {
    const allowedStates = new Set([
      "pending",
      "assigned",
      "started",
      "blocked",
      "failed",
      "completed",
      "accepted",
      "rejected",
    ]);
    for (const [taskId, state] of Object.entries(context.expectedFinalState)) {
      validateStableId(taskId, "context.expectedFinalState task ID", errors);
      if (!allowedStates.has(state)) {
        errors.push(`context.expectedFinalState has invalid state ${state}`);
      }
    }
  }
}

async function loadTaskEvents(path, errors, runRootReal) {
  const { raw } = await readUtf8FileStrict(path, "tasks.jsonl", runRootReal);
  scanRawText(raw, "tasks.jsonl", errors);
  const events = [];
  for (const [index, line] of raw.split(/\r?\n/gu).entries()) {
    if (line.trim().length === 0) continue;
    try {
      const event = parseJsonText(line, `tasks.jsonl:${index + 1}`);
      events.push(event);
      validateSchemaDefinition(
        "taskEvent",
        event,
        `tasks.jsonl:${index + 1}`,
        errors,
      );
      scanSensitiveKeys(event, `tasks.jsonl:${index + 1}`, errors);
    } catch (error) {
      errors.push(`tasks.jsonl:${index + 1} is invalid JSON: ${error.message}`);
    }
  }
  return { raw, events };
}

const eventDataAllowedKeys = new Map([
  [
    "task.created",
    new Set([
      "title",
      "ownerRoleId",
      "access",
      "worktree",
      "branch",
      "allowedPaths",
      "dependencies",
      "acceptanceChecks",
      "orcaTaskId",
    ]),
  ],
  ["task.assigned", new Set(["assigneeRoleId", "orcaDispatchId"])],
  ["task.started", new Set()],
  ["task.blocked", new Set(["reason"])],
  ["task.resumed", new Set(["reason"])],
  ["task.completed", new Set(["handoff"])],
  ["task.failed", new Set(["reason"])],
  [
    "task.retried",
    new Set(["retryOfEventId", "assigneeRoleId", "orcaDispatchId"]),
  ],
  ["task.accepted", new Set(["basis", "observations", "observationDigests"])],
  ["task.rejected", new Set(["basis", "reason"])],
]);

function validateEventShape(event, label, errors) {
  if (
    !assertAllowedKeys(
      event,
      new Set([
        "schemaVersion",
        "eventId",
        "runId",
        "taskId",
        "type",
        "at",
        "baseCommit",
        "actorRoleId",
        "data",
      ]),
      label,
      errors,
    )
  ) {
    return;
  }
  const allowedData = eventDataAllowedKeys.get(event.type);
  if (allowedData)
    assertAllowedKeys(event.data, allowedData, `${label}.data`, errors);
  const orcaTaskId =
    event.type === "task.created" ? event.data?.orcaTaskId : undefined;
  const orcaDispatchId = new Set(["task.assigned", "task.retried"]).has(
    event.type,
  )
    ? event.data?.orcaDispatchId
    : undefined;
  if (
    orcaTaskId !== undefined &&
    !handoffExternalRefRules.get("orcaTaskId").test(orcaTaskId)
  ) {
    errors.push(`${label}.data.orcaTaskId is invalid`);
  }
  if (
    orcaDispatchId !== undefined &&
    !handoffExternalRefRules.get("orcaDispatchId").test(orcaDispatchId)
  ) {
    errors.push(`${label}.data.orcaDispatchId is invalid`);
  }
}

function transitionTask(task, event, errors) {
  const current = task.state;
  const at = Date.parse(event.at);
  const invalid = () =>
    errors.push(
      `${event.eventId} cannot apply ${event.type} from ${current ?? "none"}`,
    );

  switch (event.type) {
    case "task.created": {
      if (current !== undefined) return invalid();
      task.state = "pending";
      task.definition = event.data;
      break;
    }
    case "task.assigned": {
      if (current !== "pending") return invalid();
      task.state = "assigned";
      task.ownershipWindows.push({ start: at, end: null });
      break;
    }
    case "task.started": {
      if (current !== "assigned") return invalid();
      task.state = "started";
      break;
    }
    case "task.blocked": {
      if (current !== "started") return invalid();
      task.state = "blocked";
      break;
    }
    case "task.resumed": {
      if (current !== "blocked") return invalid();
      task.state = "started";
      break;
    }
    case "task.completed": {
      if (current !== "started") return invalid();
      task.state = "completed";
      task.completedEvent = event;
      task.completedEvents.push(event);
      task.currentCompletion = event;
      task.ownershipWindows.at(-1).end = at;
      break;
    }
    case "task.failed": {
      if (!new Set(["started", "blocked"]).has(current)) return invalid();
      task.state = "failed";
      task.lastTerminalEvent = event;
      task.ownershipWindows.at(-1).end = at;
      break;
    }
    case "task.retried": {
      if (!new Set(["failed", "rejected"]).has(current)) return invalid();
      if (!event.data?.retryOfEventId) {
        errors.push(`${event.eventId} lacks data.retryOfEventId`);
      }
      task.state = "assigned";
      task.currentCompletion = null;
      task.ownershipWindows.push({ start: at, end: null });
      break;
    }
    case "task.accepted": {
      if (current !== "completed") return invalid();
      task.state = "accepted";
      task.acceptedEvent = event;
      break;
    }
    case "task.rejected": {
      if (current !== "completed") return invalid();
      task.state = "rejected";
      task.rejectedEvent = event;
      task.lastTerminalEvent = event;
      break;
    }
    default:
      errors.push(`${event.eventId} uses unsupported event type ${event.type}`);
  }
}

function validateTaskDefinition(taskId, definition, roles, errors) {
  if (!isObject(definition)) {
    errors.push(`${taskId} lacks a task.created data object`);
    return;
  }
  assertAllowedKeys(
    definition,
    new Set([
      "title",
      "ownerRoleId",
      "access",
      "worktree",
      "branch",
      "allowedPaths",
      "dependencies",
      "acceptanceChecks",
      "orcaTaskId",
    ]),
    `${taskId} definition`,
    errors,
  );
  const role = roles.get(definition.ownerRoleId);
  if (!role)
    errors.push(`${taskId} has unknown owner ${definition.ownerRoleId}`);
  if (!new Set(["read", "write"]).has(definition.access)) {
    errors.push(`${taskId} access must be read or write`);
  }
  if (role?.access === "read-only" && definition.access !== "read") {
    errors.push(`${taskId} gives write access to read-only role ${role.id}`);
  }
  if (!definition.title || !definition.worktree || !definition.branch) {
    errors.push(`${taskId} requires title, worktree, and branch`);
  }
  validateStableId(definition.worktree, `${taskId} worktree`, errors);
  if (typeof definition.branch === "string" && definition.branch.length > 0) {
    try {
      git("check-ref-format", "--branch", definition.branch);
    } catch {
      errors.push(`${taskId} has an invalid Git branch ${definition.branch}`);
    }
  }
  if (
    !Array.isArray(definition.allowedPaths) ||
    definition.allowedPaths.length === 0
  ) {
    errors.push(`${taskId} requires non-empty allowedPaths`);
  } else {
    const canonicalPaths = new Set();
    for (const path of definition.allowedPaths) {
      if (!isRelativeSafePath(path) || path.includes("*")) {
        errors.push(`${taskId} has unsafe or globbed allowed path ${path}`);
      }
      const canonical = canonicalPath(path);
      if (canonicalPaths.has(canonical)) {
        errors.push(`${taskId} repeats an allowed path alias ${path}`);
      }
      canonicalPaths.add(canonical);
    }
  }
  if (!Array.isArray(definition.dependencies)) {
    errors.push(`${taskId} dependencies must be an array`);
  } else {
    const dependencies = new Set();
    for (const dependency of definition.dependencies) {
      validateStableId(dependency, `${taskId} dependency`, errors);
      if (dependencies.has(dependency)) {
        errors.push(`${taskId} repeats dependency ${dependency}`);
      }
      dependencies.add(dependency);
    }
  }
  if (
    !Array.isArray(definition.acceptanceChecks) ||
    definition.acceptanceChecks.length === 0
  ) {
    errors.push(`${taskId} requires declared acceptanceChecks`);
  } else {
    const checks = new Set();
    for (const checkId of definition.acceptanceChecks) {
      validateStableId(checkId, `${taskId} acceptance check`, errors);
      if (checks.has(checkId)) {
        errors.push(`${taskId} repeats acceptance check ${checkId}`);
      }
      checks.add(checkId);
    }
  }
  if (
    definition.orcaTaskId !== undefined &&
    !handoffExternalRefRules.get("orcaTaskId").test(definition.orcaTaskId)
  ) {
    errors.push(`${taskId} has an invalid Orca Task reference`);
  }
}

function validateDependencyGraph(tasks, errors) {
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId, trail) {
    if (visiting.has(taskId)) {
      errors.push(`task dependency cycle: ${[...trail, taskId].join(" -> ")}`);
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    const task = tasks.get(taskId);
    for (const dependency of arrayOrEmpty(task?.definition?.dependencies)) {
      if (!tasks.has(dependency)) {
        errors.push(`${taskId} depends on unknown task ${dependency}`);
      } else {
        visit(dependency, [...trail, taskId]);
      }
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const taskId of tasks.keys()) visit(taskId, []);
}

function validateWriterIsolation(tasks, errors) {
  const writers = [...tasks.entries()].filter(
    ([, task]) => task.definition?.access === "write",
  );
  for (let leftIndex = 0; leftIndex < writers.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < writers.length;
      rightIndex += 1
    ) {
      const [leftId, left] = writers[leftIndex];
      const [rightId, right] = writers[rightIndex];
      const concurrent = left.ownershipWindows.some((leftWindow) =>
        right.ownershipWindows.some((rightWindow) =>
          intervalsOverlap(leftWindow, rightWindow),
        ),
      );
      if (!concurrent) continue;
      if (
        canonicalIdentifier(left.definition.branch) ===
        canonicalIdentifier(right.definition.branch)
      ) {
        errors.push(
          `${leftId} and ${rightId} concurrently write the same branch`,
        );
      }
      if (
        canonicalIdentifier(left.definition.worktree) ===
        canonicalIdentifier(right.definition.worktree)
      ) {
        errors.push(
          `${leftId} and ${rightId} concurrently write the same worktree`,
        );
      }
      for (const leftPath of arrayOrEmpty(left.definition.allowedPaths)) {
        for (const rightPath of arrayOrEmpty(right.definition.allowedPaths)) {
          if (pathOverlaps(leftPath, rightPath)) {
            errors.push(
              `${leftId} and ${rightId} have overlapping concurrent write paths: ${leftPath} / ${rightPath}`,
            );
          }
        }
      }
    }
  }
}

async function validateRunLayout(runDir, errors) {
  let runStat;
  try {
    runStat = await lstat(runDir);
  } catch (error) {
    throw new Error(`Run directory is missing or unreadable: ${error.message}`);
  }
  if (!runStat.isDirectory() || runStat.isSymbolicLink()) {
    errors.push(
      "Run path must be a real directory, not a file or symbolic link",
    );
    return;
  }

  const allowedRootEntries = new Map([
    ["context.json", "file"],
    ["tasks.jsonl", "file"],
    ["graph.json", "file"],
    ["handoffs", "directory"],
    ["observations", "directory"],
  ]);
  const entries = await readdir(runDir, { withFileTypes: true });
  const seenEntries = new Set();
  for (const entry of entries) {
    const expectedType = allowedRootEntries.get(entry.name);
    if (!expectedType) {
      errors.push("Run directory contains an unsupported entry");
      continue;
    }
    seenEntries.add(entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(`Run entry ${entry.name} must not be a symbolic link`);
    } else if (expectedType === "file" && !entry.isFile()) {
      errors.push(`Run entry ${entry.name} must be a regular file`);
    } else if (expectedType === "directory" && !entry.isDirectory()) {
      errors.push(`Run entry ${entry.name} must be a directory`);
    }
  }
  for (const requiredEntry of allowedRootEntries.keys()) {
    if (!seenEntries.has(requiredEntry)) {
      errors.push(`Run directory is missing required entry ${requiredEntry}`);
    }
  }

  for (const directoryName of ["handoffs", "observations"]) {
    const directory = join(runDir, directoryName);
    if (!existsSync(directory)) continue;
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      continue;
    }
    for (const entry of await readdir(directory, {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !stateFilePattern.test(entry.name)
      ) {
        errors.push(`${directoryName} contains an unsupported entry`);
      }
    }
  }
}

async function loadHandoffs(runDir, runRootReal, errors) {
  const directory = join(runDir, "handoffs");
  const handoffs = new Map();
  const handoffIds = new Set();
  if (!existsSync(directory)) return handoffs;
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return handoffs;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = entry.name;
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !stateFilePattern.test(name)
    ) {
      continue;
    }
    const path = join(directory, name);
    const { rawBytes, raw, value } = await parseJson(
      path,
      `handoffs/${name}`,
      runRootReal,
    );
    scanRawText(raw, `handoffs/${name}`, errors);
    scanSensitiveKeys(value, `handoffs/${name}`, errors);
    const relativePath = `handoffs/${name}`;
    validateSchemaDefinition("handoff", value, relativePath, errors);
    if (!isObject(value)) {
      errors.push(`${relativePath} must contain a handoff object`);
      continue;
    }
    if (handoffIds.has(value.handoffId)) {
      errors.push(`multiple handoffs use ID ${value.handoffId}`);
    }
    handoffIds.add(value.handoffId);
    handoffs.set(relativePath, {
      path,
      relativePath,
      rawBytes,
      raw,
      value,
    });
  }
  return handoffs;
}

async function loadObservations(runDir, runRootReal, errors) {
  const directory = join(runDir, "observations");
  const byPath = new Map();
  const byId = new Map();
  if (!existsSync(directory)) return { byPath, byId };
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return { byPath, byId };
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = entry.name;
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !stateFilePattern.test(name)
    ) {
      continue;
    }
    const path = join(directory, name);
    const relativePath = `observations/${name}`;
    const { rawBytes, raw, value } = await parseJson(
      path,
      relativePath,
      runRootReal,
    );
    scanRawText(raw, relativePath, errors);
    scanSensitiveKeys(value, relativePath, errors);
    validateSchemaDefinition(
      "coordinatorObservation",
      value,
      relativePath,
      errors,
    );
    if (!isObject(value)) {
      errors.push(`${relativePath} must contain an observation object`);
      continue;
    }
    if (byId.has(value.observationId)) {
      errors.push(`multiple observations use ID ${value.observationId}`);
    }
    const record = { path, relativePath, rawBytes, raw, value };
    byPath.set(relativePath, record);
    byId.set(value.observationId, record);
  }
  return { byPath, byId };
}

function validateHandoff(taskId, task, handoff, baseCommit, roles, errors) {
  if (!handoff) {
    errors.push(`${taskId} completed without a handoff receipt`);
    return;
  }
  const receipt = handoff.value;
  assertAllowedKeys(
    receipt,
    new Set([
      "schemaVersion",
      "handoffId",
      "taskId",
      "outcome",
      "baseCommit",
      "workingBranch",
      "changedFiles",
      "commandsActuallyRun",
      "checks",
      "unrunChecks",
      "knownRisks",
      "workingTreeStatus",
      "suggestedNextAction",
      "externalRefs",
    ]),
    handoff.relativePath,
    errors,
  );
  if (receipt.schemaVersion !== 1 || receipt.taskId !== taskId) {
    errors.push(
      `${handoff.relativePath} has the wrong schemaVersion or taskId`,
    );
  }
  validateStableId(
    receipt.handoffId,
    `${handoff.relativePath}.handoffId`,
    errors,
  );
  if (receipt.baseCommit !== baseCommit) {
    errors.push(`${handoff.relativePath} does not use the Run base commit`);
  }
  if (
    !new Set(["succeeded", "partial", "blocked", "failed"]).has(receipt.outcome)
  ) {
    errors.push(`${handoff.relativePath} has an invalid outcome`);
  }
  if (!receipt.workingBranch || !Array.isArray(receipt.changedFiles)) {
    errors.push(`${handoff.relativePath} lacks branch or changedFiles`);
  } else {
    if (
      canonicalIdentifier(receipt.workingBranch) !==
      canonicalIdentifier(task.definition?.branch)
    ) {
      errors.push(`${handoff.relativePath} does not match the task branch`);
    }
    if (task.definition?.access === "read" && receipt.changedFiles.length > 0) {
      errors.push(
        `${handoff.relativePath} reports changes for a read-only task`,
      );
    }
    for (const path of receipt.changedFiles) {
      if (!isRelativeSafePath(path)) {
        errors.push(`${handoff.relativePath} has unsafe changed file ${path}`);
      } else if (
        !task.definition?.allowedPaths?.some((allowedPath) =>
          pathWithin(path, allowedPath),
        )
      ) {
        errors.push(
          `${handoff.relativePath} changed file outside task ownership: ${path}`,
        );
      }
    }
  }
  if (!Array.isArray(receipt.commandsActuallyRun)) {
    errors.push(`${handoff.relativePath}.commandsActuallyRun must be an array`);
  } else if (
    receipt.commandsActuallyRun.some(
      (command) => typeof command !== "string" || command.trim().length === 0,
    )
  ) {
    errors.push(
      `${handoff.relativePath}.commandsActuallyRun has an invalid command`,
    );
  } else if (
    new Set(receipt.commandsActuallyRun).size !==
    receipt.commandsActuallyRun.length
  ) {
    errors.push(
      `${handoff.relativePath}.commandsActuallyRun repeats a command`,
    );
  }
  if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) {
    errors.push(`${handoff.relativePath} must contain observed checks`);
  } else {
    let passed = 0;
    const checkIds = new Set();
    for (const [index, check] of receipt.checks.entries()) {
      if (
        !isObject(check) ||
        !new Set(["passed", "failed"]).has(check.status)
      ) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] has invalid status`,
        );
        continue;
      }
      assertAllowedKeys(
        check,
        new Set([
          "id",
          "name",
          "status",
          "command",
          "observed",
          "reason",
          "evidenceRoleId",
          "acceptanceCheckId",
        ]),
        `${handoff.relativePath}.checks[${index}]`,
        errors,
      );
      validateStableId(
        check.id,
        `${handoff.relativePath}.checks[${index}].id`,
        errors,
      );
      if (checkIds.has(check.id)) {
        errors.push(`${handoff.relativePath} repeats check ${check.id}`);
      }
      checkIds.add(check.id);
      if (check.acceptanceCheckId !== null) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] cannot authorize an acceptance check`,
        );
      }
      if (!check.name || !check.observed) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] lacks name or observation`,
        );
      }
      if (!roles.has(check.evidenceRoleId)) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] has unknown evidence owner`,
        );
      } else if (check.evidenceRoleId !== task.definition?.ownerRoleId) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] is not owned by the task reporter`,
        );
      }
      if (check.command !== null && typeof check.command !== "string") {
        errors.push(
          `${handoff.relativePath}.checks[${index}] has an invalid command`,
        );
      }
      if (
        check.status === "passed" &&
        /\b(?:planned|not executed|not run|未执行|未运行|计划)\b/iu.test(
          check.observed,
        )
      ) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] describes unexecuted work as passed`,
        );
      }
      if (
        check.status === "passed" &&
        check.command !== null &&
        (!Array.isArray(receipt.commandsActuallyRun) ||
          !receipt.commandsActuallyRun.includes(check.command))
      ) {
        errors.push(
          `${handoff.relativePath}.checks[${index}] command is absent from commandsActuallyRun`,
        );
      }
      if (check.status === "passed") passed += 1;
    }
    if (receipt.outcome === "succeeded" && passed === 0) {
      errors.push(
        `${handoff.relativePath} claims success without a passed observation`,
      );
    }
    if (
      receipt.outcome === "succeeded" &&
      receipt.checks.some((check) => check.status === "failed")
    ) {
      errors.push(`${handoff.relativePath} claims success with a failed check`);
    }
  }
  if (
    !Array.isArray(receipt.unrunChecks) ||
    !Array.isArray(receipt.knownRisks) ||
    !receipt.workingTreeStatus ||
    !receipt.suggestedNextAction
  ) {
    errors.push(`${handoff.relativePath} lacks closure evidence fields`);
  }
  const unrunNames = new Set();
  for (const [index, unrun] of arrayOrEmpty(receipt.unrunChecks).entries()) {
    assertAllowedKeys(
      unrun,
      new Set(["name", "reason"]),
      `${handoff.relativePath}.unrunChecks[${index}]`,
      errors,
    );
    if (!unrun.name || !unrun.reason) {
      errors.push(
        `${handoff.relativePath}.unrunChecks[${index}] lacks a reason`,
      );
    }
    const canonicalName = canonicalIdentifier(unrun.name ?? "");
    if (unrunNames.has(canonicalName)) {
      errors.push(`${handoff.relativePath}.unrunChecks repeats ${unrun.name}`);
    }
    unrunNames.add(canonicalName);
  }
  validateExternalRefs(
    receipt.externalRefs,
    handoffExternalRefRules,
    `${handoff.relativePath}.externalRefs`,
    errors,
  );
}

function validateCoordinatorObservation(
  observation,
  tasks,
  handoffs,
  roles,
  errors,
) {
  const value = observation.value;
  const label = observation.relativePath;
  assertAllowedKeys(
    value,
    new Set([
      "schemaVersion",
      "observationId",
      "taskId",
      "completionEventId",
      "handoff",
      "handoffSha256",
      "acceptanceCheckId",
      "name",
      "status",
      "command",
      "exitCode",
      "observed",
      "reason",
      "observedAt",
      "observerRoleId",
    ]),
    label,
    errors,
  );
  validateStableId(value.observationId, `${label}.observationId`, errors);
  if (label !== `observations/${value.observationId}.json`) {
    errors.push(`${label} filename does not match its observationId`);
  }
  if (value.observerRoleId !== "codex" || !roles.has("codex")) {
    errors.push(`${label} must be a Codex coordinator observation`);
  }
  const task = tasks.get(value.taskId);
  if (!task) {
    errors.push(`${label} references an unknown task`);
    return;
  }
  const completion = task.completedEvents.find(
    (event) => event.eventId === value.completionEventId,
  );
  if (!completion) {
    errors.push(`${label} references an unknown task completion`);
  } else if (completion.data?.handoff !== value.handoff) {
    errors.push(`${label} does not bind the referenced completion handoff`);
  }
  const handoff = handoffs.get(normalizePath(value.handoff ?? ""));
  if (!handoff) {
    errors.push(`${label} references an unknown handoff`);
  } else if (sha256Bytes(handoff.rawBytes) !== value.handoffSha256) {
    errors.push(`${label} handoff digest does not match`);
  }
  if (
    value.acceptanceCheckId !== null &&
    !arrayOrEmpty(task.definition?.acceptanceChecks).includes(
      value.acceptanceCheckId,
    )
  ) {
    errors.push(`${label} references an undeclared acceptance check`);
  }
  if (!isIsoDate(value.observedAt)) {
    errors.push(`${label} has an invalid observation time`);
  }
  if (value.command === null) {
    if (value.exitCode !== null) {
      errors.push(`${label} has an exit code without a command`);
    }
  } else if (
    typeof value.command !== "string" ||
    !Number.isInteger(value.exitCode)
  ) {
    errors.push(`${label} command evidence requires an integer exit code`);
  }
  if (value.status === "passed") {
    if (value.command !== null && value.exitCode !== 0) {
      errors.push(`${label} claims a passed command with a non-zero exit code`);
    }
    if (
      /\b(?:planned|not executed|not run|未执行|未运行|计划)\b/iu.test(
        value.observed ?? "",
      )
    ) {
      errors.push(`${label} describes unexecuted work as passed`);
    }
  }
  if (value.status === "not_run" && !value.reason) {
    errors.push(`${label} is not_run without a reason`);
  }
}

function validateGraph(
  graph,
  context,
  tasks,
  handoffs,
  observations,
  runDir,
  roles,
  errors,
) {
  if (
    !isObject(graph) ||
    graph.schemaVersion !== 1 ||
    graph.runId !== context.runId
  ) {
    errors.push("graph.json must use schemaVersion 1 and the context Run ID");
    return new Map();
  }
  assertAllowedKeys(
    graph,
    new Set(["schemaVersion", "runId", "nodes", "edges"]),
    "graph.json",
    errors,
  );
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    errors.push("graph.json requires nodes[] and edges[]");
    return new Map();
  }
  const nodeDataAllowedKeys = new Map([
    ["run", new Set()],
    ["requirement", new Set()],
    ["invariant", new Set()],
    ["decision", new Set(["status"])],
    ["question", new Set(["status"])],
    ["task", new Set(["orcaTaskId"])],
    ["file", new Set(["path"])],
    ["commit", new Set(["commit"])],
    [
      "check",
      new Set([
        "status",
        "observed",
        "command",
        "evidenceRoleId",
        "acceptanceCheckId",
        "observationPath",
        "completionEventId",
        "handoffSha256",
      ]),
    ],
    ["handoff", new Set(["path"])],
    ["model", new Set(["roleId", "modelId"])],
  ]);
  const invariantsById = new Map(
    arrayOrEmpty(context.invariants)
      .filter(isObject)
      .map((item) => [item.id, item]),
  );
  const decisionsById = new Map(
    arrayOrEmpty(context.decisions)
      .filter(isObject)
      .map((item) => [item.id, item]),
  );
  const questionsById = new Map(
    arrayOrEmpty(context.openQuestions)
      .filter(isObject)
      .map((item) => [item.id, item]),
  );
  const nodes = new Map();
  for (const [index, node] of graph.nodes.entries()) {
    if (
      !isObject(node) ||
      !validateStableId(node.id, `graph.nodes[${index}].id`, errors)
    ) {
      continue;
    }
    assertAllowedKeys(
      node,
      new Set(["id", "type", "label", "data"]),
      `graph.nodes[${index}]`,
      errors,
    );
    if (nodes.has(node.id)) errors.push(`graph repeats node ${node.id}`);
    if (!graphNodeTypes.has(node.type))
      errors.push(`graph node ${node.id} has invalid type`);
    if (!node.label) errors.push(`graph node ${node.id} lacks a label`);
    if (nodeDataAllowedKeys.has(node.type)) {
      assertAllowedKeys(
        node.data,
        nodeDataAllowedKeys.get(node.type),
        `graph node ${node.id}.data`,
        errors,
      );
    }
    if (node.type === "file") {
      const path = node.data?.path;
      if (!isRelativeSafePath(path) || !existsSync(resolve(repoRoot, path))) {
        errors.push(`graph file node ${node.id} does not resolve: ${path}`);
      }
    }
    if (node.type === "handoff") {
      const path = node.data?.path;
      if (!isRelativeSafePath(path) || !existsSync(resolve(runDir, path))) {
        errors.push(`graph handoff node ${node.id} does not resolve: ${path}`);
      } else if (!handoffs.has(normalizePath(path))) {
        errors.push(`graph handoff node ${node.id} is not a loaded receipt`);
      }
    }
    if (node.type === "commit") {
      validateCommit(node.data?.commit, `graph commit node ${node.id}`, errors);
    }
    if (node.type === "invariant" && !invariantsById.has(node.id)) {
      errors.push(
        `graph invariant node ${node.id} is absent from context.json`,
      );
    }
    if (node.type === "decision") {
      const decision = decisionsById.get(node.id);
      if (!decision || node.data?.status !== decision.status) {
        errors.push(
          `graph decision node ${node.id} is inconsistent with context.json`,
        );
      }
    }
    if (node.type === "question") {
      const question = questionsById.get(node.id);
      if (!question || node.data?.status !== question.status) {
        errors.push(
          `graph question node ${node.id} is inconsistent with context.json`,
        );
      }
    }
    if (node.type === "task") {
      const definition = tasks.get(node.id)?.definition;
      if (
        !definition ||
        (node.data?.orcaTaskId ?? null) !== (definition.orcaTaskId ?? null)
      ) {
        errors.push(
          `graph task node ${node.id} is inconsistent with task events`,
        );
      }
    }
    if (node.type === "model") {
      const role = roles.get(node.data?.roleId);
      if (!role || node.data?.modelId !== role.modelId) {
        errors.push(
          `graph model node ${node.id} is inconsistent with roles.json`,
        );
      }
    }
    if (node.type === "check") {
      if (
        !new Set(["passed", "failed", "not_run"]).has(node.data?.status) ||
        !node.data?.observed
      ) {
        errors.push(`graph check node ${node.id} lacks observed status`);
      }
      if (!node.data?.evidenceRoleId) {
        errors.push(`graph check node ${node.id} lacks an evidence owner`);
      } else if (!roles.has(node.data.evidenceRoleId)) {
        errors.push(
          `graph check node ${node.id} has an unknown evidence owner`,
        );
      }
      if (
        node.data?.command !== null &&
        typeof node.data?.command !== "string"
      ) {
        errors.push(`graph check node ${node.id} has an invalid command`);
      }
      const observationPath = node.data?.observationPath;
      const observation = observations.byPath.get(
        normalizePath(observationPath ?? ""),
      );
      if (!isRelativeSafePath(observationPath) || !observation) {
        errors.push(`graph check node ${node.id} lacks a loaded observation`);
      } else if (
        observation.value.observationId !== node.id ||
        observation.value.status !== node.data.status ||
        observation.value.observed !== node.data.observed ||
        (observation.value.command ?? null) !== (node.data.command ?? null) ||
        observation.value.observerRoleId !== node.data.evidenceRoleId ||
        observation.value.acceptanceCheckId !== node.data.acceptanceCheckId ||
        observation.value.completionEventId !== node.data.completionEventId ||
        observation.value.handoffSha256 !== node.data.handoffSha256
      ) {
        errors.push(
          `graph check node ${node.id} is inconsistent with its coordinator observation`,
        );
      }
    }
    nodes.set(node.id, node);
  }
  if (!nodes.has(context.runId) || nodes.get(context.runId)?.type !== "run") {
    errors.push("graph must contain the Run node");
  }
  const edgeKeys = new Set();
  const edgeEndpointTypes = new Map([
    [
      "includes",
      [
        new Set(["run"]),
        new Set(["requirement", "invariant", "decision", "question", "task"]),
      ],
    ],
    [
      "constrains",
      [new Set(["requirement", "invariant"]), new Set(["decision", "task"])],
    ],
    ["authorizes", [new Set(["decision"]), new Set(["task"])]],
    ["implements", [new Set(["task"]), new Set(["requirement", "decision"])]],
    ["touches", [new Set(["task"]), new Set(["file"])]],
    ["produces", [new Set(["run", "task"]), new Set(["commit"])]],
    ["verified-by", [new Set(["run", "task"]), new Set(["check"])]],
    ["reported-by", [new Set(["task"]), new Set(["handoff"])]],
    ["depends-on", [new Set(["task"]), new Set(["task"])]],
    [
      "decided-by",
      [new Set(["requirement", "question", "task"]), new Set(["decision"])],
    ],
    ["uses-model", [new Set(["task"]), new Set(["model"])]],
  ]);
  for (const [index, edge] of graph.edges.entries()) {
    if (
      !isObject(edge) ||
      !validateStableId(edge.id, `graph.edges[${index}].id`, errors)
    ) {
      continue;
    }
    assertAllowedKeys(
      edge,
      new Set(["id", "from", "to", "type"]),
      `graph.edges[${index}]`,
      errors,
    );
    if (edgeKeys.has(edge.id)) errors.push(`graph repeats edge ${edge.id}`);
    edgeKeys.add(edge.id);
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (!fromNode || !toNode) {
      errors.push(`graph edge ${edge.id} references a missing node`);
    }
    if (!graphEdgeTypes.has(edge.type)) {
      errors.push(`graph edge ${edge.id} has invalid type`);
    } else if (fromNode && toNode) {
      const [allowedFrom, allowedTo] = edgeEndpointTypes.get(edge.type);
      if (!allowedFrom.has(fromNode.type) || !allowedTo.has(toNode.type)) {
        errors.push(
          `graph edge ${edge.id} has invalid ${fromNode.type} -> ${toNode.type} endpoints for ${edge.type}`,
        );
      }
    }
  }
  for (const artifactRef of arrayOrEmpty(context.artifactRefs)) {
    if (!nodes.has(artifactRef))
      errors.push(`context artifactRef ${artifactRef} is unresolved`);
  }
  for (const [taskId, task] of tasks.entries()) {
    if (nodes.get(taskId)?.type !== "task")
      errors.push(`graph lacks task node ${taskId}`);
    for (const completedEvent of task.completedEvents) {
      const handoff = handoffs.get(
        normalizePath(completedEvent.data?.handoff ?? ""),
      );
      const linkedHandoff = graph.edges
        .filter(isObject)
        .some(
          (edge) =>
            edge.from === taskId &&
            edge.type === "reported-by" &&
            nodes.get(edge.to)?.type === "handoff" &&
            nodes.get(edge.to)?.data?.path === handoff?.relativePath,
        );
      if (!linkedHandoff)
        errors.push(
          `graph does not link ${taskId} to ${completedEvent.data?.handoff}`,
        );
    }
    if (task.acceptedEvent || task.rejectedEvent) {
      const linkedCheck = graph.edges
        .filter(isObject)
        .some(
          (edge) =>
            edge.from === taskId &&
            edge.type === "verified-by" &&
            nodes.get(edge.to)?.type === "check",
        );
      if (!linkedCheck)
        errors.push(`graph does not link ${taskId} to an observed check`);
    }
    for (const dependency of arrayOrEmpty(task.definition?.dependencies)) {
      if (
        !graph.edges
          .filter(isObject)
          .some(
            (edge) =>
              edge.from === taskId &&
              edge.to === dependency &&
              edge.type === "depends-on",
          )
      ) {
        errors.push(`graph lacks dependency edge ${taskId} -> ${dependency}`);
      }
    }
  }
  for (const [observationId] of observations.byId) {
    if (nodes.get(observationId)?.type !== "check") {
      errors.push(`graph lacks coordinator observation node ${observationId}`);
    }
  }
  return nodes;
}

async function validateRunUnchecked(runDirectory) {
  const runDir = resolve(runDirectory);
  const errors = [];
  const runRootReal = await requireRealDirectory(runDir, "Run directory");
  const fixturesRootReal = await requireRealDirectory(
    fixturesRoot,
    "tracked fixtures root",
  );
  const trustedFixturePath = realPathWithin(fixturesRootReal, runRootReal);
  await validateRunLayout(runDir, errors);
  if (errors.length > 0) throw new AgentStateValidationError(errors);
  const [{ raw: contextRaw, value: context }, { raw: graphRaw, value: graph }] =
    await Promise.all([
      parseJson(join(runDir, "context.json"), "context.json", runRootReal),
      parseJson(join(runDir, "graph.json"), "graph.json", runRootReal),
    ]);
  const coordinationRootReal = await requireRealDirectory(
    coordinationRoot,
    "coordination root",
  );
  const { raw: rolesRaw, value: rolesDocument } = await parseJson(
    rolesPath,
    "roles.json",
    coordinationRootReal,
  );
  for (const [raw, label, value] of [
    [contextRaw, "context.json", context],
    [graphRaw, "graph.json", graph],
    [rolesRaw, "roles.json", rolesDocument],
  ]) {
    scanRawText(raw, label, errors);
    scanSensitiveKeys(value, label, errors);
  }

  const roles = validateRoles(rolesDocument, errors);
  validateSchemaDefinition(
    "rolesDocument",
    rolesDocument,
    "roles.json",
    errors,
  );
  validateSchemaDefinition("context", context, "context.json", errors);
  validateSchemaDefinition("graph", graph, "graph.json", errors);
  validateContext(context, roles, errors);
  if (!isObject(context) || !isObject(graph)) {
    throw new AgentStateValidationError(errors);
  }
  if (context.mode === "fixture" && !trustedFixturePath) {
    errors.push(
      "fixture mode is allowed only beneath the tracked coordination fixtures root",
    );
  }
  const actorsByRoleId = new Map(
    arrayOrEmpty(context.actors)
      .filter(isObject)
      .map((actor) => [actor.roleId, actor]),
  );
  const actorStatuses = new Map(
    [...actorsByRoleId].map(([roleId, actor]) => [roleId, actor.status]),
  );
  const { events } = await loadTaskEvents(
    join(runDir, "tasks.jsonl"),
    errors,
    runRootReal,
  );
  const handoffs = await loadHandoffs(runDir, runRootReal, errors);
  const observations = await loadObservations(runDir, runRootReal, errors);

  const eventIds = new Set();
  const eventsById = new Map();
  const tasks = new Map();
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    const label = `tasks.jsonl:${index + 1}`;
    if (!isObject(event) || event.schemaVersion !== 1) {
      errors.push(`${label} must be a schemaVersion 1 object`);
      continue;
    }
    validateEventShape(event, label, errors);
    if (validateStableId(event.eventId, `${label}.eventId`, errors)) {
      if (eventIds.has(event.eventId))
        errors.push(`${label} repeats ${event.eventId}`);
      eventIds.add(event.eventId);
    }
    validateStableId(event.taskId, `${label}.taskId`, errors);
    if (event.runId !== context.runId)
      errors.push(`${label} uses another Run ID`);
    if (event.baseCommit !== context.base?.commit)
      errors.push(`${label} uses another base commit`);
    if (!roles.has(event.actorRoleId))
      errors.push(`${label} has unknown actor role`);
    if (!eventTypes.has(event.type))
      errors.push(`${label} has unsupported event type`);
    if (!isIsoDate(event.at)) {
      errors.push(`${label} has invalid timestamp`);
    } else {
      const timestamp = Date.parse(event.at);
      if (timestamp < previousTimestamp)
        errors.push(`${label} is out of chronological order`);
      previousTimestamp = timestamp;
    }
    if (!isObject(event.data)) errors.push(`${label}.data must be an object`);
    if (!tasks.has(event.taskId)) {
      tasks.set(event.taskId, {
        state: undefined,
        ownershipWindows: [],
        completedEvents: [],
      });
    }
    const task = tasks.get(event.taskId);
    if (
      new Set([
        "task.created",
        "task.assigned",
        "task.retried",
        "task.accepted",
        "task.rejected",
      ]).has(event.type) &&
      event.actorRoleId !== "codex"
    ) {
      errors.push(`${event.eventId} is a coordinator-owned transition`);
    }
    if (new Set(["task.assigned", "task.retried"]).has(event.type)) {
      const ownerRoleId = task.definition?.ownerRoleId;
      if (event.data?.assigneeRoleId !== ownerRoleId) {
        errors.push(`${event.eventId} does not assign the declared owner`);
      }
      if (event.type === "task.retried") {
        const referenced = eventsById.get(event.data?.retryOfEventId);
        if (
          !referenced ||
          referenced.taskId !== event.taskId ||
          !new Set(["task.failed", "task.rejected"]).has(referenced.type)
        ) {
          errors.push(
            `${event.eventId} does not reference this task's prior failed or rejected event`,
          );
        } else if (task.lastTerminalEvent?.eventId !== referenced.eventId) {
          errors.push(
            `${event.eventId} does not reference this task's latest failed or rejected event`,
          );
        }
      }
      if (actorStatuses.get(ownerRoleId) !== "ready") {
        errors.push(
          `${event.eventId} assigns role ${ownerRoleId} without ready evidence`,
        );
      }
      const evidenceTime = Date.parse(
        actorsByRoleId.get(ownerRoleId)?.modelEvidence?.observedAt ?? "",
      );
      const assignmentTime = Date.parse(event.at ?? "");
      if (
        !Number.isFinite(evidenceTime) ||
        !Number.isFinite(assignmentTime) ||
        evidenceTime > assignmentTime
      ) {
        errors.push(
          `${event.eventId} predates role ${ownerRoleId} model evidence`,
        );
      }
      for (const dependency of arrayOrEmpty(task.definition?.dependencies)) {
        if (tasks.get(dependency)?.state !== "accepted") {
          errors.push(
            `${event.eventId} assigns before dependency ${dependency} is accepted`,
          );
        }
      }
    }
    if (
      new Set([
        "task.started",
        "task.blocked",
        "task.resumed",
        "task.completed",
        "task.failed",
      ]).has(event.type) &&
      task.definition?.ownerRoleId !== event.actorRoleId
    ) {
      errors.push(
        `${event.eventId} is not reported by the declared task owner`,
      );
    }
    transitionTask(task, event, errors);
    if (!eventsById.has(event.eventId)) eventsById.set(event.eventId, event);
  }

  const completionReceiptReferences = new Map();
  const acceptanceCheckOwners = new Map();
  const receiptCheckOwners = new Map();
  for (const [taskId, task] of tasks.entries()) {
    validateTaskDefinition(taskId, task.definition, roles, errors);
    for (const checkId of arrayOrEmpty(task.definition?.acceptanceChecks)) {
      const priorOwner = acceptanceCheckOwners.get(checkId);
      if (priorOwner && priorOwner !== taskId) {
        errors.push(
          `${taskId} reuses acceptance check ${checkId} declared by ${priorOwner}`,
        );
      } else {
        acceptanceCheckOwners.set(checkId, taskId);
      }
    }
    for (const completedEvent of task.completedEvents) {
      const receiptPath = completedEvent.data?.handoff;
      if (!isRelativeSafePath(receiptPath)) {
        errors.push(`${taskId} completed with an unsafe handoff path`);
      }
      const normalizedReceiptPath = normalizePath(receiptPath ?? "");
      const priorReference = completionReceiptReferences.get(
        normalizedReceiptPath,
      );
      if (priorReference) {
        errors.push(
          `${completedEvent.eventId} reuses handoff receipt ${receiptPath} from ${priorReference}`,
        );
      } else if (normalizedReceiptPath) {
        completionReceiptReferences.set(
          normalizedReceiptPath,
          completedEvent.eventId,
        );
      }
      const handoff = handoffs.get(normalizedReceiptPath);
      validateHandoff(
        taskId,
        task,
        handoff,
        context.base?.commit,
        roles,
        errors,
      );
      for (const check of arrayOrEmpty(handoff?.value?.checks).filter(
        isObject,
      )) {
        const priorOwner = receiptCheckOwners.get(check.id);
        if (priorOwner && priorOwner !== completedEvent.eventId) {
          errors.push(
            `${completedEvent.eventId} reuses receipt check ${check.id} from ${priorOwner}`,
          );
        } else {
          receiptCheckOwners.set(check.id, completedEvent.eventId);
        }
      }
    }
  }
  for (const handoff of handoffs.values()) {
    if (!tasks.has(handoff.value.taskId)) {
      errors.push(`handoff references unknown task ${handoff.value.taskId}`);
    }
    if (!completionReceiptReferences.has(handoff.relativePath)) {
      errors.push(
        `${handoff.relativePath} is not referenced by a completion event`,
      );
    }
  }
  for (const observation of observations.byPath.values()) {
    validateCoordinatorObservation(observation, tasks, handoffs, roles, errors);
  }
  validateDependencyGraph(tasks, errors);
  validateWriterIsolation(tasks, errors);

  const expected = isObject(context.expectedFinalState)
    ? context.expectedFinalState
    : {};
  for (const [taskId, task] of tasks.entries()) {
    if (expected[taskId] !== task.state) {
      errors.push(
        `replayed state for ${taskId} is ${task.state}, expected ${expected[taskId] ?? "missing"}`,
      );
    }
  }
  for (const taskId of Object.keys(expected)) {
    if (!tasks.has(taskId))
      errors.push(`expectedFinalState references unknown task ${taskId}`);
  }

  const graphNodes = validateGraph(
    graph,
    context,
    tasks,
    handoffs,
    observations,
    runDir,
    roles,
    errors,
  );
  for (const [taskId, task] of tasks.entries()) {
    if (!task.acceptedEvent) continue;
    const basis = task.acceptedEvent.data?.basis;
    const declared = arrayOrEmpty(task.definition?.acceptanceChecks);
    if (!Array.isArray(basis) || basis.length === 0) {
      errors.push(`${taskId} was accepted without a non-empty basis`);
      continue;
    }
    const basisSet = new Set(basis);
    if (
      basisSet.size !== basis.length ||
      declared.some((checkId) => !basisSet.has(checkId)) ||
      basis.some((checkId) => !declared.includes(checkId))
    ) {
      errors.push(`${taskId} acceptance basis does not match declared checks`);
    }
    const finalHandoff = handoffs.get(
      normalizePath(task.currentCompletion?.data?.handoff ?? ""),
    );
    if (finalHandoff?.value?.outcome !== "succeeded") {
      errors.push(`${taskId} was accepted from a non-succeeded handoff`);
    }
    const observationIds = task.acceptedEvent.data?.observations;
    if (!Array.isArray(observationIds) || observationIds.length === 0) {
      errors.push(`${taskId} was accepted without coordinator observations`);
      continue;
    }
    const observationDigests = task.acceptedEvent.data?.observationDigests;
    if (!isObject(observationDigests)) {
      errors.push(`${taskId} was accepted without observation digests`);
      continue;
    }
    const observationIdSet = new Set(observationIds);
    if (observationIdSet.size !== observationIds.length) {
      errors.push(`${taskId} repeats a coordinator observation`);
    }
    const digestIds = Object.keys(observationDigests);
    if (
      digestIds.length !== observationIdSet.size ||
      digestIds.some((observationId) => !observationIdSet.has(observationId))
    ) {
      errors.push(
        `${taskId} observation digests do not match the selected observations`,
      );
    }
    const acceptanceObservations = new Map();
    for (const observationId of observationIds) {
      const observation = observations.byId.get(observationId);
      const value = observation?.value;
      const expectedObservationDigest = observationDigests[observationId];
      if (
        !sha256Pattern.test(expectedObservationDigest ?? "") ||
        sha256Bytes(observation?.rawBytes ?? Buffer.alloc(0)) !==
          expectedObservationDigest
      ) {
        errors.push(
          `${taskId} coordinator observation ${observationId} does not match its accepted digest`,
        );
      }
      if (
        !observation ||
        value.taskId !== taskId ||
        value.completionEventId !== task.currentCompletion?.eventId ||
        value.handoff !== task.currentCompletion?.data?.handoff ||
        value.status !== "passed" ||
        value.observerRoleId !== "codex" ||
        !basis.includes(value.acceptanceCheckId)
      ) {
        errors.push(
          `${taskId} references an invalid coordinator observation ${observationId}`,
        );
        continue;
      }
      const observedAt = Date.parse(value.observedAt);
      const completedAt = Date.parse(task.currentCompletion?.at ?? "");
      const acceptedAt = Date.parse(task.acceptedEvent.at);
      if (
        !Number.isFinite(observedAt) ||
        !Number.isFinite(completedAt) ||
        !Number.isFinite(acceptedAt) ||
        observedAt < completedAt ||
        observedAt > acceptedAt
      ) {
        errors.push(
          `${taskId} coordinator observation ${observationId} is outside its completion-to-acceptance window`,
        );
      }
      if (acceptanceObservations.has(value.acceptanceCheckId)) {
        errors.push(
          `${taskId} repeats observation for acceptance check ${value.acceptanceCheckId}`,
        );
      } else {
        acceptanceObservations.set(value.acceptanceCheckId, observation);
      }
    }
    for (const checkId of basis) {
      const observation = acceptanceObservations.get(checkId);
      const graphCheck = graphNodes.get(observation?.value?.observationId);
      if (!observation) {
        errors.push(
          `${taskId} acceptance check ${checkId} lacks passed Codex evidence`,
        );
      }
      if (
        graphCheck?.type !== "check" ||
        graphCheck.data?.status !== "passed" ||
        graphCheck.data?.evidenceRoleId !== "codex" ||
        graphCheck.data?.acceptanceCheckId !== checkId ||
        graphCheck.data?.observed !== observation?.value?.observed ||
        (graphCheck.data?.command ?? null) !==
          (observation?.value?.command ?? null) ||
        graphCheck.data?.handoffSha256 !== observation?.value?.handoffSha256
      ) {
        errors.push(
          `${taskId} acceptance check ${checkId} is inconsistent in graph.json`,
        );
      }
      if (
        !arrayOrEmpty(graph.edges)
          .filter(isObject)
          .some(
            (edge) =>
              edge.from === taskId &&
              edge.to === observation?.value?.observationId &&
              edge.type === "verified-by",
          )
      ) {
        errors.push(
          `${taskId} acceptance check ${checkId} is not linked to the task`,
        );
      }
    }
  }
  if (
    !(context.mode === "fixture" && trustedFixturePath) &&
    commitPattern.test(context.base?.commit ?? "")
  ) {
    try {
      git("cat-file", "-e", `${context.base.commit}^{commit}`);
    } catch {
      errors.push(
        `base commit ${context.base.commit} is not reachable in this repository`,
      );
    }
  }

  const finalRunReal = await requireRealDirectory(runDir, "Run directory");
  if (canonicalIdentifier(finalRunReal) !== canonicalIdentifier(runRootReal)) {
    errors.push("Run directory changed identity during validation");
  }

  if (errors.length > 0) throw new AgentStateValidationError(errors);
  return {
    runId: context.runId,
    mode: context.mode,
    eventCount: events.length,
    taskStates: Object.fromEntries(
      [...tasks.entries()].map(([taskId, task]) => [taskId, task.state]),
    ),
    nodeCount: graph.nodes.length,
    handoffCount: handoffs.size,
    observationCount: observations.byId.size,
  };
}

export async function validateRun(runDirectory) {
  try {
    return await validateRunUnchecked(runDirectory);
  } catch (error) {
    if (error instanceof AgentStateValidationError) throw error;
    throw new AgentStateValidationError([
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function assertSafeText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const errors = [];
  scanRawText(value, label, errors);
  if (errors.length > 0) throw new AgentStateValidationError(errors);
}

function assertSafeObjective(objective) {
  assertSafeText(objective, "objective");
}

async function writeJson(path, value, options = {}) {
  await writeFile(path, serializeJson(value), {
    encoding: "utf8",
    ...options,
  });
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeDurableExclusiveText(path, text) {
  let handle;
  try {
    handle = await open(path, "wx");
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function writeDurableExclusiveJson(path, value) {
  await writeDurableExclusiveText(path, serializeJson(value));
}

async function removeRegularFile(path, label) {
  if (!existsSync(path)) return;
  const pathStat = await lstat(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  await unlink(path);
}

async function publishExclusiveAtomicJson(path, value, temporaryPath) {
  const directory = dirname(path);
  await requireRealDirectory(directory, "current Run pointer directory");
  if (dirname(temporaryPath) !== directory) {
    throw new Error("current Run pointer temp file must share its directory");
  }
  try {
    await writeDurableExclusiveJson(temporaryPath, value);
    await link(temporaryPath, path);
  } catch (error) {
    try {
      await removeRegularFile(temporaryPath, "current Run pointer temp file");
    } catch {
      // Preserve the publish failure; a temp file cannot become the pointer.
    }
    throw error;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function validateOwnedDirectoryEntries(path, allowedNames, label) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (
      !allowedNames.has(entry.name) ||
      entry.isSymbolicLink() ||
      !entry.isFile()
    ) {
      throw new Error(`${label} contains an unsupported entry`);
    }
  }
}

async function removeInitializationLock(root, lockPath) {
  if (!existsSync(lockPath)) return;
  await requireRealDescendant(
    root,
    lockPath,
    "agent-state initialization lock",
    "directory",
  );
  await validateOwnedDirectoryEntries(
    lockPath,
    new Set(["owner.json"]),
    "agent-state initialization lock",
  );
  await rm(lockPath, { recursive: true, force: false });
}

async function acquireInitializationLock(root) {
  const lockPath = join(root, ".agent-state-init.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let created = false;
    try {
      await mkdir(lockPath, { recursive: false });
      created = true;
      await writeDurableExclusiveJson(join(lockPath, "owner.json"), {
        schemaVersion: 1,
        pid: process.pid,
      });
      return lockPath;
    } catch (error) {
      if (created) {
        await removeInitializationLock(root, lockPath);
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      await requireRealDescendant(
        root,
        lockPath,
        "agent-state initialization lock",
        "directory",
      );
      let owner = null;
      try {
        owner = (
          await parseJsonRegularFile(
            join(lockPath, "owner.json"),
            "agent-state initialization lock owner",
          )
        ).value;
      } catch {
        const lockStat = await lstat(lockPath);
        if (Date.now() - lockStat.mtimeMs < 5_000) {
          throw new Error("Agent-state initialization is already in progress");
        }
      }
      if (processIsAlive(owner?.pid)) {
        throw new Error("Agent-state initialization is already in progress");
      }
      await removeInitializationLock(root, lockPath);
    }
  }
  throw new Error("Unable to acquire the agent-state initialization lock");
}

async function createRunManifest(runDir) {
  const layoutErrors = [];
  const runRootReal = await requireRealDirectory(runDir, "Run manifest root");
  await validateRunLayout(runDir, layoutErrors);
  if (layoutErrors.length > 0) {
    throw new AgentStateValidationError(layoutErrors);
  }
  const files = [];
  for (const name of ["context.json", "tasks.jsonl", "graph.json"]) {
    const path = join(runDir, name);
    const { rawBytes } = await readUtf8FileStrict(path, name, runRootReal);
    files.push({ path: name, sha256: sha256Bytes(rawBytes) });
  }
  for (const directoryName of ["handoffs", "observations"]) {
    const directory = join(runDir, directoryName);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error("Run manifest encountered an unsupported entry");
      }
      const relativePath = `${directoryName}/${entry.name}`;
      const { rawBytes } = await readUtf8FileStrict(
        join(directory, entry.name),
        relativePath,
        runRootReal,
      );
      files.push({ path: relativePath, sha256: sha256Bytes(rawBytes) });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { schemaVersion: 1, files };
}

function validateRunManifest(manifest) {
  if (
    !isObject(manifest) ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("Agent-state transaction manifest is invalid");
  }
  const paths = new Set();
  for (const file of manifest.files) {
    if (
      !isObject(file) ||
      !isRelativeSafePath(file.path) ||
      !sha256Pattern.test(file.sha256 ?? "") ||
      paths.has(canonicalPath(file.path))
    ) {
      throw new Error("Agent-state transaction manifest is invalid");
    }
    paths.add(canonicalPath(file.path));
  }
}

async function assertRunManifest(runDir, expectedManifest) {
  validateRunManifest(expectedManifest);
  const actualManifest = await createRunManifest(runDir);
  if (JSON.stringify(actualManifest) !== JSON.stringify(expectedManifest)) {
    throw new Error("Agent-state transaction Run does not match its manifest");
  }
}

function validateTransactionIntent(intent, transactionDirectoryName) {
  const allowedKeys = new Set([
    "schemaVersion",
    "transactionId",
    "pid",
    "runId",
    "stageName",
    "orphanName",
    "pointerPath",
    "pointerTempName",
    "pointerTarget",
    "pointerSha256",
  ]);
  const errors = [];
  assertAllowedKeys(
    intent,
    allowedKeys,
    "agent-state transaction intent",
    errors,
  );
  if (
    !isObject(intent) ||
    intent?.schemaVersion !== 1 ||
    !transactionIdPattern.test(intent?.transactionId ?? "") ||
    transactionDirectoryName !== `.transaction-${intent?.transactionId}` ||
    !Number.isInteger(intent?.pid) ||
    intent?.pid <= 0 ||
    !stableIdPattern.test(intent?.runId ?? "") ||
    intent?.stageName !== `.staging-${intent?.transactionId}` ||
    intent?.orphanName !== `.orphan-${intent?.transactionId}`
  ) {
    errors.push("agent-state transaction intent has invalid identity fields");
  }
  if (!isObject(intent)) {
    throw new AgentStateValidationError(errors);
  }
  const pointerFields = [
    intent.pointerPath,
    intent.pointerTempName,
    intent.pointerTarget,
    intent.pointerSha256,
  ];
  const hasPointer = pointerFields.some((value) => value !== null);
  if (
    hasPointer &&
    (!pointerFields.every((value) => typeof value === "string") ||
      !isRelativeSafePath(intent.pointerPath) ||
      intent.pointerTempName !== `.pointer-${intent.transactionId}.json` ||
      !isRelativeSafePath(intent.pointerTempName) ||
      !isRelativeSafePath(intent.pointerTarget) ||
      !sha256Pattern.test(intent.pointerSha256))
  ) {
    errors.push("agent-state transaction intent has invalid pointer fields");
  }
  if (!hasPointer && !pointerFields.every((value) => value === null)) {
    errors.push("agent-state transaction intent has partial pointer fields");
  }
  if (errors.length > 0) throw new AgentStateValidationError(errors);
}

async function claimAndRemoveRunDirectory(
  root,
  sourcePath,
  orphanPath,
  manifest,
) {
  if (!existsSync(sourcePath)) return;
  await requireRealDescendant(
    root,
    sourcePath,
    "agent-state transaction Run",
    "directory",
  );
  await assertRunManifest(sourcePath, manifest);
  let claimedPath = sourcePath;
  if (canonicalPath(sourcePath) !== canonicalPath(orphanPath)) {
    if (existsSync(orphanPath)) {
      throw new Error("Agent-state transaction orphan already exists");
    }
    await rename(sourcePath, orphanPath);
    claimedPath = orphanPath;
  }
  await requireRealDescendant(
    root,
    claimedPath,
    "agent-state transaction orphan",
    "directory",
  );
  await assertRunManifest(claimedPath, manifest);
  await rm(claimedPath, { recursive: true, force: false });
}

async function removeTransactionDirectory(root, transactionDir) {
  if (!existsSync(transactionDir)) return;
  await requireRealDescendant(
    root,
    transactionDir,
    "agent-state transaction directory",
    "directory",
  );
  await validateOwnedDirectoryEntries(
    transactionDir,
    new Set(["intent.json", "manifest.json"]),
    "agent-state transaction directory",
  );
  await rm(transactionDir, { recursive: true, force: false });
}

async function validatePartialInitializedRun(path) {
  const allowedRootEntries = new Map([
    ["context.json", "file"],
    ["tasks.jsonl", "file"],
    ["graph.json", "file"],
    ["handoffs", "directory"],
    ["observations", "directory"],
  ]);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const expectedType = allowedRootEntries.get(entry.name);
    if (
      !expectedType ||
      entry.isSymbolicLink() ||
      (expectedType === "file" && !entry.isFile()) ||
      (expectedType === "directory" && !entry.isDirectory())
    ) {
      throw new Error("Partial agent-state Run contains an unsupported entry");
    }
    if (expectedType === "directory") {
      for (const child of await readdir(join(path, entry.name), {
        withFileTypes: true,
      })) {
        if (
          !child.isFile() ||
          child.isSymbolicLink() ||
          !stateFilePattern.test(child.name)
        ) {
          throw new Error(
            "Partial agent-state Run contains an unsupported nested entry",
          );
        }
      }
    }
  }
}

async function discardUnmanifestedTransaction(
  root,
  transactionDir,
  stageDir,
  runDir,
  orphanDir,
) {
  if (existsSync(runDir)) {
    throw new Error(
      "Unmanifested agent-state transaction unexpectedly published a Run",
    );
  }
  if (existsSync(orphanDir)) {
    throw new Error("Partial agent-state transaction orphan already exists");
  }
  if (existsSync(stageDir)) {
    await requireRealDescendant(
      root,
      stageDir,
      "partial agent-state staging Run",
      "directory",
    );
    await validatePartialInitializedRun(stageDir);
    await rename(stageDir, orphanDir);
    await requireRealDescendant(
      root,
      orphanDir,
      "partial agent-state transaction orphan",
      "directory",
    );
    await validatePartialInitializedRun(orphanDir);
    await rm(orphanDir, { recursive: true, force: false });
  }
  await removeTransactionDirectory(root, transactionDir);
}

async function loadValidatedTransactionIntent(root, transactionDir) {
  const transactionDirectoryName = basename(transactionDir);
  const rootReal = await requireRealDirectory(root, "agent-state runs root");
  const { raw: intentRaw, value: intent } = await parseJsonRegularFile(
    join(transactionDir, "intent.json"),
    "agent-state transaction intent",
    rootReal,
  );
  const intentErrors = [];
  scanRawText(intentRaw, "agent-state transaction intent", intentErrors);
  scanSensitiveKeys(intent, "agent-state transaction intent", intentErrors);
  if (intentErrors.length > 0) {
    throw new AgentStateValidationError(intentErrors);
  }
  validateTransactionIntent(intent, transactionDirectoryName);
  return intent;
}

async function recoverTransaction(
  root,
  transactionDir,
  pointerBase,
  effectivePointer,
) {
  const intent = await loadValidatedTransactionIntent(root, transactionDir);
  const rootReal = await requireRealDirectory(root, "agent-state runs root");
  const { value: manifest } = await parseJsonRegularFile(
    join(transactionDir, "manifest.json"),
    "agent-state transaction manifest",
    rootReal,
  );
  validateRunManifest(manifest);

  const stagePath = join(root, intent.stageName);
  const runPath = join(root, intent.runId);
  const orphanPath = join(root, intent.orphanName);
  let committed = false;
  let pointerPathForIntent = null;
  let pointerTempPath = null;
  if (intent.pointerPath !== null) {
    const pointerBaseReal = await requireRealDirectory(
      pointerBase,
      "current Run pointer base",
    );
    pointerPathForIntent = resolve(pointerBase, intent.pointerPath);
    const pointerParentReal = await requireRealDirectory(
      dirname(pointerPathForIntent),
      "current Run pointer directory",
    );
    if (!realPathWithin(pointerBaseReal, pointerParentReal, true)) {
      throw new Error("Recovered current Run pointer escapes its real base");
    }
    if (
      effectivePointer &&
      canonicalPath(pointerPathForIntent) !== canonicalPath(effectivePointer)
    ) {
      throw new Error("Recovered transaction targets another current pointer");
    }
    pointerTempPath = join(
      dirname(pointerPathForIntent),
      intent.pointerTempName,
    );
    if (existsSync(pointerPathForIntent)) {
      const { rawBytes: pointerRawBytes, value: pointer } =
        await parseJsonRegularFile(
          pointerPathForIntent,
          "current-run.json",
          pointerBaseReal,
        );
      if (
        sha256Bytes(pointerRawBytes) === intent.pointerSha256 &&
        pointer?.schemaVersion === 1 &&
        pointer.runId === intent.runId &&
        normalizePath(pointer.path) === normalizePath(intent.pointerTarget)
      ) {
        committed = true;
      } else if (
        pointer?.runId === intent.runId ||
        normalizePath(pointer?.path ?? "") ===
          normalizePath(intent.pointerTarget)
      ) {
        throw new Error(
          "Published current Run pointer is inconsistent with its transaction",
        );
      }
    }
  }

  if (committed) {
    await requireRealDescendant(
      root,
      runPath,
      "published transaction Run",
      "directory",
    );
    await assertRunManifest(runPath, manifest);
    await validateRun(runPath);
  } else {
    const ownedCandidates = [stagePath, runPath, orphanPath].filter((path) =>
      existsSync(path),
    );
    if (ownedCandidates.length > 1) {
      throw new Error(
        "Agent-state transaction has multiple owned Run directories",
      );
    }
    for (const candidate of ownedCandidates) {
      await claimAndRemoveRunDirectory(root, candidate, orphanPath, manifest);
    }
  }
  if (pointerTempPath) {
    await removeRegularFile(pointerTempPath, "current Run pointer temp file");
  }
  await removeTransactionDirectory(root, transactionDir);
  return committed;
}

async function recoverInitializationTransactions(
  root,
  pointerBase,
  effectivePointer,
) {
  const transactionEntries = (
    await readdir(root, { withFileTypes: true })
  ).filter((entry) => entry.name.startsWith(".transaction-"));
  if (transactionEntries.length > 1) {
    throw new Error(
      "Multiple unfinished agent-state transactions require manual review",
    );
  }
  for (const entry of transactionEntries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("Agent-state transaction entry is not a real directory");
    }
    const transactionDir = join(root, entry.name);
    await requireRealDescendant(
      root,
      transactionDir,
      "agent-state transaction directory",
      "directory",
    );
    const transactionId = entry.name.slice(".transaction-".length);
    if (!transactionIdPattern.test(transactionId)) {
      throw new Error("Agent-state transaction directory has an invalid name");
    }
    const transactionChildren = await readdir(transactionDir, {
      withFileTypes: true,
    });
    if (transactionChildren.length === 0) {
      for (const siblingName of [
        `.staging-${transactionId}`,
        `.orphan-${transactionId}`,
      ]) {
        if (existsSync(join(root, siblingName))) {
          throw new Error(
            "Empty agent-state transaction has an unexplained sibling directory",
          );
        }
      }
      await removeTransactionDirectory(root, transactionDir);
      continue;
    }
    if (!existsSync(join(transactionDir, "intent.json"))) {
      throw new Error("Agent-state transaction is missing its intent");
    }
    if (!existsSync(join(transactionDir, "manifest.json"))) {
      await validateOwnedDirectoryEntries(
        transactionDir,
        new Set(["intent.json"]),
        "unmanifested agent-state transaction directory",
      );
      const intent = await loadValidatedTransactionIntent(root, transactionDir);
      if (intent.pointerPath !== null) {
        const pointerTempPath = join(
          dirname(resolve(pointerBase, intent.pointerPath)),
          intent.pointerTempName,
        );
        if (existsSync(pointerTempPath)) {
          throw new Error(
            "Unmanifested agent-state transaction has an unexpected pointer temp file",
          );
        }
      }
      await discardUnmanifestedTransaction(
        root,
        transactionDir,
        join(root, intent.stageName),
        join(root, intent.runId),
        join(root, intent.orphanName),
      );
      continue;
    }
    await recoverTransaction(
      root,
      transactionDir,
      pointerBase,
      effectivePointer,
    );
  }
}

function triggerInitializationFailpoint(name) {
  if (process.env.LOGION_AGENT_STATE_FAILPOINT === name) {
    process.exit(initializationFailpointExitCode);
  }
}

export async function initializeRun({
  runId,
  objective,
  baseCommit = git("rev-parse", "HEAD"),
  branch = git("branch", "--show-current") || "detached",
  runsRoot = defaultRunsRoot,
  pointerPath,
  pointerBase = repoRoot,
}) {
  if (!stableIdPattern.test(runId ?? "") || !runId.startsWith("run-")) {
    throw new Error("--run-id must use the form run-lowercase-hyphenated-id");
  }
  if (typeof objective !== "string" || objective.trim().length === 0) {
    throw new Error("--objective is required");
  }
  assertSafeObjective(objective);
  assertSafeText(branch, "branch");
  if (!commitPattern.test(baseCommit))
    throw new Error("base commit must be a full Git SHA");

  const root = resolve(runsRoot);
  await mkdir(root, { recursive: true });
  await requireRealDirectory(root, "agent-state runs root");
  const runDir = resolve(root, runId);
  if (!resolvesInside(root, runId))
    throw new Error("run ID escapes the runs directory");
  const effectivePointer =
    pointerPath ??
    (resolve(root) === resolve(defaultRunsRoot) ? defaultPointerPath : null);
  let pointerRelativePath = null;
  let pointerTarget = null;
  let pointerValue = null;
  if (
    effectivePointer &&
    !resolvesInside(
      resolve(pointerBase),
      relative(resolve(pointerBase), resolve(effectivePointer)),
    )
  ) {
    throw new Error("current Run pointer escapes its pointer base");
  }
  if (effectivePointer) {
    const pointerBaseReal = await requireRealDirectory(
      pointerBase,
      "current Run pointer base",
    );
    const pointerParentReal = await requireRealDirectory(
      dirname(resolve(effectivePointer)),
      "current Run pointer directory",
    );
    if (!realPathWithin(pointerBaseReal, pointerParentReal, true)) {
      throw new Error("current Run pointer escapes its real pointer base");
    }
    pointerRelativePath = normalizePath(
      relative(resolve(pointerBase), resolve(effectivePointer)),
    );
    pointerTarget = normalizePath(relative(resolve(pointerBase), runDir));
    if (
      !isRelativeSafePath(pointerRelativePath) ||
      !isRelativeSafePath(pointerTarget)
    ) {
      throw new Error("current Run pointer cannot be represented safely");
    }
    pointerValue = { schemaVersion: 1, runId, path: pointerTarget };
  }

  const transactionId = `tx-${randomUUID().replaceAll("-", "")}`;
  const stageName = `.staging-${transactionId}`;
  const orphanName = `.orphan-${transactionId}`;
  const stageDir = resolve(root, stageName);
  if (!resolvesInside(root, stageName)) {
    throw new Error("staging directory escapes the runs directory");
  }
  const transactionDir = join(root, `.transaction-${transactionId}`);
  const pointerTempName = effectivePointer
    ? `.pointer-${transactionId}.json`
    : null;
  const pointerTempPath = effectivePointer
    ? join(dirname(resolve(effectivePointer)), pointerTempName)
    : null;
  const intent = {
    schemaVersion: 1,
    transactionId,
    pid: process.pid,
    runId,
    stageName,
    orphanName,
    pointerPath: pointerRelativePath,
    pointerTempName,
    pointerTarget,
    pointerSha256: pointerValue
      ? sha256Bytes(Buffer.from(serializeJson(pointerValue), "utf8"))
      : null,
  };

  const context = {
    schemaVersion: 1,
    runId,
    mode: "active",
    objective: objective.trim(),
    authority: {
      singleWriterRoleId: "codex",
      systemOfRecord: "windows-local-ledger",
    },
    base: { repository: "Logion", commit: baseCommit, branch },
    actors: [{ roleId: "codex", status: "pending" }],
    invariants: [
      {
        id: "invariant-single-writer",
        summary: "Windows Codex is the sole ledger writer.",
      },
      {
        id: "invariant-no-secrets",
        summary: "Coordination state contains no secrets or private host data.",
      },
    ],
    decisions: [],
    openQuestions: [],
    artifactRefs: [],
    expectedFinalState: {},
  };
  const graph = {
    schemaVersion: 1,
    runId,
    nodes: [{ id: runId, type: "run", label: objective.trim(), data: {} }],
    edges: [],
  };
  const lockPath = await acquireInitializationLock(root);
  let summary;
  try {
    await recoverInitializationTransactions(
      root,
      pointerBase,
      effectivePointer ? resolve(effectivePointer) : null,
    );
    if (existsSync(runDir)) throw new Error(`Run already exists: ${runId}`);
    if (effectivePointer && existsSync(effectivePointer)) {
      throw new Error(
        "A current Run pointer already exists; close and remove it explicitly before initializing another Run",
      );
    }
    await mkdir(transactionDir, { recursive: false });
    triggerInitializationFailpoint("after-transaction-created");
    await writeDurableExclusiveJson(
      join(transactionDir, "intent.json"),
      intent,
    );
    triggerInitializationFailpoint("after-intent-durable");
    await mkdir(stageDir, { recursive: false });
    await Promise.all([
      mkdir(join(stageDir, "handoffs"), { recursive: false }),
      mkdir(join(stageDir, "observations"), { recursive: false }),
    ]);
    await Promise.all([
      writeDurableExclusiveJson(join(stageDir, "context.json"), context),
      writeDurableExclusiveText(join(stageDir, "tasks.jsonl"), ""),
      writeDurableExclusiveJson(join(stageDir, "graph.json"), graph),
    ]);
    triggerInitializationFailpoint("after-stage-files-durable");
    const manifest = await createRunManifest(stageDir);
    await writeDurableExclusiveJson(
      join(transactionDir, "manifest.json"),
      manifest,
    );
    summary = await validateRun(stageDir);
    triggerInitializationFailpoint("after-stage-durable");
    await rename(stageDir, runDir);
    triggerInitializationFailpoint("after-run-published");
    if (effectivePointer) {
      await publishExclusiveAtomicJson(
        resolve(effectivePointer),
        pointerValue,
        pointerTempPath,
      );
      triggerInitializationFailpoint("after-pointer-published");
      await removeRegularFile(pointerTempPath, "current Run pointer temp file");
    }
    await removeTransactionDirectory(root, transactionDir);
  } catch (error) {
    if (existsSync(transactionDir)) {
      try {
        if (existsSync(join(transactionDir, "manifest.json"))) {
          await recoverTransaction(
            root,
            transactionDir,
            pointerBase,
            effectivePointer ? resolve(effectivePointer) : null,
          );
        } else {
          await discardUnmanifestedTransaction(
            root,
            transactionDir,
            stageDir,
            runDir,
            join(root, orphanName),
          );
        }
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "Agent-state initialization failed and recovery requires review",
        );
      }
    }
    throw error;
  } finally {
    await removeInitializationLock(root, lockPath);
  }
  return { runDir, summary };
}

function getFlag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export async function resolveCurrentRun({
  pointerPath = defaultPointerPath,
  pointerBase = repoRoot,
  runsRoot = defaultRunsRoot,
} = {}) {
  try {
    const errors = [];
    const pointerBaseReal = await requireRealDirectory(
      pointerBase,
      "current Run pointer base",
    );
    const pointerParentReal = await requireRealDirectory(
      dirname(resolve(pointerPath)),
      "current Run pointer directory",
    );
    if (!realPathWithin(pointerBaseReal, pointerParentReal, true)) {
      errors.push("current-run.json escapes its real pointer base");
    }
    const pointerReal = await requireRealDescendant(
      pointerBase,
      resolve(pointerPath),
      "current-run.json",
      "file",
    );
    if (!realPathWithin(pointerBaseReal, pointerReal)) {
      errors.push("current-run.json escapes its real pointer base");
    }
    const { raw, value: pointer } = await parseJsonRegularFile(
      pointerPath,
      "current-run.json",
      pointerBaseReal,
    );
    scanRawText(raw, "current-run.json", errors);
    scanSensitiveKeys(pointer, "current-run.json", errors);
    validateSchemaDefinition("pointer", pointer, "current-run.json", errors);
    assertAllowedKeys(
      pointer,
      new Set(["schemaVersion", "runId", "path"]),
      "current-run.json",
      errors,
    );
    validateStableId(pointer?.runId, "current-run.json.runId", errors);
    if (pointer?.schemaVersion !== 1 || !isRelativeSafePath(pointer?.path)) {
      errors.push("current-run.json is invalid");
    }
    if (errors.length > 0) throw new AgentStateValidationError(errors);

    const runDir = resolve(pointerBase, pointer.path);
    const expectedRunDir = resolve(runsRoot, pointer.runId);
    if (
      !resolvesInside(runsRoot, relative(resolve(runsRoot), runDir)) ||
      canonicalPath(runDir) !== canonicalPath(expectedRunDir)
    ) {
      errors.push("current-run.json path does not match its runId directory");
      throw new AgentStateValidationError(errors);
    }
    const runsRootReal = await requireRealDirectory(
      runsRoot,
      "agent-state runs root",
    );
    const runReal = await requireRealDescendant(
      runsRoot,
      runDir,
      "current Run directory",
      "directory",
    );
    if (!realPathWithin(runsRootReal, runReal)) {
      errors.push("current Run directory escapes its real runs root");
    }
    await validateRunLayout(runDir, errors);
    if (errors.length > 0) throw new AgentStateValidationError(errors);

    const { raw: contextRaw, value: context } = await parseJsonRegularFile(
      join(runDir, "context.json"),
      "current Run context.json",
      runReal,
    );
    scanRawText(contextRaw, "current Run context.json", errors);
    scanSensitiveKeys(context, "current Run context.json", errors);
    if (!isObject(context)) {
      errors.push("current Run context.json must contain an object");
    } else {
      if (context.runId !== pointer.runId) {
        errors.push("current-run.json runId does not match its context.json");
      }
      if (context.mode !== "active") {
        errors.push("current-run.json must point to an active Run");
      }
    }
    if (errors.length > 0) throw new AgentStateValidationError(errors);
    return runDir;
  } catch (error) {
    if (error instanceof AgentStateValidationError) throw error;
    throw new AgentStateValidationError([
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

async function resolveRunArgument(argument) {
  if (argument) return resolve(argument);
  return resolveCurrentRun();
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const args = rawArgs.filter((argument) => argument !== "--");
  if (command === "validate") {
    const runDir = await resolveRunArgument(args[0]);
    console.log(JSON.stringify(await validateRun(runDir), null, 2));
    return;
  }
  if (command === "init") {
    const runId = getFlag(args, "--run-id");
    const objective = getFlag(args, "--objective");
    const baseCommit = getFlag(args, "--base-commit");
    const branch = getFlag(args, "--branch");
    const runsRoot = getFlag(args, "--runs-root");
    const pointerPath = getFlag(args, "--pointer-path");
    const pointerBase = getFlag(args, "--pointer-base");
    const result = await initializeRun({
      runId,
      objective,
      ...(baseCommit ? { baseCommit } : {}),
      ...(branch ? { branch } : {}),
      ...(runsRoot ? { runsRoot } : {}),
      ...(pointerPath ? { pointerPath } : {}),
      ...(pointerBase ? { pointerBase } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(
    "Usage: node scripts/agent-state.mjs <init --run-id ID --objective TEXT [--base-commit SHA --branch NAME --runs-root PATH --pointer-path PATH --pointer-base PATH] | validate [RUN_DIR]>",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath.toLowerCase() === resolve(scriptPath).toLowerCase()) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
