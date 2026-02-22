const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const fs = require("fs");
const path = require("path");
const { execSync, exec } = require("child_process");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PROPEL_ROOT = "/propel-code";

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/files/list", (req, res) => {
  const dirPath = path.join(PROPEL_ROOT, req.query.path || "");
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "folder" : "file",
      path: path.join(req.query.path || "", e.name),
    }));
    res.json({ items });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get("/api/files/read", (req, res) => {
  const filePath = path.join(PROPEL_ROOT, req.query.path || "");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ content, path: req.query.path });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post("/api/files/write", (req, res) => {
  const filePath = path.join(PROPEL_ROOT, req.body.path);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body.content, "utf-8");
    res.json({ success: true, path: req.body.path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/files/mkdir", (req, res) => {
  const dirPath = path.join(PROPEL_ROOT, req.body.path);
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true, path: req.body.path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/files/delete", (req, res) => {
  const targetPath = path.join(PROPEL_ROOT, req.query.path || "");
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/files/rename", (req, res) => {
  const oldPath = path.join(PROPEL_ROOT, req.body.oldPath);
  const newPath = path.join(PROPEL_ROOT, req.body.newPath);
  try {
    fs.renameSync(oldPath, newPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/git/clone", (req, res) => {
  const { repoUrl, repoName, branch } = req.body;
  const targetDir = path.join(PROPEL_ROOT, repoName);
  try {
    if (fs.existsSync(targetDir)) {
      execSync(`cd ${targetDir} && git fetch origin && git checkout ${branch || "main"} && git pull`, {
        timeout: 60000,
      });
      res.json({ success: true, action: "updated", path: repoName });
    } else {
      const branchFlag = branch ? `-b ${branch}` : "";
      execSync(`git clone ${branchFlag} ${repoUrl} ${targetDir}`, {
        timeout: 120000,
      });
      res.json({ success: true, action: "cloned", path: repoName });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/exec", (req, res) => {
  const { command, cwd } = req.body;
  const workDir = cwd ? path.join(PROPEL_ROOT, cwd) : PROPEL_ROOT;
  exec(command, { cwd: workDir, timeout: 30000 }, (err, stdout, stderr) => {
    res.json({
      exitCode: err ? err.code || 1 : 0,
      stdout,
      stderr,
    });
  });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws/terminal" });

const terminals = new Map();

wss.on("connection", (ws) => {
  const shellPath = fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
  const term = pty.spawn(shellPath, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: PROPEL_ROOT,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });

  const termId = term.pid.toString();
  terminals.set(termId, term);

  ws.send(JSON.stringify({ type: "connected", termId }));

  term.onData((data) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  term.onExit(({ exitCode }) => {
    terminals.delete(termId);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "exit", exitCode }));
    }
  });

  ws.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      switch (parsed.type) {
        case "input":
          term.write(parsed.data);
          break;
        case "resize":
          term.resize(parsed.cols || 80, parsed.rows || 24);
          break;
      }
    } catch {
      term.write(msg.toString());
    }
  });

  ws.on("close", () => {
    term.kill();
    terminals.delete(termId);
  });
});

const PORT = process.env.PORT || 3100;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`PropelCode container agent running on port ${PORT}`);
});
