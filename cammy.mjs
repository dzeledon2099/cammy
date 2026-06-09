#!/usr/bin/env node
/**
 * Cammy — the open-source agentic loop harness for developers.
 * Goal in, working software out. No prompt engineering required.
 *
 * MIT License · Node 18+ · zero dependencies
 *
 *   cammy init                 scaffold config
 *   cammy run "<goal>"         run the agent loop on a goal
 *   cammy run --task fix-tests run a named task from cammy.json
 *   cammy resume <session-id>  continue an interrupted session
 *   cammy sessions             list past sessions
 *   cammy serve                start local API + dashboard event stream
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";

const VERSION = "0.1.0";
const CWD = process.cwd();
const CAMMY_DIR = path.join(CWD, ".cammy");
const SESS_DIR = path.join(CAMMY_DIR, "sessions");

/* ───────────────────────── config ───────────────────────── */

const DEFAULT_CONFIG = {
  provider: "anthropic",                  // anthropic | openai | ollama
  model: "claude-sonnet-4-20250514",
  baseUrl: null,                          // override for proxies / ollama
  maxIterations: 30,
  budgetUSD: 2.0,
  timeoutMinutes: 20,
  stuckThreshold: 3,
  approval: { shell: "ask", write_file: "auto" },
  pricing: { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  tasks: {
    "fix-tests":
      "Run the test suite, diagnose any failures, patch the code, and re-run until everything passes.",
  },
};

function loadConfig(overrides = {}) {
  const p = path.join(CWD, "cammy.json");
  const file = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  return { ...DEFAULT_CONFIG, ...file, ...overrides };
}

/* ──────────────── system prompt synthesis ────────────────
   The developer never writes this — Cammy does.            */

function buildSystemPrompt() {
  return [
    "You are Cammy, an autonomous coding agent operating inside a developer's repository.",
    `Working directory: ${CWD}`,
    "You operate in a loop: inspect, act with tools, observe results, repeat until the goal is met.",
    "Rules:",
    "- Take small, verifiable steps. Verify your work (run tests, re-read files) before declaring success.",
    "- Never invent file contents. Read a file before you modify it.",
    "- When the goal is fully achieved, call the `done` tool with a concise summary.",
    "- If you are truly blocked, call `done` with status=blocked and explain why.",
  ].join("\n");
}

/* ───────────────────────── tools ───────────────────────── */

const TOOL_DEFS = [
  { name: "read_file", description: "Read a UTF-8 text file (truncated at 50KB).",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Create or overwrite a file with the given content.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "list_dir", description: "List entries in a directory.",
    input_schema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "search", description: "Regex search across workspace files. Returns file:line matches.",
    input_schema: { type: "object", properties: { pattern: { type: "string" }, dir: { type: "string" } }, required: ["pattern"] } },
  { name: "shell", description: "Run a shell command in the workspace (60s timeout).",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "done", description: "Finish the session. status: success | blocked.",
    input_schema: { type: "object", properties: { summary: { type: "string" }, status: { type: "string" } }, required: ["summary"] } },
];

function safePath(p) {
  const abs = path.resolve(CWD, p ?? ".");
  if (abs !== CWD && !abs.startsWith(CWD + path.sep))
    throw new Error(`Path escapes workspace: ${p}`);
  return abs;
}

const SKIP = new Set(["node_modules", ".git", ".cammy", "dist", "build"]);

const RUNTIME = {
  read_file({ path: p }) {
    const s = fs.readFileSync(safePath(p), "utf8");
    return s.length > 50_000 ? s.slice(0, 50_000) + "\n…[truncated]" : s;
  },
  write_file({ path: p, content }) {
    const abs = safePath(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return `Wrote ${content.length} bytes to ${p}`;
  },
  list_dir({ path: p = "." }) {
    return fs.readdirSync(safePath(p), { withFileTypes: true })
      .map((d) => (d.isDirectory() ? d.name + "/" : d.name)).join("\n") || "(empty)";
  },
  search({ pattern, dir = "." }) {
    const re = new RegExp(pattern);
    const hits = [];
    (function walk(d) {
      if (hits.length >= 100) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (SKIP.has(e.name)) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && fs.statSync(full).size < 1_000_000) {
          let text; try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
          text.split("\n").forEach((line, i) => {
            if (hits.length < 100 && re.test(line))
              hits.push(`${path.relative(CWD, full)}:${i + 1}: ${line.trim().slice(0, 200)}`);
          });
        }
      }
    })(safePath(dir));
    return hits.join("\n") || "No matches.";
  },
  shell({ command }) {
    const r = spawnSync(command, { shell: true, cwd: CWD, timeout: 60_000, encoding: "utf8" });
    const out = [`exit code: ${r.status}`, r.stdout?.trim(), r.stderr?.trim()]
      .filter(Boolean).join("\n");
    return out.length > 20_000 ? out.slice(0, 20_000) + "\n…[truncated]" : out;
  },
};

function execTool(call) {
  try { return { output: String(RUNTIME[call.name](call.input ?? {})), isError: false }; }
  catch (err) { return { output: `Error: ${err.message}`, isError: true }; }
}

/* ─────────────── provider adapters ───────────────
   One neutral interface; Anthropic native + an
   OpenAI-compatible adapter that also covers Ollama. */

const anthropicAdapter = {
  userMessage: (text) => ({ role: "user", content: text }),
  async call(cfg, system, messages) {
    const res = await fetch((cfg.baseUrl ?? "https://api.anthropic.com") + "/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 8192, system, messages, tools: TOOL_DEFS }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return {
      text: data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
      toolCalls: data.content.filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input })),
      usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
      assistantMessage: { role: "assistant", content: data.content },
    };
  },
  toolResultMessages: (results) => [{
    role: "user",
    content: results.map((r) => ({
      type: "tool_result", tool_use_id: r.id, content: r.output, is_error: r.isError,
    })),
  }],
};

const openaiAdapter = {
  userMessage: (text) => ({ role: "user", content: text }),
  async call(cfg, system, messages) {
    const base = cfg.baseUrl ?? (cfg.provider === "ollama" ? "http://localhost:11434" : "https://api.openai.com");
    const key = process.env.OPENAI_API_KEY ?? "ollama";
    const res = await fetch(base + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "system", content: system }, ...messages],
        tools: TOOL_DEFS.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Provider ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const msg = data.choices[0].message;
    return {
      text: msg.content ?? "",
      toolCalls: (msg.tool_calls ?? []).map((tc) => ({
        id: tc.id, name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}"),
      })),
      usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
      assistantMessage: msg,
    };
  },
  toolResultMessages: (results) =>
    results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.output })),
};

/* ───────────────────── the loop harness ───────────────────── */

const estCost = (u, cfg) =>
  (u.input * cfg.pricing.inputPerMTok + u.output * cfg.pricing.outputPerMTok) / 1e6;

async function runLoop({ goal, cfg, emit, approve, resume }) {
  const adapter = cfg.provider === "anthropic" ? anthropicAdapter : openaiAdapter;
  const sessionId = resume?.sessionId ?? new Date().toISOString().replace(/[:.]/g, "-")
    + "-" + crypto.randomBytes(3).toString("hex");
  fs.mkdirSync(SESS_DIR, { recursive: true });
  const journal = fs.createWriteStream(path.join(SESS_DIR, sessionId + ".jsonl"), { flags: "a" });
  const log = (ev) => { const e = { ts: Date.now(), ...ev }; journal.write(JSON.stringify(e) + "\n"); emit(e); };

  const system = buildSystemPrompt();
  const messages = resume?.messages ?? [adapter.userMessage(`GOAL:\n${goal}`)];
  const usage = resume?.usage ?? { input: 0, output: 0 };
  let iter = resume?.iteration ?? 0;
  const seen = new Map();
  const deadline = Date.now() + cfg.timeoutMinutes * 60_000;

  log({ type: "session_start", sessionId, goal, provider: cfg.provider, model: cfg.model, resumed: !!resume });

  function end(status, summary = "") {
    log({ type: "session_end", status, summary, iterations: iter, usage, cost: estCost(usage, cfg) });
    journal.end();
    return { status, summary, sessionId, cost: estCost(usage, cfg) };
  }

  while (true) {
    iter++;
    if (iter > cfg.maxIterations) return end("max_iterations", "Iteration guard tripped.");
    if (Date.now() > deadline) return end("timeout", "Wall-clock guard tripped.");
    if (estCost(usage, cfg) > cfg.budgetUSD) return end("budget_exceeded", "Budget guard tripped.");

    log({ type: "iteration", n: iter, cost: estCost(usage, cfg) });

    let resp;
    try { resp = await adapter.call(cfg, system, messages); }
    catch (err) {
      log({ type: "warn", text: `Model call failed (${err.message}); retrying in 3s…` });
      await new Promise((r) => setTimeout(r, 3000));
      try { resp = await adapter.call(cfg, system, messages); }
      catch (err2) { return end("provider_error", err2.message); }
    }

    usage.input += resp.usage.input;
    usage.output += resp.usage.output;
    if (resp.text?.trim()) log({ type: "assistant", iteration: iter, text: resp.text.trim() });
    messages.push(resp.assistantMessage);

    const doneCall = resp.toolCalls.find((c) => c.name === "done");
    if (doneCall) return end(doneCall.input.status ?? "success", doneCall.input.summary);
    if (resp.toolCalls.length === 0) return end("success", resp.text.trim()); // text-only = final answer

    const results = [];
    for (const call of resp.toolCalls) {
      const key = call.name + ":" + JSON.stringify(call.input);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      log({ type: "tool_call", iteration: iter, name: call.name, input: call.input });

      let output, isError = false;
      if (n > cfg.stuckThreshold) return end("stuck", `Repeated identical action ${n} times.`);
      if (n === cfg.stuckThreshold) {
        output = `Loop guard: identical call repeated ${n} times. Change your strategy.`;
        isError = true;
      } else if ((cfg.approval[call.name] ?? "auto") === "ask") {
        const allowed = await approve(call);
        log({ type: "approval", name: call.name, allowed });
        if (allowed) ({ output, isError } = execTool(call));
        else { output = "Denied by operator."; isError = true; }
      } else {
        ({ output, isError } = execTool(call));
      }

      log({ type: "tool_result", iteration: iter, name: call.name, isError, output: output.slice(0, 2000) });
      results.push({ id: call.id, output, isError });
    }
    messages.push(...adapter.toolResultMessages(results));
    log({ type: "checkpoint", iteration: iter, messages, usage }); // resume point
  }
}

/* ───────────────────── terminal UX ───────────────────── */

const C = { dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", bold: "\x1b[1m", reset: "\x1b[0m" };

function ttyEmit(e) {
  const p = (c, s) => console.log(c + s + C.reset);
  if (e.type === "session_start") p(C.bold, `\n◉ cammy ${VERSION} · session ${e.sessionId}\n  goal: ${e.goal}\n`);
  if (e.type === "iteration") p(C.dim, `─── iteration ${e.n} · $${e.cost.toFixed(4)} ───`);
  if (e.type === "assistant") p(C.cyan, "  🧠 " + e.text.split("\n")[0].slice(0, 160));
  if (e.type === "tool_call") p(C.yellow, `  → ${e.name} ${JSON.stringify(e.input).slice(0, 140)}`);
  if (e.type === "tool_result") p(e.isError ? C.red : C.dim, `  ← ${e.output.split("\n")[0].slice(0, 160)}`);
  if (e.type === "warn") p(C.red, "  ⚠ " + e.text);
  if (e.type === "session_end")
    p(e.status === "success" ? C.green : C.red,
      `\n■ ${e.status} after ${e.iterations} iterations · $${e.cost.toFixed(4)}\n  ${e.summary ?? ""}\n`);
}

async function ttyApprove(call) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(
    `${C.yellow}  ⚠ approve ${call.name}: ${JSON.stringify(call.input).slice(0, 200)}? [y/N] ${C.reset}`
  )).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

/* ───────────────────── serve mode (UI backend) ─────────────────────
   SSE event stream + tiny JSON API the dashboard talks to.          */

function serve(cfg, port = 7433) {
  const clients = new Set();
  const pending = new Map();
  const broadcast = (e) => { const s = `data: ${JSON.stringify(e)}\n\n`; for (const c of clients) c.write(s); };

  http.createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return res.end();

    if (req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.url === "/run" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { goal } = JSON.parse(body || "{}");
        res.end(JSON.stringify({ ok: true }));
        runLoop({
          goal, cfg, emit: broadcast,
          approve: (call) => new Promise((resolve) => {
            const id = crypto.randomUUID();
            pending.set(id, resolve);
            broadcast({ type: "approval_request", id, name: call.name, input: call.input });
          }),
        }).catch((err) => broadcast({ type: "warn", text: err.message }));
      });
      return;
    }
    if (req.url === "/approve" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id, allow } = JSON.parse(body || "{}");
        pending.get(id)?.(!!allow);
        pending.delete(id);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.end("Cammy API is running. Point the dashboard at http://localhost:" + port);
  }).listen(port, () =>
    console.log(`${C.green}◉ cammy serve${C.reset} → http://localhost:${port}  (SSE: /events · POST /run · POST /approve)`));
}

/* ───────────────────────── CLI entry ───────────────────────── */

function parseFlags(args) {
  const flags = {}, rest = [];
  for (const a of args) {
    if (a === "--yes") flags.yes = true;
    else if (a.startsWith("--max=")) flags.maxIterations = +a.slice(6);
    else if (a.startsWith("--model=")) flags.model = a.slice(8);
    else if (a.startsWith("--provider=")) flags.provider = a.slice(11);
    else if (a.startsWith("--task=")) flags.task = a.slice(7);
    else rest.push(a);
  }
  return { flags, rest };
}

const [, , cmd, ...args] = process.argv;
const { flags, rest } = parseFlags(args);

if (cmd === "init") {
  fs.writeFileSync(path.join(CWD, "cammy.json"), JSON.stringify(DEFAULT_CONFIG, null, 2));
  fs.mkdirSync(SESS_DIR, { recursive: true });
  const gi = path.join(CWD, ".gitignore");
  if (!fs.existsSync(gi) || !fs.readFileSync(gi, "utf8").includes(".cammy"))
    fs.appendFileSync(gi, "\n.cammy/\n");
  console.log("✓ created cammy.json and .cammy/ — set ANTHROPIC_API_KEY (or OPENAI_API_KEY) and run:\n  cammy run \"your goal\"");
} else if (cmd === "run") {
  const cfg = loadConfig(flags);
  if (flags.yes) cfg.approval = {};
  const goal = flags.task ? cfg.tasks[flags.task] : rest.join(" ");
  if (!goal) { console.error("Usage: cammy run \"<goal>\"  |  cammy run --task=<name>"); process.exit(1); }
  const r = await runLoop({ goal, cfg, emit: ttyEmit, approve: flags.yes ? async () => true : ttyApprove });
  process.exit(r.status === "success" ? 0 : 1);
} else if (cmd === "resume") {
  const cfg = loadConfig(flags);
  const file = path.join(SESS_DIR, rest[0] + ".jsonl");
  if (!fs.existsSync(file)) { console.error("No such session."); process.exit(1); }
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const start = lines.find((l) => l.type === "session_start");
  const ck = [...lines].reverse().find((l) => l.type === "checkpoint");
  if (!ck) { console.error("No checkpoint to resume from."); process.exit(1); }
  await runLoop({
    goal: start.goal, cfg, emit: ttyEmit, approve: ttyApprove,
    resume: { sessionId: rest[0], messages: ck.messages, usage: ck.usage, iteration: ck.iteration },
  });
} else if (cmd === "sessions") {
  fs.mkdirSync(SESS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SESS_DIR)) console.log("  " + f.replace(".jsonl", ""));
} else if (cmd === "serve") {
  serve(loadConfig(flags));
} else {
  console.log(`cammy ${VERSION} — the agentic loop harness\n
  cammy init                  scaffold cammy.json
  cammy run "<goal>"          run the loop (flags: --yes --max=N --model= --provider= --task=)
  cammy resume <session-id>   continue from last checkpoint
  cammy sessions              list session journals
  cammy serve                 start the dashboard backend on :7433`);
}
