#!/usr/bin/env node
// Switch the extension between build variants:
//
//   node scripts/set-variant.mjs local   # sidecar enabled (fast local polling)
//   node scripts/set-variant.mjs store   # sidecar stripped (Raycast Store)
//
// Rewrites src/flags.ts and adds/removes the start-sidecar command in
// package.json. The store variant must not ship a command that spawns a
// detached background process.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const variant = process.argv[2];

if (variant !== "local" && variant !== "store") {
  console.error("Usage: node scripts/set-variant.mjs <local|store>");
  process.exit(1);
}

const sidecarEnabled = variant === "local";

const START_SIDECAR_COMMAND = {
  name: "start-sidecar",
  title: "Start Linear Diffs Sidecar",
  description: "Start the local SQLite poller for Linear Diffs.",
  mode: "no-view",
};

// flags.ts
const flagsPath = join(root, "src", "flags.ts");
const flags = readFileSync(flagsPath, "utf8");
writeFileSync(
  flagsPath,
  flags.replace(
    /export const SIDECAR_ENABLED = (true|false);/,
    `export const SIDECAR_ENABLED = ${sidecarEnabled};`,
  ),
);

// package.json
const packagePath = join(root, "package.json");
const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
manifest.commands = manifest.commands.filter(
  (command) => command.name !== "start-sidecar",
);
if (sidecarEnabled) {
  manifest.commands.push(START_SIDECAR_COMMAND);
}
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Variant set to "${variant}" (SIDECAR_ENABLED=${sidecarEnabled}).`,
);
