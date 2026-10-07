const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const PORT = parseInt(process.env.PORT || "8100", 10);
const PROJECT_DIR = process.env.PROJECT_DIR || "/project";
const FRONTEND_DIR = process.env.FRONTEND_DIR || "/project/frontend";
const STATE_DIR = process.env.DEPLOY_STATE_DIR || "/app/state";
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || "HS256";

// Validate a deploy ticket (issued by the backend /api/v1/deploy/authorize).
// The ticket is a short-lived JWT with type="deploy" and admin=true.
function isAuthorized(ticket) {
  if (!JWT_SECRET || !ticket) return false;
  try {
    const payload = jwt.verify(ticket, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
    return payload.type === "deploy" && payload.admin === true;
  } catch {
    return false;
  }
}

const STATUS_FILE = path.join(STATE_DIR, "status.json");
const COMMITS_FILE = path.join(STATE_DIR, "commits.json");
const LOCK_FILE = path.join(STATE_DIR, "deploy.lock");

// Prefer the repo-synced deploy script from the mounted project dir, else the
// snapshot copied into the image.
const SYNCED_DEPLOY_SCRIPT = path.join(PROJECT_DIR, "deploy-service", "deploy.sh");
const DEPLOY_SCRIPT = fs.existsSync(SYNCED_DEPLOY_SCRIPT) ? SYNCED_DEPLOY_SCRIPT : path.join(__dirname, "deploy.sh");

// Restore Point scripts. Same repo-first resolution: a rollback resets the repo
// to an older commit, so a script version only present in the image could vanish
// mid-run. The repo copy always survives a `git reset --hard`.
const SYNCED_SNAPSHOT_SCRIPT = path.join(PROJECT_DIR, "deploy-service", "snapshot.sh");
const SNAPSHOT_SCRIPT = fs.existsSync(SYNCED_SNAPSHOT_SCRIPT) ? SYNCED_SNAPSHOT_SCRIPT : path.join(__dirname, "snapshot.sh");
const SYNCED_ROLLBACK_SCRIPT = path.join(PROJECT_DIR, "deploy-service", "rollback.sh");
const ROLLBACK_SCRIPT = fs.existsSync(SYNCED_ROLLBACK_SCRIPT) ? SYNCED_ROLLBACK_SCRIPT : path.join(__dirname, "rollback.sh");

// Restore point artifacts. This path is a host bind mount that the backend
// container also sees (as /app/backups/restore_points), so both services read
// and write the same snapshots.
const SNAPSHOT_ROOT = path.join(PROJECT_DIR, "backend", "backups", "restore_points");
const RESTORE_POINT_KEEP = parseInt(process.env.RESTORE_POINT_KEEP || "10", 10);

const STEP_ORDER = ["restore_point", "pulling", "installing", "building", "restarting", "verifying"];
const STEP_PROGRESS = { restore_point: 5, pulling: 15, installing: 30, building: 60, restarting: 85, verifying: 95 };

let deployState = {
  state: "idle",
  currentStep: null,
  steps: [],
  exitCode: null,
  message: "",
  startTime: null,
  endTime: null,
  logLines: [],
};

let deployProcess = null;
let clients = new Set();

function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
}

function writeStatus(state, exitCode = null, message = "") {
  const data = { state, exit_code: exitCode, message, timestamp: new Date().toISOString() };
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data));
  } catch {}
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function getPendingCommits() {
  try {
    execSync("git fetch --quiet origin main 2>/dev/null || git fetch --quiet origin 2>/dev/null", { cwd: PROJECT_DIR, timeout: 15000 });
  } catch {}

  let localHead = "",
    remoteHead = "",
    count = 0,
    commits = [];

  try {
    localHead = execSync("git rev-parse HEAD", { cwd: PROJECT_DIR }).toString().trim();
  } catch {
    return { count: 0, commits: [], local_head: "", remote_head: "" };
  }

  // Prefer FETCH_HEAD if it exists, else origin/main
  try {
    execSync("test -f .git/FETCH_HEAD", { cwd: PROJECT_DIR });
    remoteHead = execSync("git rev-parse FETCH_HEAD", { cwd: PROJECT_DIR }).toString().trim();
  } catch {
    try {
      remoteHead = execSync("git rev-parse origin/main", { cwd: PROJECT_DIR }).toString().trim();
    } catch {
      remoteHead = "";
    }
  }

  if (localHead && remoteHead && localHead !== remoteHead) {
    try {
      count = parseInt(
        execSync(`git rev-list --count "${localHead}..${remoteHead}"`, { cwd: PROJECT_DIR }).toString().trim()
      );
    } catch {
      count = 0;
    }
  }

  if (count > 0) {
    try {
      const raw = execSync(
        `git log --no-merges --pretty=format:'{"hash":"%h","subject":"%s","date":"%cr"}' "${localHead}..${remoteHead}"`,
        { cwd: PROJECT_DIR }
      ).toString();
      commits = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {}
  }

  const result = { count, commits, local_head: localHead, remote_head: remoteHead };
  try {
    fs.writeFileSync(COMMITS_FILE, JSON.stringify(result));
  } catch {}
  return result;
}

function startDeploy() {
  if (deployState.state === "running") {
    return { ok: false, error: "Deploy already in progress" };
  }
  if (deployProcess) {
    return { ok: false, error: "Deploy process already running" };
  }
  if (opProcess) {
    return { ok: false, error: `A ${opState.op || "restore point"} operation is in progress. Wait for it to finish.` };
  }

  return spawnDeployProcess();
}

function spawnDeployProcess() {
  deployState = {
    state: "running",
    currentStep: null,
    steps: [],
    exitCode: null,
    message: "Deploy started",
    startTime: Date.now(),
    endTime: null,
    logLines: [],
  };

  writeStatus("running", null, "Deploy started");
  broadcast("status", { state: "running", currentStep: null });

  const proc = spawn("bash", [DEPLOY_SCRIPT], {
    cwd: PROJECT_DIR,
    env: { ...process.env, PROJECT_DIR, FRONTEND_DIR, DEPLOY_STATE_DIR: STATE_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });

  deployProcess = proc;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const stepMatch = trimmed.match(/^\[DEPLOY_STEP:(\w+)\]$/);
    if (stepMatch) {
      const step = stepMatch[1];
      deployState.currentStep = step;
      const stepEntry = { name: step, status: "running", startTime: Date.now() };
      deployState.steps.push(stepEntry);
      broadcast("step", { step, status: "running" });
      broadcast("progress", { percent: STEP_PROGRESS[step] || 0, step });
      return;
    }

    if (trimmed === "[DEPLOY_COMPLETE]") {
      finishDeploy(0);
      return;
    }

    const failMatch = trimmed.match(/^\[DEPLOY_FAILED:(.+)\]$/);
    if (failMatch) {
      finishDeploy(1, failMatch[1]);
      return;
    }

    deployState.logLines.push(trimmed);
    broadcast("log", { line: trimmed });
  };

  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      handleLine(line);
    }
  });

  proc.stderr.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      handleLine(line);
    }
  });

  proc.on("close", (code) => {
    deployProcess = null;
    if (deployState.state === "running") {
      finishDeploy(code ?? 1);
    }
  });

  proc.on("error", (err) => {
    deployProcess = null;
    finishDeploy(1, err.message);
  });

  return { ok: true };
}

function finishDeploy(exitCode, reason) {
  const success = exitCode === 0;
  const now = Date.now();
  deployState.endTime = now;
  deployState.exitCode = exitCode;
  deployState.state = success ? "completed" : "failed";
  deployState.message = success ? "Deploy successful" : reason || "Deploy failed";

  // Mark last step as done
  if (deployState.steps.length > 0) {
    const last = deployState.steps[deployState.steps.length - 1];
    last.status = success ? "completed" : "failed";
    last.endTime = now;
  }

  const duration = deployState.startTime ? Math.round((now - deployState.startTime) / 1000) : 0;
  writeStatus(deployState.state, exitCode, deployState.message);

  broadcast("status", {
    state: deployState.state,
    exitCode,
    message: deployState.message,
    duration,
  });

  broadcast(success ? "complete" : "failed", {
    exitCode,
    message: deployState.message,
    duration,
  });
}

function resetDeploy() {
  if (deployProcess) {
    try {
      deployProcess.kill("SIGTERM");
    } catch {}
    deployProcess = null;
  }

  deployState = {
    state: "idle",
    currentStep: null,
    steps: [],
    exitCode: null,
    message: "",
    startTime: null,
    endTime: null,
    logLines: [],
  };

  writeStatus("idle", null, "Manually reset");
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {}
  try {
    if (fs.existsSync(STATUS_FILE)) fs.unlinkSync(STATUS_FILE);
  } catch {}

  broadcast("status", { state: "idle", currentStep: null });
  return { ok: true };
}

// ── Restore Points ──────────────────────────────────────────────────────────

// A snapshot or rollback is a long-running operation like a deploy, so it
// reuses the same in-memory state shape, step markers and log streaming. Keeping
// one shape means the UI renders deploys and rollbacks with the same components.
const OP_STEP_PROGRESS = {
  capturing: 15,
  config: 35,
  database: 65,
  finalizing: 85,
  preparing: 10,
  code: 30,
  building: 70,
  restarting: 88,
  verifying: 95,
};

let opState = {
  op: null, // "snapshot" | "rollback"
  state: "idle",
  currentStep: null,
  steps: [],
  message: "",
  snapshotId: null,
  manifest: null,
  startTime: null,
  endTime: null,
  logLines: [],
};

let opProcess = null;

function opBroadcast(type, data) {
  broadcast(type, { op: opState.op, ...data });
}

function newOpState(op) {
  opState = {
    op,
    state: "running",
    currentStep: null,
    steps: [],
    message: `${op} started`,
    snapshotId: null,
    manifest: null,
    startTime: Date.now(),
    endTime: null,
    logLines: [],
  };
  opBroadcast("op_state", { state: "running", currentStep: null, steps: [] });
}

function finishOp(success, message, manifest = null) {
  opState.state = success ? "completed" : "failed";
  opState.message = message;
  opState.endTime = Date.now();
  opState.manifest = manifest;
  if (opState.steps.length > 0) {
    const last = opState.steps[opState.steps.length - 1];
    last.status = success ? "completed" : "failed";
    last.endTime = opState.endTime;
  }
  opProcess = null;
  opBroadcast(success ? "op_complete" : "op_failed", {
    ok: success,
    message,
    snapshotId: opState.snapshotId,
    manifest,
  });
  opBroadcast("op_state", {
    state: opState.state,
    currentStep: opState.currentStep,
    steps: opState.steps,
    message,
  });
}

/**
 * Run a Restore Point script, streaming its output to websocket clients.
 * `args` is passed verbatim; `onComplete` receives the parsed manifest (if any)
 * and the script's combined stdout.
 */
function runOpScript(script, args, op, onComplete) {
  if (opProcess) {
    return { ok: false, error: `Another ${opState.op || "operation"} is already running` };
  }

  newOpState(op);

  const proc = spawn("bash", [script, ...args], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      PROJECT_DIR,
      HOST_PROJECT_DIR: process.env.HOST_PROJECT_DIR || "/opt/Orange-Flow-Next-Js",
      DEPLOY_STATE_DIR: STATE_DIR,
      RESTORE_POINT_KEEP: String(RESTORE_POINT_KEEP),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  opProcess = proc;

  let buffer = "";
  // The snapshot script prints its manifest as the last thing before the
  // completion marker. It is pretty-printed across many lines, so it is
  // captured by brace depth rather than by matching a single line — matching
  // `line.startsWith("{")` would only ever keep the opening brace and
  // JSON.parse would fail on the truncated output.
  let manifestLines = null;
  let manifestDepth = 0;

  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line) return;

    const stepMatch = line.match(/^\[(?:DEPLOY|SNAPSHOT|ROLLBACK)_STEP:(\w+)\]$/);
    if (stepMatch) {
      const step = stepMatch[1];
      opState.currentStep = step;
      opState.steps.push({ name: step, status: "running", startTime: Date.now() });
      opBroadcast("op_step", { step, steps: opState.steps });
      opBroadcast("op_progress", { percent: OP_STEP_PROGRESS[step] || 0, step });
      return;
    }

    if (line === "[SNAPSHOT_COMPLETE]" || line === "[ROLLBACK_COMPLETE]" || line === "[DEPLOY_COMPLETE]") {
      finishOp(true, `${op} completed`, opState.manifest);
      return;
    }

    const failMatch = line.match(/^\[(?:SNAPSHOT|ROLLBACK)_FAILED:(.+)\]$/);
    if (failMatch) {
      finishOp(false, failMatch[1]);
      return;
    }

    // Start of a JSON object => the manifest block. Keep consuming lines until
    // the braces balance, then parse once.
    if (op === "snapshot" && (manifestLines !== null || line.startsWith("{"))) {
      if (manifestLines === null) {
        manifestLines = [];
        manifestDepth = 0;
      }
      manifestLines.push(line);
      for (const ch of line) {
        if (ch === "{") manifestDepth++;
        else if (ch === "}") manifestDepth--;
      }
      if (manifestDepth <= 0) {
        try {
          opState.manifest = JSON.parse(manifestLines.join("\n"));
        } catch (e) {
          opState.logLines.push(`manifest parse failed: ${e.message}`);
        }
        manifestLines = null;
        manifestDepth = 0;
      }
      return;
    }

    opState.logLines.push(line);
    opBroadcast("op_log", { line });
  };

  const pump = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  };

  proc.stdout.on("data", pump);
  proc.stderr.on("data", pump);

  proc.on("close", (code) => {
    if (buffer) {
      handleLine(buffer);
      buffer = "";
    }
    if (opState.state === "running") {
      const manifest = opState.manifest;
      if (code === 0) {
        finishOp(true, `${op} completed`, manifest);
      } else {
        finishOp(false, `${op} failed (exit ${code})`);
      }
    }
    if (onComplete) onComplete(code === 0, opState.manifest, opState.message);
  });

  proc.on("error", (err) => {
    finishOp(false, err.message);
    if (onComplete) onComplete(false, null, err.message);
  });

  return { ok: true };
}

function createSnapshot(label = "", triggerSource = "manual", onComplete = null) {
  return runOpScript(SNAPSHOT_SCRIPT, [label, triggerSource], "snapshot", onComplete);
}

function startRollback(snapshotId, flags = {}) {
  const args = [snapshotId];
  if (flags.noCode) args.push("--no-code");
  if (flags.noDatabase) args.push("--no-database");
  if (flags.noConfig) args.push("--no-config");
  // runOpScript resets the state, so the id is attached after it returns.
  const result = runOpScript(ROLLBACK_SCRIPT, args, "rollback");
  opState.snapshotId = snapshotId;
  return result;
}

/** Scan the snapshot root and return every manifest found on disk. */
function listSnapshots() {
  const items = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(SNAPSHOT_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { count: 0, snapshots: [], keep: RESTORE_POINT_KEEP, root: SNAPSHOT_ROOT, deployed_sha: currentHeadSha() };
  }

  for (const d of dirs) {
    const manifestPath = path.join(SNAPSHOT_ROOT, d.name, "manifest.json");
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      // A directory without a readable manifest is a half-written or hand-made
      // snapshot. Report it so it is visible rather than silently ignored.
      items.push({ snapshot_id: d.name, status: "incomplete", total_size: 0 });
      continue;
    }
    manifest.snapshot_id = manifest.snapshot_id || d.name;
    manifest.artifact_dir = path.join(SNAPSHOT_ROOT, d.name);
    try {
      manifest.has_restore_result = fs.existsSync(path.join(SNAPSHOT_ROOT, d.name, "restore-result.json"));
    } catch {
      manifest.has_restore_result = false;
    }
    items.push(manifest);
  }

  // Newest first. snapshot_id starts with a YYYYmmdd_HHMMSS timestamp, so a
  // plain string sort is chronological without touching the filesystem.
  items.sort((a, b) => String(b.snapshot_id).localeCompare(String(a.snapshot_id)));

  // The commit the working tree is actually on right now. Only the deploy
  // container has the repo mounted, so this has to be read here — the backend
  // can only guess from the newest manifest, which is wrong after a deploy that
  // skipped capture or after a rollback.
  return { count: items.length, snapshots: items, keep: RESTORE_POINT_KEEP, root: SNAPSHOT_ROOT, deployed_sha: currentHeadSha() };
}

// Full SHA the project is currently checked out at, or "" if git is unavailable.
function currentHeadSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: PROJECT_DIR }).toString().trim();
  } catch {
    return "";
  }
}

function getSnapshot(snapshotId) {
  if (!snapshotId || /[/\\.]/.test(snapshotId)) return null;
  const manifestPath = path.join(SNAPSHOT_ROOT, snapshotId, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

// ── HTTP Server (REST) ─────────────────────────────────────────────────────

// ── Maintenance fallback page ────────────────────────────────────────────────
// Served at :8100/maintenance so users can still see the maintenance notice
// and live countdown even while the Next.js frontend is restarting (the
// backend keeps running in its own container during a deploy). The page is
// fully self-contained: system fonts, inline SVG, no external requests except
// the same-origin status proxy below.

const MAINTENANCE_BACKEND_URL =
  process.env.MAINTENANCE_BACKEND_URL ||
  "http://backend:8000/api/settings/maintenance";

const MAINTENANCE_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maintenance | OrangeFlow</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 1rem; background: #020617; color: #e2e8f0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .card {
    width: 100%; max-width: 26rem; background: #0f172a; border: 1px solid #1e293b;
    border-radius: 1.5rem; padding: 2.5rem 1.75rem; text-align: center;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,.5);
  }
  .icon {
    width: 4rem; height: 4rem; margin: 0 auto 1.25rem; border-radius: 1rem;
    background: rgba(245,158,11,.12); display: flex; align-items: center; justify-content: center;
  }
  .icon svg { width: 2rem; height: 2rem; stroke: #f59e0b; }
  .brand { font-size: .7rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: #f59e0b; }
  h1 { font-size: 1.35rem; font-weight: 700; margin-top: .5rem; color: #f8fafc; }
  .msg { font-size: .875rem; line-height: 1.6; color: #94a3b8; margin-top: .9rem; }
  .cd {
    margin: 1.5rem auto 0; display: inline-flex; flex-direction: column; gap: .25rem;
    background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.25);
    border-radius: 1rem; padding: .9rem 1.6rem;
  }
  .cd-label { font-size: .65rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #fbbf24; }
  .cd-time { font-size: 1.9rem; font-weight: 700; font-variant-numeric: tabular-nums; color: #f8fafc; }
  .cd[hidden] { display: none; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
    margin-top: 1.6rem; padding: .65rem 1.5rem; border-radius: .75rem; background: #f59e0b;
    color: #020617; font-size: .875rem; font-weight: 600; text-decoration: none; cursor: pointer;
    border: none; transition: background .15s;
  }
  .btn:hover { background: #fbbf24; }
  .btn[hidden] { display: none; }
  .hint { font-size: .7rem; color: #64748b; margin-top: 1.1rem; }
  .lang { margin-top: 1.25rem; display: inline-flex; gap: .4rem; }
  .lang button {
    font-size: .7rem; font-weight: 700; padding: .3rem .7rem; border-radius: .5rem; cursor: pointer;
    background: transparent; color: #64748b; border: 1px solid #1e293b; transition: all .15s;
  }
  .lang button.on { background: #1e293b; color: #f8fafc; border-color: #334155; }
  .online .icon { background: rgba(16,185,129,.12); }
  .online .icon svg { stroke: #10b981; }
  .online .brand { color: #10b981; }
</style>
</head>
<body>
<main class="card" id="card">
  <div class="icon" id="icon"></div>
  <p class="brand" id="brand">OrangeFlow</p>
  <h1 id="title"></h1>
  <p class="msg" id="msg"></p>
  <div class="cd" id="cd" hidden>
    <span class="cd-label" id="cdLabel"></span>
    <span class="cd-time" id="cdTime">00:00</span>
  </div>
  <a class="btn" id="back" href="#" hidden></a>
  <p class="hint" id="hint"></p>
  <div class="lang">
    <button id="btnEn" type="button">EN</button>
    <button id="btnBn" type="button">&#2476;&#2494;&#2434;</button>
  </div>
</main>
<script>
(function () {
  var T = {
    en: {
      title: "Under Maintenance",
      graceTitle: "Maintenance starting soon",
      msg: "Maintenance Mode is about to start. Please complete all your work within the next 10 minutes. The system may be temporarily unavailable once Maintenance Mode begins.",
      cd: "Maintenance starts in",
      back: "Back to the app",
      hint: "This page refreshes automatically.",
      onlineTitle: "Back online",
      onlineMsg: "The system is available again. You can return to the app.",
      connecting: "Connecting..."
    },
    bn: {
      title: "\\u09B0\\u0995\\u09CD\\u09B7\\u09A3\\u09BE\\u09AC\\u09C7\\u0995\\u09CD\\u09B7\\u09A3 \\u099A\\u09B2\\u099B\\u09C7",
      graceTitle: "\\u09B0\\u0995\\u09CD\\u09B7\\u09A3\\u09BE\\u09AC\\u09C7\\u0995\\u09CD\\u09B7\\u09A3 \\u09B6\\u09C1\\u09B0\\u09C1 \\u09B9\\u09A4\\u09C7 \\u09AF\\u09BE\\u099A\\u09CD\\u099B\\u09C7",
      msg: "Maintenance Mode chalu hote jacche. Doya kore agami 10 minuter moddhe apnader shokol kaj shesh kore nin. Maintenance Mode chalu howar por system temporary vabe unavailable thakte pare.",
      cd: "\\u09B0\\u0995\\u09CD\\u09B7\\u09A3\\u09BE\\u09AC\\u09C7\\u0995\\u09CD\\u09B7\\u09A3 \\u09B6\\u09C1\\u09B0\\u09C1 \\u09B9\\u09AC\\u09C7",
      back: "\\u0985\\u09CD\\u09DF\\u09BE\\u09AA\\u09C7 \\u09AB\\u09BF\\u09B0\\u09C7 \\u09AF\\u09BE\\u09A8",
      hint: "\\u098F\\u0987 \\u09AA\\u09C7\\u099C \\u09A8\\u09BF\\u099C\\u09C7 \\u09A5\\u09C7\\u0995\\u09C7 \\u0986\\u09AA\\u09A1\\u09C7\\u099F \\u09B9\\u09AC\\u09C7\\u0964",
      onlineTitle: "\\u09B8\\u09BF\\u09B8\\u09CD\\u099F\\u09C7\\u09AE \\u099A\\u09BE\\u09B2\\u09C1 \\u0986\\u09AC\\u09BE\\u09B0",
      onlineMsg: "\\u09B8\\u09BF\\u09B8\\u09CD\\u099F\\u09C7\\u09AE \\u0986\\u09AC\\u09BE\\u09B0 \\u09AC\\u09CD\\u09AF\\u09AC\\u09B9\\u09BE\\u09B0\\u09AF\\u09CB\\u0997\\u09CD\\u09AF \\u09B9\\u09AF\\u09BC\\u09C7\\u099B\\u09C7\\u0964 \\u0986\\u09AA\\u09A8\\u09BF \\u0985\\u09CD\\u09DF\\u09BE\\u09AA\\u09C7 \\u09AB\\u09BF\\u09B0\\u09C7 \\u09AF\\u09C7\\u09A4\\u09C7 \\u09AA\\u09BE\\u09B0\\u09C7\\u09A8\\u0964",
      connecting: "\\u09B8\\u0982\\u09AF\\u09CB\\u0997 \\u09B9\\u099A\\u09CD\\u099B\\u09C7..."
    }
  };

  function cookieLang() {
    var m = document.cookie.match(/(?:^|;\\s*)lang=(bn|en)/);
    if (m) return m[1];
    return (navigator.language || "").toLowerCase().indexOf("bn") === 0 ? "bn" : "en";
  }

  var lang = cookieLang();
  var last = null;        // last good status payload
  var everFetched = false;
  var graceEnd = null;    // local-clock deadline while in grace
  var enforcedLocal = false; // local flip at 00:00

  function $(id) { return document.getElementById(id); }

  function fmt(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return h > 0 ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
  }

  function currentPhase() {
    if (!last) return everFetched ? "unknown" : "connecting";
    if (last.phase === "grace" && graceEnd !== null) {
      if (Date.now() >= graceEnd) return "enforced";
      return "grace";
    }
    return last.phase || "unknown";
  }

  function render() {
    var tt = T[lang];
    var phase = currentPhase();
    document.documentElement.lang = lang;
    var online = phase === "off";
    $("card").className = "card" + (online ? " online" : "");
    $("icon").innerHTML = online
      ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

    if (phase === "connecting") {
      $("title").textContent = tt.connecting;
      $("msg").textContent = "";
      $("cd").hidden = true;
      $("back").hidden = true;
      $("hint").textContent = tt.hint;
      return;
    }

    if (online) {
      $("title").textContent = tt.onlineTitle;
      $("msg").textContent = tt.onlineMsg;
      $("cd").hidden = true;
      var back = $("back");
      back.hidden = false;
      back.textContent = tt.back;
      back.href = "http://" + location.hostname + ":3000/";
      $("hint").textContent = tt.hint;
      document.title = tt.onlineTitle + " | OrangeFlow";
      return;
    }

    var grace = phase === "grace";
    $("title").textContent = grace ? tt.graceTitle : tt.title;
    var custom = last && typeof last.message === "string" && last.message.trim();
    $("msg").textContent = custom ? last.message : tt.msg;
    $("back").hidden = true;
    $("hint").textContent = tt.hint;
    $("cd").hidden = !grace;
    if (grace) {
      $("cdLabel").textContent = tt.cd;
      $("cdTime").textContent = fmt(graceEnd - Date.now());
    }
    document.title = (grace ? tt.graceTitle : tt.title) + " | OrangeFlow";
  }

  function applyStatus(data) {
    if (!data || typeof data !== "object" || typeof data.phase !== "string") return;
    last = data;
    everFetched = true;
    if (data.phase === "grace" && data.grace_until && data.server_now) {
      var remaining = Date.parse(data.grace_until) - Date.parse(data.server_now);
      graceEnd = isFinite(remaining) ? Date.now() + remaining : null;
    } else {
      graceEnd = null;
    }
    render();
  }

  function poll() {
    var done = false;
    var timer = setTimeout(function () {
      if (!done && !everFetched) render();
    }, 2500);
    fetch("/api/maintenance-status", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        done = true;
        clearTimeout(timer);
        applyStatus(data);
      })
      .catch(function () {
        done = true;
        clearTimeout(timer);
        // Backend restarting: keep showing the last known state instead of
        // falsely claiming the system is back online.
        render();
      });
  }

  $("btnEn").onclick = function () { lang = "en"; render(); };
  $("btnBn").onclick = function () { lang = "bn"; render(); };

  function syncLangButtons() {
    $("btnEn").className = lang === "en" ? "on" : "";
    $("btnBn").className = lang === "bn" ? "on" : "";
  }
  var _render = render;
  render = function () { _render(); syncLangButtons(); };

  setInterval(poll, 3000);
  setInterval(function () { if (currentPhase() === "grace") render(); }, 500);
  poll();
})();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Deploy-Ticket");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, state: deployState.state }));
    return;
  }

  // Status
  if (url.pathname === "/api/status" && req.method === "GET") {
    const status = readJson(STATUS_FILE);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        state: deployState.state || status.state || "idle",
        currentStep: deployState.currentStep,
        steps: deployState.steps,
        exitCode: deployState.exitCode ?? status.exit_code ?? null,
        message: deployState.message || status.message || "",
        startTime: deployState.startTime,
        endTime: deployState.endTime,
        logCount: deployState.logLines.length,
      })
    );
    return;
  }

  // Trigger (admin ticket required)
  if (url.pathname === "/api/trigger" && req.method === "POST") {
    const ticket = req.headers["x-deploy-ticket"] || url.searchParams.get("ticket");
    if (!isAuthorized(ticket)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    const result = startDeploy();
    res.writeHead(result.ok ? 200 : 409, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // Reset (admin ticket required)
  if (url.pathname === "/api/reset" && req.method === "POST") {
    const ticket = req.headers["x-deploy-ticket"] || url.searchParams.get("ticket");
    if (!isAuthorized(ticket)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    const result = resetDeploy();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // Pending commits
  if (url.pathname === "/api/pending-commits" && req.method === "GET") {
    const commits = getPendingCommits();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(commits));
    return;
  }

  // ── Restore Points ────────────────────────────────────────────────────────
  // Read-only endpoints are open to the deploy UI (same posture as
  // /api/pending-commits and /api/status, which the page already fetches
  // unauthenticated). Anything that writes or destroys requires an admin
  // deploy ticket.

  // List every snapshot found on disk. Read straight from the manifest files so
  // the list still works after a rollback has rewound the restore_points table.
  if (url.pathname === "/api/restore-point/list" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listSnapshots()));
    return;
  }

  if (url.pathname === "/api/restore-point/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        op: opState.op,
        state: opState.state,
        currentStep: opState.currentStep,
        steps: opState.steps,
        message: opState.message,
        snapshotId: opState.snapshotId,
        manifest: opState.manifest,
        startTime: opState.startTime,
        endTime: opState.endTime,
        logCount: opState.logLines.length,
      })
    );
    return;
  }

  // Capture a new restore point (the "Create" button in the UI).
  if (url.pathname === "/api/restore-point/capture" && req.method === "POST") {
    const ticket = req.headers["x-deploy-ticket"] || url.searchParams.get("ticket");
    if (!isAuthorized(ticket)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    if (opProcess || deployProcess) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "A deploy or restore point operation is already running" }));
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 16_384) req.destroy();
    });
    req.on("end", () => {
      let label = "";
      let trigger = "manual";
      try {
        const parsed = JSON.parse(body || "{}");
        label = String(parsed.label || "").slice(0, 200);
        trigger = parsed.trigger_source === "auto_deploy" ? "auto_deploy" : "manual";
      } catch {}
      const result = createSnapshot(label, trigger);
      res.writeHead(result.ok ? 202 : 409, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // Roll the whole system back to a snapshot.
  if (url.pathname === "/api/restore-point/rollback" && req.method === "POST") {
    const ticket = req.headers["x-deploy-ticket"] || url.searchParams.get("ticket");
    if (!isAuthorized(ticket)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    if (opProcess || deployProcess) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "A deploy or restore point operation is already running" }));
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 16_384) req.destroy();
    });
    req.on("end", () => {
      let snapshotId = "";
      let flags = {};
      try {
        const parsed = JSON.parse(body || "{}");
        snapshotId = String(parsed.snapshot_id || "");
        flags = {
          noCode: parsed.include_code === false,
          noDatabase: parsed.include_database === false,
          noConfig: parsed.include_config === false,
        };
      } catch {}

      // Reject before spawning: a missing snapshot would otherwise fail deep
      // inside the script with a less useful message.
      if (!snapshotId || !getSnapshot(snapshotId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Restore point not found", snapshot_id: snapshotId }));
        return;
      }
      const result = startRollback(snapshotId, flags);
      res.writeHead(result.ok ? 202 : 409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...result, snapshot_id: snapshotId }));
    });
    return;
  }

  // Stop a running snapshot/rollback (e.g. the user changed their mind).
  if (url.pathname === "/api/restore-point/cancel" && req.method === "POST") {
    const ticket = req.headers["x-deploy-ticket"] || url.searchParams.get("ticket");
    if (!isAuthorized(ticket)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    if (!opProcess) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, cancelled: false }));
      return;
    }
    try {
      opProcess.kill("SIGTERM");
    } catch {}
    finishOp(false, "Cancelled by administrator");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, cancelled: true }));
    return;
  }

  // Maintenance fallback page — always reachable, even mid-deploy.
  if (url.pathname === "/maintenance" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(MAINTENANCE_PAGE_HTML);
    return;
  }

  // Same-origin status proxy for the fallback page (avoids CORS and keeps the
  // backend URL server-side). 2s timeout so the page shows its own fallback
  // quickly while the backend restarts.
  if (url.pathname === "/api/maintenance-status" && req.method === "GET") {
    const proxyReq = http.get(MAINTENANCE_BACKEND_URL, { timeout: 2000 }, (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (c) => chunks.push(c));
      proxyRes.on("end", () => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(Buffer.concat(chunks));
      });
    });
    proxyReq.on("timeout", () => proxyReq.destroy(new Error("timeout")));
    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "BACKEND_UNAVAILABLE" } }));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);

  // Send current state on connect
  ws.send(
    JSON.stringify({
      type: "status",
      data: {
        state: deployState.state,
        currentStep: deployState.currentStep,
        steps: deployState.steps,
        exitCode: deployState.exitCode,
        message: deployState.message,
        startTime: deployState.startTime,
        endTime: deployState.endTime,
      },
      timestamp: Date.now(),
    })
  );

  // Send recent logs
  if (deployState.logLines.length > 0) {
    const recentLogs = deployState.logLines.slice(-200);
    ws.send(
      JSON.stringify({
        type: "log_batch",
        data: { lines: recentLogs },
        timestamp: Date.now(),
      })
    );
  }

  // Send current restore point operation state on connect
  if (opState.op) {
    ws.send(
      JSON.stringify({
        type: "op_state",
        data: {
          op: opState.op,
          state: opState.state,
          currentStep: opState.currentStep,
          steps: opState.steps,
          message: opState.message,
          snapshotId: opState.snapshotId,
          manifest: opState.manifest,
          startTime: opState.startTime,
          endTime: opState.endTime,
        },
        timestamp: Date.now(),
      })
    );

    if (opState.logLines.length > 0) {
      ws.send(
        JSON.stringify({
          type: "op_log_batch",
          data: { op: opState.op, lines: opState.logLines.slice(-200) },
          timestamp: Date.now(),
        })
      );
    }
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const ticket = msg.ticket;
      const authorized = isAuthorized(ticket);

      if (msg.action === "start") {
        if (!authorized) {
          ws.send(JSON.stringify({ type: "trigger_result", data: { ok: false, error: "Unauthorized" }, timestamp: Date.now() }));
          return;
        }
        const result = startDeploy();
        ws.send(JSON.stringify({ type: "trigger_result", data: result, timestamp: Date.now() }));
      } else if (msg.action === "reset") {
        if (!authorized) {
          ws.send(JSON.stringify({ type: "trigger_result", data: { ok: false, error: "Unauthorized" }, timestamp: Date.now() }));
          return;
        }
        resetDeploy();
      } else if (msg.action === "snapshot" || msg.action === "rollback" || msg.action === "cancel_op") {
        if (!authorized) {
          ws.send(JSON.stringify({ type: "op_result", data: { ok: false, error: "Unauthorized" }, timestamp: Date.now() }));
          return;
        }
        if (opProcess || deployProcess) {
          ws.send(
            JSON.stringify({
              type: "op_result",
              data: { ok: false, error: "A deploy or restore point operation is already running" },
              timestamp: Date.now(),
            })
          );
          return;
        }
        let result;
        if (msg.action === "snapshot") {
          result = createSnapshot(String(msg.label || "").slice(0, 200), "manual");
        } else if (msg.action === "rollback") {
          const snapshotId = String(msg.snapshot_id || "");
          if (!snapshotId || !getSnapshot(snapshotId)) {
            ws.send(
              JSON.stringify({
                type: "op_result",
                data: { ok: false, error: "Restore point not found", snapshot_id: snapshotId },
                timestamp: Date.now(),
              })
            );
            return;
          }
          result = startRollback(snapshotId, {
            noCode: msg.include_code === false,
            noDatabase: msg.include_database === false,
            noConfig: msg.include_config === false,
          });
        } else {
          try {
            opProcess.kill("SIGTERM");
          } catch {}
          finishOp(false, "Cancelled by administrator");
          result = { ok: true, cancelled: true };
        }
        ws.send(JSON.stringify({ type: "op_result", data: result, timestamp: Date.now() }));
      }
    } catch {}
  });

  ws.on("close", () => {
    clients.delete(ws);
  });

  ws.on("error", () => {
    clients.delete(ws);
  });
});

// ── Start ───────────────────────────────────────────────────────────────────

try {
  fs.mkdirSync(STATE_DIR, { recursive: true });
} catch {}

// Initial commit fetch
try {
  getPendingCommits();
} catch {}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Deploy service listening on port ${PORT}`);
  console.log(`  WebSocket: ws://0.0.0.0:${PORT}`);
  console.log(`  REST API:  http://0.0.0.0:${PORT}/api/status`);
  console.log(`  Project:   ${PROJECT_DIR}`);
});
