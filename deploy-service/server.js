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

const STEP_ORDER = ["pulling", "installing", "building", "restarting", "verifying"];
const STEP_PROGRESS = { pulling: 10, installing: 25, building: 60, restarting: 85, verifying: 95 };

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

// ── HTTP Server (REST) ─────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === "start") {
        if (!isAuthorized(msg.ticket)) {
          ws.send(JSON.stringify({ type: "trigger_result", data: { ok: false, error: "Unauthorized" }, timestamp: Date.now() }));
          return;
        }
        const result = startDeploy();
        ws.send(JSON.stringify({ type: "trigger_result", data: result, timestamp: Date.now() }));
      } else if (msg.action === "reset") {
        if (!isAuthorized(msg.ticket)) {
          ws.send(JSON.stringify({ type: "trigger_result", data: { ok: false, error: "Unauthorized" }, timestamp: Date.now() }));
          return;
        }
        resetDeploy();
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
