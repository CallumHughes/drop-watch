#!/usr/bin/env node
// Upsert a system-recap block into a PR description without touching any
// text outside the markers. Usage:
//   node upsert-recap-block.mjs <pr-number> <block-file>
// The block file must start with the start marker and end with the end
// marker. Requires the `gh` CLI to be authenticated.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const startMarker = "<!-- system-recap:start -->";
const endMarker = "<!-- system-recap:end -->";

const [prNumber, blockFile] = process.argv.slice(2);
if (!(prNumber && blockFile)) {
  console.error("usage: upsert-recap-block.mjs <pr-number> <block-file>");
  process.exit(1);
}

const block = readFileSync(blockFile, "utf8").trim();
if (!(block.startsWith(startMarker) && block.endsWith(endMarker))) {
  console.error(`block file must start with "${startMarker}" and end with "${endMarker}"`);
  process.exit(1);
}

// Read and write via the REST API: `gh pr edit` queries the deprecated
// projectCards GraphQL field and fails on repos where Projects (classic)
// is disabled.
const repo = execFileSync(
  "gh",
  ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
  { encoding: "utf8" }
).trim();

const body = execFileSync("gh", ["api", `repos/${repo}/pulls/${prNumber}`, "--jq", '.body // ""'], {
  encoding: "utf8",
});

const startIndex = body.indexOf(startMarker);
const endIndex = body.indexOf(endMarker);
const hasExistingBlock = startIndex !== -1 && endIndex !== -1 && endIndex > startIndex;

const nextBody = hasExistingBlock
  ? body.slice(0, startIndex) + block + body.slice(endIndex + endMarker.length)
  : `${body.trimEnd()}\n\n${block}\n`;

execFileSync("gh", ["api", `repos/${repo}/pulls/${prNumber}`, "-X", "PATCH", "-F", "body=@-"], {
  input: nextBody,
  stdio: ["pipe", "ignore", "inherit"],
});

console.log(
  hasExistingBlock
    ? `updated system-recap block on PR #${prNumber}`
    : `added system-recap block to PR #${prNumber}`
);
