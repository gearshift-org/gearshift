#!/usr/bin/env node
// Generate grouped release notes from conventional-commit messages.
//
// Usage:
//   node scripts/release-notes.mjs <tag> [previousTag]
//
// If <tag> is omitted it falls back to the current HEAD tag.
// If [previousTag] is omitted it uses the most recent tag before <tag>.
// Output (markdown) is written to stdout.

import { execSync } from "node:child_process";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

const tag = process.argv[2] || sh("git describe --tags --abbrev=0");

// Resolve the previous tag (the newest tag that is an ancestor before `tag`).
let prevTag = process.argv[3];
if (!prevTag) {
  try {
    prevTag = sh(`git describe --tags --abbrev=0 ${tag}^`);
  } catch {
    prevTag = ""; // No earlier tag — include full history.
  }
}

const range = prevTag ? `${prevTag}..${tag}` : tag;

// Read commits in the range: "<subject>\x1f<short-hash>" per line.
const raw = sh(`git log ${range} --no-merges --pretty=format:%s%x1f%h`);
const commits = raw
  ? raw.split("\n").map((line) => {
      const [subject, hash] = line.split("\x1f");
      return { subject, hash };
    })
  : [];

// Map conventional-commit types to release-note sections.
const sections = [
  { title: "✨ Features", types: ["feat"], items: [] },
  { title: "🐛 Fixes", types: ["fix"], items: [] },
  { title: "⚡ Performance", types: ["perf"], items: [] },
  {
    title: "🔧 Under the Hood",
    types: ["refactor", "chore", "build", "ci", "test", "style", "docs"],
    items: [],
  },
];
const other = { title: "📦 Other Changes", items: [] };

const TYPE_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;

for (const { subject, hash } of commits) {
  // Skip the release commit itself (chore(release): vX.Y.Z).
  if (/^chore\(release\):/.test(subject)) continue;

  const match = subject.match(TYPE_RE);
  if (match) {
    const [, type, scope, desc] = match;
    const text = scope ? `**${scope}:** ${desc}` : desc;
    const line = `- ${text} (${hash})`;
    const section = sections.find((s) => s.types.includes(type));
    (section ? section.items : other.items).push(line);
  } else {
    other.items.push(`- ${subject} (${hash})`);
  }
}

const parts = [`## What's New in ${tag}`, ""];
for (const section of [...sections, other]) {
  if (section.items.length === 0) continue;
  parts.push(`### ${section.title}`, ...section.items, "");
}

if (prevTag) {
  // owner/repo from the origin remote, for the compare link.
  let repo = "";
  try {
    const url = sh("git remote get-url origin");
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (m) repo = m[1];
  } catch {
    /* no remote — skip the link */
  }
  if (repo) {
    parts.push(
      "---",
      `**Full Changelog:** https://github.com/${repo}/compare/${prevTag}...${tag}`,
    );
  }
}

process.stdout.write(parts.join("\n") + "\n");
