// Publish the local markdown issues under .scratch/smart-video-editor/ as
// GitHub issues that the Sandcastle planner can pick up.
//
// LEGACY: one-off importer from the local-markdown era. The standard flow is
// now `/to-spec` + `/to-tickets` against the GitHub tracker; do not use this
// script for new work.
//
// Usage:
//   node .sandcastle/sync-issues.mjs
//
// Requires GH_TOKEN in .sandcastle/.env with Issues: Read and write.
// Idempotent: issues are matched by title, so re-running updates instead of
// duplicating. Creates:
//   - one parent PRD issue from spec.md (no Sandcastle label)
//   - one Sandcastle-labeled issue per file in .scratch/.../issues/
// and rewrites "Blocked by: 01 ..." references to the real GitHub numbers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "huangzj1996/cut-video";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = `https://api.github.com/repos/${REPO}`;
const LABEL = "Sandcastle";

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const token = readEnv(path.join(ROOT, ".sandcastle/.env")).GH_TOKEN;
if (!token) throw new Error("GH_TOKEN missing from .sandcastle/.env");

const headers = {
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "sandcastle-issue-sync",
  "x-github-api-version": "2022-11-28",
};

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, { headers, ...init });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const detail = typeof json === "string" ? json : JSON.stringify(json);
    const err = new Error(`${init.method ?? "GET"} ${pathname} -> ${res.status}: ${detail}`);
    err.status = res.status;
    err.acceptedPermissions = res.headers.get("x-accepted-github-permissions");
    throw err;
  }
  return json;
}

function permissionHelp(err) {
  return [
    "GitHub rejected the request: the GH_TOKEN in .sandcastle/.env cannot write issues.",
    `GitHub says required permissions: ${err.acceptedPermissions ?? "(unknown)"}`,
    "",
    "Fix: open https://github.com/settings/personal-access-tokens, edit the token,",
    "ensure it has access to huangzj1996/cut-video, and set",
    "  Repository permissions -> Issues -> Read and write",
    "The token value does not change when you edit permissions, so .sandcastle/.env",
    "does not need updating. Then re-run: node .sandcastle/sync-issues.mjs",
  ].join("\n");
}

// 1. Ensure the label the planner filters on exists.
const labels = await api("/labels?per_page=100");
if (!labels.some((l) => l.name === LABEL)) {
  try {
    await api("/labels", {
      method: "POST",
      body: JSON.stringify({
        name: LABEL,
        color: "1D76DB",
        description: "Sandcastle 可并行实现的 issue",
      }),
    });
    console.log(`created label: ${LABEL}`);
  } catch (err) {
    if (err.status === 403) {
      console.error(permissionHelp(err));
      process.exit(1);
    }
    throw err;
  }
} else {
  console.log(`label exists: ${LABEL}`);
}

// 2. Existing issues, so re-runs don't duplicate.
const existing = await api("/issues?state=all&per_page=100");
const byTitle = new Map(existing.map((i) => [i.title, i]));

// 3. Parent PRD issue from spec.md (deliberately unlabeled so the planner
//    never treats the PRD itself as an implementation task).
const spec = fs.readFileSync(path.join(ROOT, ".scratch/smart-video-editor/spec.md"), "utf8").trim();
const PRD_TITLE = "PRD: 智能视频编辑器（T17 + T18 子集）";
let prd = byTitle.get(PRD_TITLE);
if (!prd) {
  try {
    prd = await api("/issues", {
      method: "POST",
      body: JSON.stringify({ title: PRD_TITLE, body: spec }),
    });
  } catch (err) {
    if (err.status === 403) {
      console.error(permissionHelp(err));
      process.exit(1);
    }
    throw err;
  }
  console.log(`created PRD #${prd.number}`);
} else {
  console.log(`reusing PRD #${prd.number}`);
}

// 4. Child issues, created in local order so "Blocked by: 01" can be rewritten
//    to the real GitHub issue number.
const dir = path.join(ROOT, ".scratch/smart-video-editor/issues");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
const localToGithub = {};
const children = [];

for (const file of files) {
  const raw = fs.readFileSync(path.join(dir, file), "utf8").replace(/^﻿/, "").trim();
  const [heading, ...rest] = raw.split(/\r?\n/);
  const m = /^#\s+(\d{2}):\s*(.+)$/.exec(heading.trim());
  if (!m) throw new Error(`unexpected heading in ${file}: ${heading}`);
  const localNo = m[1];
  const title = m[2].trim();

  let body = rest.join("\n").trim();
  body = body.replace(/\b0([1-9])\b/g, (whole, d) => {
    const num = localToGithub[`0${d}`];
    return num ? `#${num}` : whole;
  });
  body = `**Parent PRD:** #${prd.number}\n\n${body}`;

  let issue = byTitle.get(title);
  if (!issue) {
    try {
      issue = await api("/issues", {
        method: "POST",
        body: JSON.stringify({ title, body, labels: [LABEL] }),
      });
    } catch (err) {
      console.error(`\nFailed while creating "${title}". Created so far:`, localToGithub);
      if (err.status === 403) {
        console.error(permissionHelp(err));
        process.exit(1);
      }
      throw err;
    }
    console.log(`created #${issue.number}  ${title}`);
  } else {
    issue = await api(`/issues/${issue.number}`, {
      method: "PATCH",
      body: JSON.stringify({ body, labels: [LABEL] }),
    });
    console.log(`updated #${issue.number}  ${title}`);
  }

  localToGithub[localNo] = issue.number;
  children.push(issue);
}

// 5. Link the children from the PRD.
const childList = children.map((i) => `- #${i.number} ${i.title}`).join("\n");
const prdBody = `${spec}\n\n---\n\n## 子 issue（按依赖顺序）\n\n${childList}\n`;
prd = await api(`/issues/${prd.number}`, {
  method: "PATCH",
  body: JSON.stringify({ body: prdBody }),
});
console.log(`updated PRD #${prd.number} with ${children.length} child links`);

// 6. Verify what the planner will see.
const verify = await api(`/issues?state=open&labels=${LABEL}&per_page=100`);
console.log(`\nopen issues with label ${LABEL}: ${verify.length}`);
for (const i of verify.sort((a, b) => a.number - b.number)) {
  const blocked =
    (i.body || "").split(/\r?\n/).find((l) => l.includes("Blocked by")) || "(no Blocked by line)";
  console.log(`#${i.number} ${i.title}\n    ${blocked.trim()}`);
}
console.log("\nlocal -> github:", JSON.stringify(localToGithub));
