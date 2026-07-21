import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";
import { format } from "prettier";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageRoot, "schemas", "sync-v1.schema.json");
const outputPath = resolve(
  packageRoot,
  "src",
  "sync-v1-validator.generated.js",
);
const declarationPath = resolve(
  packageRoot,
  "src",
  "sync-v1-validator.generated.d.ts",
);

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const ajv = new Ajv2020({
  allErrors: false,
  code: { esm: true, optimize: true, source: true },
  strict: true,
});
addFormats(ajv);
const validate = ajv.compile(schema);
const dateTimeImport =
  'require("ajv-formats/dist/formats").fullFormats["date-time"]';
const deepEqualImport = 'require("ajv/dist/runtime/equal").default';
const dateTimeHelper = String.raw`
const RFC3339_DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const RFC3339_TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)$/i;
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
  if (month < 1 || month > 12 || day < 1 || maxDay === undefined || day > maxDay) return false;
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
  return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1) && second < 61;
}

// sync-v1 uses uniqueItems only for UUID and enum string arrays.
function equalSyncV1UniqueItem(left, right) {
  return left === right;
}
`;
const standalone = standaloneCode(ajv, validate);
if (!standalone.includes(dateTimeImport)) {
  throw new Error("AJV standalone date-time format hook changed unexpectedly");
}
const selfContained = standalone
  .replace(dateTimeImport, "{ validate: validateRfc3339DateTime }")
  .replace(deepEqualImport, "equalSyncV1UniqueItem");
if (selfContained.includes("require(")) {
  throw new Error("Generated sync validator must not contain runtime requires");
}
const generated = `/* Generated from schemas/sync-v1.schema.json. Do not edit manually. */\n${dateTimeHelper}\n${selfContained}`;

await writeFile(
  outputPath,
  await format(generated, { parser: "babel" }),
  "utf8",
);
await writeFile(
  declarationPath,
  await format(
    `/* Generated from schemas/sync-v1.schema.json. Do not edit manually. */
export interface GeneratedSyncV1ValidationError {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
}
export interface GeneratedSyncV1Validator {
  (value: unknown): boolean;
  readonly errors?: readonly GeneratedSyncV1ValidationError[] | null;
}
declare const validate: GeneratedSyncV1Validator;
export default validate;
`,
    { parser: "typescript" },
  ),
  "utf8",
);
