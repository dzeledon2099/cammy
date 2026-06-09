import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw, Play, Pause, Square, Terminal, FileText, Pencil, Search,
  Folder, CheckCircle2, Brain, ShieldAlert, Coins, Timer, Cpu, AlertTriangle, Flag,
} from "lucide-react";

const SCRIPT = [
  { t: "iter", n: 1, delay: 600 },
  { t: "think", iter: 1, text: "Goal received: fix the failing test suite. I'll survey the repo, run the tests to see what's broken, then patch and verify.", tok: 420, delay: 1200 },
  { t: "tool", iter: 1, name: "list_dir", input: '{ "path": "." }', output: "src/\ntests/\npackage.json\nREADME.md", ms: 9, tok: 180, delay: 1000 },
  { t: "tool", iter: 1, name: "shell", input: '{ "command": "npm test" }', output: "exit code: 1\nFAIL tests/parser.test.js\n  ✕ tokenizes negative numbers — expected 3 tokens, got 2\n11 passed, 1 failed", ms: 4210, tok: 610, error: true, approval: true, delay: 800 },
  { t: "iter", n: 2, delay: 700 },
  { t: "think", iter: 2, text: "One failure in the tokenizer: negative numbers aren't handled. Reading the parser source to locate the number-matching logic.", tok: 380, delay: 1200 },
  { t: "tool", iter: 2, name: "read_file", input: '{ "path": "src/parser.js" }', output: "const NUM = /\\d+(\\.\\d+)?/;  // ← doesn't allow a leading minus\nfunction tokenize(input) { ... }", ms: 4, tok: 520, delay: 1100 },
  { t: "tool", iter: 2, name: "write_file", input: '{ "path": "src/parser.js", "content": "…" }', output: "Wrote 1,842 bytes to src/parser.js (NUM regex now /-?\\d+(\\.\\d+)?/ with unary-minus disambiguation)", ms: 6, tok: 740, delay: 1300 },
  { t: "iter", n: 3, delay: 700 },
  { t: "think", iter: 3, text: "Patch applied. Re-running the full suite to verify the fix and check for regressions.", tok: 290, delay: 1000 },
  { t: "tool", iter: 3, name: "shell", input: '{ "command": "npm test" }', output: "exit code: 0\nPASS tests/parser.test.js\n12 passed, 0 failed ✓", ms: 3890, tok: 480, approval: true, delay: 900 },
  { t: "done", iter: 3, text: "Fixed tokenizer in src/parser.js — the NUM regex now accepts a leading minus with unary-minus disambiguation. All 12 tests pass.", tok: 210, delay: 1100 },
];

const TOOL_ICONS = { shell: Terminal, read_file: FileText, write_file: Pencil, search: Search, list_dir: Folder };
const MAX_ITER = 30, BUDGET = 2.0, TIMEOUT_S = 1200;

export default function CammyDashboard() {
  const [goal, setGoal] = useState("Fix the failing test suite and make CI green");
  const [runState, setRunState] = useState("idle"); // idle|running|paused|done|stopped
  const [events, setEvents] = useState([]);
  const [idx, setIdx] = useState(0);
  const [pending, setPending] = useState(null);
  const [tokens, setTokens] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [iter, setIter] = useState(0);
  const idRef = useRef(0);
  const bottomRef = useRef(null);

  const cost = (tokens * 9) / 1e6; // blended demo pricing

  const applyStep = (step) => {
    setEvents((e) => [...e, { ...step, id: ++idRef.current }]);
    if (step.tok) setTokens((t) => t + step.tok);
    if (step.t === "iter") setIter(step.n);
    if (step.t === "done") setRunState("done");
    setIdx((i) => i + 1);
  };

  useEffect(() => {
    if (runState !== "running" || pending || idx >= SCRIPT.length) return;
    const step = SCRIPT[idx];
    const t = setTimeout(() => {
      if (step.approval) setPending(step);
      else applyStep(step);
    }, step.delay ?? 900);
    return () => clearTimeout(t);
  }, [idx, runState, pending]);

  useEffect(() => {
    if (runState !== "running") return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [runState]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, pending]);

  const start = () => {
    setEvents([]); setIdx(0); setTokens(0); setElapsed(0); setIter(0);
    setPending(null); idRef.current = 0; setRunState("running");
  };
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const statusStyles = {
    idle: "bg-zinc-700 text-zinc-300", running: "bg-emerald-900 text-emerald-300",
    paused: "bg-amber-900 text-amber-300", done: "bg-sky-900 text-sky-300", stopped: "bg-red-900 text-red-300",
  };

  const Meter = ({ icon: Icon, label, value, max, display, danger }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-zinc-400"><Icon size={12} />{label}</span>
        <span className={danger ? "text-red-400 font-medium" : "text-zinc-300"}>{display}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${danger ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      {/* header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <motion.div animate={runState === "running" ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
            <RefreshCw size={20} className="text-emerald-400" />
          </motion.div>
          <span className="text-lg font-bold tracking-tight">cammy</span>
          <span className="text-xs text-zinc-500">v0.1.0 · loop harness</span>
        </div>
        <span className={`ml-auto text-xs px-2 py-1 rounded-full ${statusStyles[runState]}`}>● {runState}</span>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* timeline column */}
        <section className="lg:col-span-2 space-y-3">
          <div className="flex gap-2">
            <input value={goal} onChange={(e) => setGoal(e.target.value)} disabled={runState === "running"}
              placeholder="Describe a goal — Cammy handles the rest"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
            {runState === "running" ? (
              <>
                <button onClick={() => setRunState("paused")} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm flex items-center gap-1"><Pause size={14} />Pause</button>
                <button onClick={() => setRunState("stopped")} className="px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-sm flex items-center gap-1"><Square size={14} />Stop</button>
              </>
            ) : runState === "paused" ? (
              <button onClick={() => setRunState("running")} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm flex items-center gap-1"><Play size={14} />Resume</button>
            ) : (
              <button onClick={start} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm flex items-center gap-1 font-semibold"><Play size={14} />Run</button>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 h-96 overflow-y-auto space-y-2">
            {events.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-sm gap-2">
                <RefreshCw size={32} />
                <p>No active session. Enter a goal and hit Run.</p>
                <p className="text-xs">demo mode — connects to `cammy serve` SSE in production</p>
              </div>
            )}
            <AnimatePresence>
              {events.map((ev) => {
                const Icon = TOOL_ICONS[ev.name] ?? Terminal;
                return (
                  <motion.div key={ev.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    {ev.t === "iter" && (
                      <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                        <div className="flex-1 border-t border-zinc-800" />iteration {ev.n}<div className="flex-1 border-t border-zinc-800" />
                      </div>
                    )}
                    {ev.t === "think" && (
                      <div className="flex gap-2 bg-zinc-800 rounded-lg p-3 text-sm">
                        <Brain size={16} className="text-cyan-400 shrink-0 mt-1" />
                        <p className="text-zinc-300">{ev.text}</p>
                      </div>
                    )}
                    {ev.t === "tool" && (
                      <div className={`rounded-lg border p-3 text-xs space-y-1 ${ev.error ? "border-red-900 bg-red-950" : "border-zinc-800 bg-zinc-950"}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Icon size={14} className={ev.error ? "text-red-400" : "text-amber-400"} />
                          <span className="font-semibold">{ev.name}</span>
                          <span className="text-zinc-500 truncate">{ev.input}</span>
                          <span className="ml-auto text-zinc-600">{ev.ms}ms</span>
                          {ev.denied && <span className="text-red-400 flex items-center gap-1"><ShieldAlert size={12} />denied</span>}
                        </div>
                        <pre className={`whitespace-pre-wrap rounded p-2 ${ev.error ? "text-red-300 bg-red-950" : "text-zinc-400 bg-zinc-900"}`}>{ev.output}</pre>
                      </div>
                    )}
                    {ev.t === "done" && (
                      <div className="flex gap-2 bg-emerald-950 border border-emerald-800 rounded-lg p-3 text-sm">
                        <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-1" />
                        <p className="text-emerald-200">{ev.text}</p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {runState === "running" && !pending && (
              <div className="flex items-center gap-2 text-zinc-500 text-xs p-2">
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}><RefreshCw size={12} /></motion.div>
                agent thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </section>

        {/* sidebar */}
        <aside className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2"><ShieldAlert size={14} />Guardrails</h3>
            <Meter icon={RefreshCw} label="iterations" value={iter} max={MAX_ITER} display={`${iter} / ${MAX_ITER}`} />
            <Meter icon={Coins} label="budget" value={cost} max={BUDGET} display={`$${cost.toFixed(4)} / $${BUDGET.toFixed(2)}`} danger={cost > BUDGET * 0.8} />
            <Meter icon={Timer} label="wall clock" value={elapsed} max={TIMEOUT_S} display={`${fmt(elapsed)} / 20:00`} />
            <Meter icon={Cpu} label="tokens" value={tokens} max={50000} display={tokens.toLocaleString()} />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs">
            <h3 className="font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Flag size={14} />Config</h3>
            <div className="flex justify-between"><span className="text-zinc-500">provider</span><span>anthropic</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">model</span><span className="truncate">claude-sonnet-4</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">shell approval</span><span className="text-amber-400">ask</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">stuck threshold</span><span>3</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">checkpointing</span><span className="text-emerald-400">on</span></div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-500 space-y-1">
            <p className="text-zinc-400 font-semibold">$ cammy serve</p>
            <p>In production this dashboard streams live events from the CLI over SSE at localhost:7433. Approval requests block the loop until you respond here or in the terminal.</p>
          </div>
        </aside>
      </main>

      {/* approval gate modal */}
      <AnimatePresence>
        {pending && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
              className="bg-zinc-900 border border-amber-700 rounded-xl p-5 max-w-md w-full space-y-4">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <AlertTriangle size={18} /> Approval required
              </div>
              <p className="text-sm text-zinc-300">The agent wants to run a gated tool:</p>
              <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-amber-300 whitespace-pre-wrap">{pending.name} {pending.input}</pre>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { applyStep({ ...pending, output: "Denied by operator.", error: true, denied: true }); setPending(null); }}
                  className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm">Deny</button>
                <button onClick={() => { applyStep(pending); setPending(null); }}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold">Approve & run</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
