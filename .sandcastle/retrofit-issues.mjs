// One-off retrofit for the first GitHub-backed feature:
//   - ensure the triage + project labels exist
//   - label the PRD (#1) and its tickets (#2-#10)
//   - link tickets as sub-issues of the PRD
//   - add native GitHub blocking edges that mirror the "Blocked by" text
//
// Usage: node .sandcastle/retrofit-issues.mjs
// Idempotent: existing labels/sub-issues/edges are skipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "huangzj1996/cut-video";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = `https://api.github.com/repos/${REPO}`;
const PRD = 1;
const TICKETS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

// child -> blockers (mirrors the "Blocked by" lines in the issue bodies)
const BLOCKERS = {
  3: [2],
  4: [3],
  5: [4],
  6: [4],
  7: [6],
  8: [5, 6],
  9: [7, 8],
  10: [2, 3, 4, 5, 6, 7, 8, 9],
};

const LABELS = [
  { name: "needs-triage", color: "FBCA04", description: "Maintainer needs to evaluate this issue" },
  { name: "needs-info", color: "D876E3", description: "Waiting on reporter for more information" },
  { name: "ready-for-agent", color: "0E8A16", description: "Fully specified, ready for an AFK agent" },
  { name: "ready-for-human", color: "1D76DB", description: "Requires human implementation" },
  { name: "prd", color: "5319E7", description: "Spec/PRD parent issue (not executed directly)" },
];

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
  "user-agent": "sandcastle-retrofit",
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
    throw new Error(`${init.method ?? "GET"} ${pathname} -> ${res.status}: ${detail}`);
  }
  return json;
}

// 1. Labels.
const existingLabels = new Set((await api("/labels?per_page=100")).map((l) => l.name));
for (const label of LABELS) {
  if (existingLabels.has(label.name)) {
    console.log(`label exists: ${label.name}`);
    continue;
  }
  try {
    await api("/labels", { method: "POST", body: JSON.stringify(label) });
    console.log(`created label: ${label.name}`);
  } catch (err) {
    if (err.message.includes("already_exists")) {
      console.log(`label already exists: ${label.name}`);
    } else {
      throw err;
    }
  }
}

// 2. Issue labels. POST /labels appends, so this is safe to re-run.
await api(`/issues/${PRD}/labels`, {
  method: "POST",
  body: JSON.stringify({ labels: ["prd", "ready-for-agent"] }),
});
console.log(`#${PRD}: added prd, ready-for-agent`);
for (const n of TICKETS) {
  await api(`/issues/${n}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: ["Sandcastle", "ready-for-agent"] }),
  });
  console.log(`#${n}: added Sandcastle, ready-for-agent`);
}

// 3. Fetch database ids once.
const dbId = {};
for (const n of [PRD, ...TICKETS]) {
  dbId[n] = (await api(`/issues/${n}`)).id;
}

// 4. Sub-issues of the PRD.
const existingSubIssues = new Set(
  (await api(`/issues/${PRD}/sub_issues?per_page=100`)).map((i) => i.id),
);
for (const n of TICKETS) {
  if (existingSubIssues.has(dbId[n])) {
    console.log(`#${n}: already a sub-issue of #${PRD}`);
    continue;
  }
  await api(`/issues/${PRD}/sub_issues`, {
    method: "POST",
    body: JSON.stringify({ sub_issue_id: dbId[n] }),
  });
  console.log(`#${n}: linked as sub-issue of #${PRD}`);
}

// 5. Native blocking edges.
for (const [child, blockers] of Object.entries(BLOCKERS)) {
  const childNo = Number(child);
  const existing = new Set(
    (await api(`/issues/${childNo}/dependencies/blocked_by?per_page=100`)).map((i) => i.number),
  );
  for (const blocker of blockers) {
    if (existing.has(blocker)) {
      console.log(`#${childNo}: already blocked by #${blocker}`);
      continue;
    }
    await api(`/issues/${childNo}/dependencies/blocked_by`, {
      method: "POST",
      body: JSON.stringify({ issue_id: dbId[blocker] }),
    });
    console.log(`#${childNo}: blocked by #${blocker}`);
  }
}

// 6. Verify.
console.log("\nVerification:");
const prd = await api(`/issues/${PRD}`);
console.log(
  `#${PRD} labels:`,
  prd.labels.map((l) => l.name).join(", "),
  "| sub-issues:",
  (await api(`/issues/${PRD}/sub_issues?per_page=100`)).map((i) => i.number).join(", "),
);
for (const n of TICKETS) {
  const issue = await api(`/issues/${n}`);
  const blockers = await api(`/issues/${n}/dependencies/blocked_by?per_page=100`);
  console.log(
    `#${n} labels: ${issue.labels.map((l) => l.name).join(", ")} | blocked_by: ${
      blockers.map((i) => i.number).join(", ") || "none"
    }`,
  );
}
