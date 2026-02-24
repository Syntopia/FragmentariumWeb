import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { incrementBuildVersionString } from "./buildVersionUtils.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const buildVersionPath = resolve(scriptsDir, "..", "build-version.json");
const formatBuildDateUtc = (date) => date.toISOString().slice(0, 10);

const rawFileContents = readFileSync(buildVersionPath, "utf8");
const parsedFile = JSON.parse(rawFileContents);

if (parsedFile === null || typeof parsedFile !== "object" || Array.isArray(parsedFile)) {
  throw new Error("build-version.json must contain an object with a 'version' string.");
}
if (typeof parsedFile.version !== "string") {
  throw new Error("build-version.json must contain a 'version' string.");
}

const previousVersion = parsedFile.version;
const nextVersion = incrementBuildVersionString(previousVersion);

writeFileSync(
  buildVersionPath,
  `${JSON.stringify({ version: nextVersion, buildDate: formatBuildDateUtc(new Date()) }, null, 2)}\n`,
  "utf8"
);

console.log(`[build-version] ${previousVersion} -> ${nextVersion}`);
