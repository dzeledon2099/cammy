# Cammy Documentation

Complete reference for Cammy v0.1.1 — the open-source agentic loop harness.
Goal in, working code out. Single file, zero dependencies, Node 18+.

---

## Table of contents

1. [Quickstart](#quickstart)
2. [CLI reference](#cli-reference)
3. [Configuration (cammy.json)](#configuration-cammyjson)
4. [Providers](#providers)
5. [Tool reference](#tool-reference)
6. [Guardrails & session end states](#guardrails--session-end-states)
7. [Approval gates](#approval-gates)
8. [Sessions, checkpoints & resume](#sessions-checkpoints--resume)
9. [Journal format (JSONL events)](#journal-format-jsonl-events)
10. [Serve mode API](#serve-mode-api)
11. [Security model](#security-model)
12. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Quickstart

From zero to a successful run in under 5 minutes. You need Node 18 or newer
(`node --version` to check) and an API key from one provider.

```bash
# 1. Get cammy.mjs into your project (clone or copy the single file)
curl -O https://raw.githubusercontent.com/dzeledon2099/cammy/main/cammy.mjs

# 2. Set a key for your provider (pick ONE)
export ANTHROPIC_API_KEY=sk-ant-...     # Anthropic (default provider)
export OPENAI_API_KEY=sk-...            # OpenAI
export GEMINI_API_KEY=...               # Google (Gemma 4 / Gemini)
# (Ollama needs no key — just have Ollama running locally)

# 3. Scaffold config and run
node cammy.mjs init
node cammy.mjs run "create a hello.js that prints the current date"
```

If the last command prints a green `■ success` block, you're done. If not, see
[Troubleshooting](#troubleshooting--faq).

---

## CLI reference

### `cammy init`

Scaffolds `cammy.json` with defaults and creates the `.cammy/` session
directory. Also appends `.cammy/` to your `.gitignore` if missing. Safe to run
in any project; it will overwrite an existing `cammy.json`.

```bash
node cammy.mjs init
```

### `cammy run "<goal>"`

Runs the agent loop on a goal stated in plain language. Cammy synthesizes the
system prompt — you never write one.

```bash
node cammy.mjs run "fix the failing tests and make CI green"
```

Flags (combinable):

| Flag | Effect | Example |
|---|---|---|
| `--yes` | Skip all approval prompts (auto-approve everything, including shell) | `node cammy.mjs run --yes "run the linter and fix issues"` |
| `--max=N` | Override max iterations for this run | `node cammy.mjs run --max=10 "small fix"` |
| `--model=` | Override the model for this run | `node cammy.mjs run --model=claude-sonnet-4-20250514 "..."` |
| `--provider=` | Override the provider for this run | `node cammy.mjs run --provider=ollama --model=gemma3 "..."` |
| `--task=` | Run a named task from cammy.json instead of an inline goal | `node cammy.mjs run --task=fix-tests` |

Exit code is `0` when the session ends with status `success`, `1` otherwise —
so you can use Cammy in scripts and CI.

### `cammy resume <session-id>`

Continues an interrupted session from its last checkpoint. Get the ID from
`cammy sessions` or from the `◉ cammy` banner of the original run.

```bash
node cammy.mjs resume 2026-06-09T14-22-31-008Z-a1b2c3
```

What survives an interrupt: the full conversation history, token usage so far,
and the iteration count — all restored from the last checkpoint. What doesn't:
the wall-clock timer restarts fresh, and any tool call that was mid-flight when
the process died is not replayed (the model simply continues from the last
completed iteration).

### `cammy sessions`

Lists all session journals in `.cammy/sessions/`.

```bash
node cammy.mjs sessions
```

### `cammy serve`

Starts the local HTTP backend on port 7433 for the dashboard UI: an SSE event
stream plus endpoints to start runs and answer approval requests. See
[Serve mode API](#serve-mode-api).

```bash
node cammy.mjs serve
```

---

## Configuration (cammy.json)

Created by `cammy init`. Every option, its default, and what changing it does:

| Option | Default | What it does |
|---|---|---|
| `provider` | `"anthropic"` | Which adapter to use: `anthropic`, `openai`, `ollama`, or `google`. Wrong value falls through to the OpenAI-compatible adapter. |
| `model` | `"claude-sonnet-4-20250514"` | Model name sent to the provider. Must be valid for the chosen provider or every call will fail. |
| `baseUrl` | `null` | Override the provider's API base URL — for proxies, gateways, or self-hosted OpenAI-compatible servers. `null` uses each provider's default (Ollama defaults to `http://localhost:11434`). |
| `maxIterations` | `30` | Hard cap on loop iterations. Lower it for small tasks to bound cost; raise for complex multi-step goals. |
| `budgetUSD` | `2.0` | Dollar ceiling per session, computed from `pricing`. Session ends with `budget_exceeded` when crossed. |
| `timeoutMinutes` | `20` | Wall-clock ceiling per session. Checked between iterations (a long single tool call can briefly overshoot). |
| `stuckThreshold` | `3` | How many identical tool calls trigger the stuck guard. At N the model gets a warning injected; past N the session ends with `stuck`. |
| `approval` | `{ "shell": "ask", "write_file": "auto" }` | Per-tool gating: `"ask"` requires human approval, `"auto"` executes immediately. Any tool not listed defaults to `"auto"`. |
| `pricing` | `{ "inputPerMTok": 3.0, "outputPerMTok": 15.0 }` | Dollars per million tokens, used by the budget guard. **Defaults are Claude rates — update these when you switch providers** or the budget math will be wrong. |
| `tasks` | `{ "fix-tests": "..." }` | Named, reusable goals runnable with `--task=name`. Add your own freely. |

CLI flags override cammy.json, which overrides built-in defaults.

---

## Providers

Switch providers with one line in `cammy.json` (or `--provider=` for one run).

### Anthropic (default)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```
```json
{ "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
```

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
```
```json
{
  "provider": "openai", "model": "gpt-4o",
  "pricing": { "inputPerMTok": 2.5, "outputPerMTok": 10.0 }
}
```

### Ollama (local models, no key)

Requires [Ollama](https://ollama.com) running locally. Pick a model that
supports tool calling.

```bash
ollama pull gemma3
```
```json
{
  "provider": "ollama", "model": "gemma3",
  "pricing": { "inputPerMTok": 0, "outputPerMTok": 0 }
}
```

### Google (Gemma 4 / Gemini, hosted)

Key comes from Google AI Studio. Cammy reads `GEMINI_API_KEY` first, then
`GOOGLE_API_KEY`.

```bash
export GEMINI_API_KEY=...
```
```json
{ "provider": "google", "model": "gemma-4-26b-a4b-it" }
```

Note: hosted Gemma **4** models support native function calling, which Cammy
relies on. Older Gemma 3 hosted models do not have native tool-calling tokens
and will be unreliable in the loop.

### Any OpenAI-compatible endpoint

Use `provider: "openai"` with a `baseUrl` (vLLM, LM Studio, gateways, etc.):

```json
{ "provider": "openai", "model": "your-model", "baseUrl": "http://localhost:8000" }
```

---

## Tool reference

These are the actions the agent can take. All paths are jailed to the working
directory — see [Security model](#security-model).

**read_file** — Reads a UTF-8 text file at a workspace-relative path. Output is
truncated at 50 KB with a `…[truncated]` marker. The agent is instructed to
always read a file before modifying it.

**write_file** — Creates or overwrites a file with the given content, creating
parent directories as needed. Returns the byte count written. Auto-approved by
default (journaled, so every write is auditable).

**list_dir** — Lists the entries of a directory, with `/` appended to
subdirectory names. Defaults to the workspace root if no path given.

**search** — Runs a JavaScript regex line-by-line across workspace files and
returns up to 100 `file:line: text` matches. Skips `node_modules`, `.git`,
`.cammy`, `dist`, `build`, and any file over 1 MB.

**shell** — Runs a shell command in the workspace with a 60-second timeout.
Returns the exit code plus stdout and stderr, truncated at 20 KB.
**Approval-gated by default** — you are asked y/N before each command runs.

**done** — Ends the session. The agent calls this with a summary and a status
of `success` or `blocked`. A text-only reply with no tool calls is also treated
as a successful final answer.

---

## Guardrails & session end states

Every run is bounded by four independent guards. Each end state below appears
in the final `■` line of the terminal output and in the `session_end` journal
event.

| Status | What it means | How to fix |
|---|---|---|
| `success` | The agent called `done` with success, or gave a final text answer. | Nothing — verify the work. |
| `blocked` | The agent gave up deliberately and explained why in the summary. | Read the summary; usually a missing dependency, credential, or ambiguous goal. |
| `max_iterations` | The loop hit `maxIterations` before finishing. | Raise `--max=N`, simplify the goal, or split it into named tasks. |
| `budget_exceeded` | Estimated spend crossed `budgetUSD`. | Raise the budget, use a cheaper model, or check `pricing` is set correctly for your provider. |
| `timeout` | Wall clock crossed `timeoutMinutes`. | Raise the timeout or split the goal. |
| `stuck` | The agent repeated the identical tool call more than `stuckThreshold` times. | Rephrase the goal with more specifics; check the repeated call in the journal to see what confused it. |
| `provider_error` | The model API failed twice in a row (after one 3s retry). | Check your API key, network, model name, and provider status page. |

The stuck guard escalates: at exactly `stuckThreshold` repeats the model gets a
warning injected as a tool error ("change your strategy"); only if it repeats
again does the session end.

---

## Approval gates

Tools marked `"ask"` in `approval` pause the loop until a human decides.

- **Terminal:** you'll see `⚠ approve shell: {"command":"npm test"}? [y/N]` —
  anything other than `y`/`yes` denies. A denial doesn't end the session; the
  model is told "Denied by operator." and chooses another approach.
- **Dashboard (serve mode):** an `approval_request` event is emitted over SSE;
  the loop blocks until `POST /approve` answers it.
- **Bypass:** `--yes` disables all gates for one run. Recommended only in
  sandboxed environments or CI containers.

Every approval decision is journaled (`approval` event with `allowed: true/false`).

---

## Sessions, checkpoints & resume

Each run writes a journal to `.cammy/sessions/<session-id>.jsonl`. The session
ID is timestamp-based plus a random suffix, e.g.
`2026-06-09T14-22-31-008Z-a1b2c3`.

After every completed iteration, a `checkpoint` event captures the full
conversation and usage counters. `cammy resume <id>` finds the most recent
checkpoint and continues the loop from there with the original goal. Sessions
that ended in `success` can technically be resumed but the model will usually
just call `done` again.

Journals are plain JSONL: inspect them with `cat`, `jq`, or any text editor.
They are your audit log — nothing the agent does is unrecorded.

---

## Journal format (JSONL events)

One JSON object per line. Every event has `ts` (epoch ms) and `type`. Build
tooling on these freely — this format is the contract.

| `type` | Fields | When |
|---|---|---|
| `session_start` | `sessionId, goal, provider, model, resumed` | Once, at launch |
| `iteration` | `n, cost` | Start of each loop turn |
| `assistant` | `iteration, text` | When the model produces visible reasoning text |
| `tool_call` | `iteration, name, input` | Before a tool executes |
| `approval` | `name, allowed` | When a human answers a gate |
| `tool_result` | `iteration, name, isError, output` (output capped at 2 000 chars) | After a tool executes |
| `checkpoint` | `iteration, messages, usage` | End of each iteration (resume point) |
| `warn` | `text` | Retries and recoverable errors |
| `session_end` | `status, summary, iterations, usage, cost` | Once, at termination |

In serve mode one additional event exists on the SSE stream only (never in the
journal): `approval_request` with `id, name, input`.

---

## Serve mode API

`cammy serve` listens on `http://localhost:7433` with permissive CORS. Three
endpoints:

### `GET /events` — SSE stream

All journal events plus `approval_request`, as standard server-sent events.

```js
const es = new EventSource("http://localhost:7433/events");
es.onmessage = (m) => console.log(JSON.parse(m.data));
```

### `POST /run` — start a session

```bash
curl -X POST http://localhost:7433/run \
  -H "content-type: application/json" \
  -d '{"goal": "fix the failing tests"}'
# → {"ok":true}   (events arrive on /events)
```

### `POST /approve` — answer an approval request

Respond to an `approval_request` event using its `id`:

```bash
curl -X POST http://localhost:7433/approve \
  -H "content-type: application/json" \
  -d '{"id": "<uuid-from-event>", "allow": true}'
# → {"ok":true}
```

The loop blocks on unanswered approval requests indefinitely — there is
currently no timeout, so don't lose the event.

⚠ The server binds without authentication and is intended for **localhost
use only**. Do not expose port 7433 to a network.

---

## Security model

What the agent can touch, and what it can't:

- **Workspace jail.** Every file path in every tool is resolved against the
  working directory and rejected if it escapes (`Path escapes workspace`).
  `../../etc/passwd` does not work. Symlinks inside the workspace that point
  outside are not followed-checked — avoid running Cammy in directories
  containing such links.
- **Shell is the escape hatch — and it's gated.** `shell` commands run with
  your user's full permissions and are *not* path-jailed (a shell command can
  `cd` anywhere). This is exactly why shell defaults to `"ask"`. Treat `--yes`
  as equivalent to letting the model use your terminal.
- **Bounded by four guards.** Iterations, budget, wall clock, and stuck
  detection each independently terminate runaway sessions.
- **Everything is journaled.** Every tool call, result, approval, and model
  message is written to the session journal before and after execution.
- **No telemetry.** Cammy makes network requests only to the model provider
  you configured. Nothing else, ever.
- **Keys stay in env vars.** API keys are read from environment variables and
  are never written to config, journals, or disk.

Recommended posture for untrusted or experimental goals: run inside a container
or throwaway clone of your repo, keep `shell: "ask"`, and set a low
`budgetUSD`.

---

## Troubleshooting & FAQ

**`Anthropic 401` / `Provider 401` / `Google 400` errors immediately.**
Your API key env var is missing, misspelled, or invalid in this terminal.
`echo $ANTHROPIC_API_KEY` (or the relevant var) to verify. Remember keys set
in one terminal don't exist in another.

**`SyntaxError: Unexpected token` or `import` errors on launch.**
Your Node is older than 18. Check `node --version`; upgrade via
[nodejs.org](https://nodejs.org) or nvm.

**`fetch failed` with Ollama.**
Ollama isn't running (`ollama serve`) or the model isn't pulled
(`ollama pull gemma3`). Confirm with `curl http://localhost:11434`.

**Session ends `stuck` immediately or loops on the same file.**
The model can't find what your goal references. Make the goal concrete:
"fix the regex in src/parser.js so negative numbers tokenize" beats
"fix the parser".

**`budget_exceeded` after a few iterations on a cheap model.**
Your `pricing` block still has Claude defaults. Set provider-accurate rates
(or zeros for local models).

**Port 7433 already in use for `serve`.**
Another Cammy (or other process) holds it: `lsof -i :7433` to find it, kill
it, or edit the port in the `serve()` call.

**The agent's tool calls fail with weird JSON on Ollama/small models.**
Small local models are unreliable tool-callers. Use a model documented as
supporting function calling (gemma3, llama3.1, qwen2.5 etc.); avoid heavily
quantized variants for agent work.

**`cammy resume` says "No checkpoint to resume from."**
The session died during its very first iteration, before any checkpoint was
written. Just start a new run.

**Windows: paths or shell commands behave oddly.**
Cammy is developed primarily against POSIX shells. On Windows, run it inside
WSL for best results. (Native Windows support is tracked as a starter issue.)

**Does Cammy send my code anywhere?**
Only to the model provider you configured, as part of the conversation (file
contents the agent reads become messages). With Ollama, nothing leaves your
machine.

---

*Docs version: v0.1.1 — every snippet above is verified against `cammy.mjs`
at that version. If you find drift, that's a bug: please open an issue.*
