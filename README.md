# Cammy 🔁

**The open-source agentic loop harness for developers.** Goal in, working code out — no prompt engineering required.

MIT licensed · Node 18+ · zero dependencies · single file

Cammy wraps the entire plan → act → observe agent loop so you don't have to: it synthesizes the system prompt, executes tools, retries failed model calls, detects stuck loops, enforces budget / iteration / wall-clock guardrails, gates dangerous actions behind human approval, and journals every event to resumable JSONL sessions.

📖 **Full documentation:** [DOCS.md](./DOCS.md)

## Install

```bash
npm i -g cammy        # or run directly: node cammy.mjs
```

## Quickstart

```bash
export ANTHROPIC_API_KEY=sk-...   # or OPENAI_API_KEY
cammy init
cammy run "fix the failing tests and make CI green"
cammy serve                       # dashboard backend on :7433
```

## Commands

| Command | What it does |
|---|---|
| `cammy init` | Scaffold `cammy.json` config and `.cammy/` session dir |
| `cammy run "<goal>"` | Run the agent loop on a goal (`--yes`, `--max=N`, `--model=`, `--provider=`, `--task=`) |
| `cammy resume <id>` | Continue an interrupted session from its last checkpoint |
| `cammy sessions` | List past session journals |
| `cammy serve` | Start the local API + SSE event stream for the dashboard UI |

## Guardrails

Every run is bounded by four independent guards: max iterations, dollar budget, wall-clock timeout, and identical-action stuck detection. Shell access requires human approval by default (`--yes` to bypass). All file operations are jailed to the workspace directory.

## Providers

Anthropic (native), OpenAI, and Ollama (via the OpenAI-compatible adapter) — switch with one line in `cammy.json`:

```json
{ "provider": "ollama", "model": "llama3.1", "baseUrl": "http://localhost:11434" }
```

## Dashboard UI

The `ui/` folder contains a React dashboard (Tailwind + framer-motion + lucide-react) that streams live loop events from `cammy serve` over SSE at `localhost:7433`, with guardrail meters and in-browser approval gates.

## How it works

```mermaid
flowchart TD
    G["🎯 Goal in plain language<br/>cammy run · --task=name · POST /run"] --> P["Cammy synthesizes the system prompt<br/>(you never write one)"]
    P --> L(["Loop iteration"])

    L --> GU{"Guards check<br/>iterations · budget · wall clock · stuck"}
    GU -->|limit hit| EG["■ max_iterations / budget_exceeded<br/>/ timeout / stuck"]
    GU -->|ok| M["Call model via provider adapter<br/>anthropic · openai · ollama · google"]

    M -->|API fails twice| EP["■ provider_error"]
    M --> D{Model response}

    D -->|"done(success) or final text"| ES["■ success"]
    D -->|"done(blocked)"| EB["■ blocked"]
    D -->|tool call| AP{"Approval gate<br/>shell = ask by default"}

    AP -->|denied| DN["Result: 'Denied by operator.'<br/>(model picks another approach)"]
    AP -->|approved / auto| T["Execute tool<br/>read_file · write_file · list_dir<br/>search · shell — all jailed to workspace"]

    T --> J["Journal + checkpoint<br/>.cammy/sessions/&lt;id&gt;.jsonl"]
    DN --> J
    J --> L

    RS["cammy resume &lt;id&gt;"] -.->|restores last checkpoint| L

    classDef good fill:#1a7f37,stroke:#1a7f37,color:#fff
    classDef bad fill:#cf222e,stroke:#cf222e,color:#fff
    classDef warn fill:#9a6700,stroke:#9a6700,color:#fff
    class ES good
    class EB,EG warn
    class EP bad
```

Every box on the right edge is a terminal state you'll see in the final `■` line
and in the `session_end` journal event. The loop is fully auditable: every tool
call, result, and approval decision hits the journal before the next iteration.

## License

MIT — see [LICENSE](./LICENSE).
