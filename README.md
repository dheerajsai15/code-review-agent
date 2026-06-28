# PR Review Agent (LangGraph.js)

An autonomous GitHub Pull Request review agent. Paste a PR URL: the agent fetches
the diff, reviews each changed file **in parallel**, pauses for your approval, and
on approval posts a single summary comment back to the PR.

Built on **LangGraph.js** (TypeScript / Node). It runs fully offline with a
deterministic stub reviewer and in-memory state, or against the real GitHub and
OpenAI APIs once you add tokens — the same graph either way.

## Why a graph (not a script)

The graph exercises the parts that are hard to fake:

- **Typed shared state with reducers** — `fileReviews` uses a `concat` reducer so
  parallel review branches merge instead of clobbering each other; `usage` uses a
  `sumUsage` reducer to accumulate tokens/cost across branches.
- **Dynamic parallel fan-out** — `routeAfterTriage` returns a list of `Send`
  objects, spawning one `review` node per reviewable file. No static edge-per-file.
- **Human-in-the-loop interrupt** — `humanGate` checkpoints and halts before any
  write; nothing reaches GitHub without approval.
- **Durable checkpointer (Postgres)** — because the interrupt persists state, an
  abandoned run can be resumed from a *separate process* via `resume <thread-id>`.

Deterministic code is preferred where an LLM adds no value: triage (skip
lockfiles / generated / binary / oversized files) and aggregate (filter by
confidence, rank by severity, render markdown) have **no LLM call**. The only LLM
node is `review`.

## Flow

```
START -> ingest -> [triage router]
                      |- skip ----------------------------------> END (skipped)
                      |- review (xN parallel via Send) -> aggregate -> humanGate -> [gate router]
                                                                                       |- abort -> END (aborted)
                                                                                       |- approve -> post -> END (posted)
```

The barrier between supersteps guarantees `aggregate` runs **once**, only after
every fanned-out `review` branch has completed and its findings merged.

## Setup

```bash
npm install
cp .env.example .env        # see Configuration below
npm run db:up               # start Postgres (docker compose)
```

Nothing is required to see the graph run: with no `DATABASE_URL` it falls back to
an in-memory checkpointer (cross-process `resume` won't work), and with
`USE_LLM=false` (default) the `review` node uses a deterministic offline stub, so
no OpenAI key is needed. Add tokens to go live.

## Usage

```bash
# Run a review to the approval gate, then decide interactively:
npm run review -- https://github.com/owner/repo/pull/42

# Or decide non-interactively:
npm run review -- https://github.com/owner/repo/pull/42 --approve
npm run review -- https://github.com/owner/repo/pull/42 --abort

# Resume an abandoned run (state restored from Postgres):
npm run resume -- "owner/repo#42:<sha>" --approve
```

The `thread_id` (`prId:sha`) is printed at the start of every run — use it to
resume. On completion the run reports its outcome and token usage, e.g.
`Tokens: 4210 (prompt 3950 / completion 260) — ~$0.0008`.

### Try it on a generated PR

`demo:repo` creates a private repo on your account with a baseline service and a
feature PR that plants real issues (SQL injection, hardcoded secret, N+1 queries,
loose equality, a skipped lockfile) for the agent to find:

```bash
npm run demo:repo           # prints a PR URL
npm run review -- <that-url>
```

## Configuration

Set in `.env` (see `.env.example`). Sensible defaults keep the agent offline.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres checkpointer. Unset → in-memory (no cross-process resume). |
| `USE_LLM` | `true` to call OpenAI in the `review` node; `false` (default) uses the offline stub. |
| `OPENAI_API_KEY` | Required when `USE_LLM=true`. |
| `OPENAI_MODEL` | Model id (default `gpt-5.4-mini`). |
| `OPENAI_INPUT_COST_PER_1M` / `OPENAI_OUTPUT_COST_PER_1M` | Optional price override (USD per 1M tokens) for models not in the live pricing table. |
| `GITHUB_TOKEN` | Fine-grained PAT (`pull requests: write`). Set → real fetch + post; unset → offline mocks. |
| `USE_GITHUB` | `false` forces mocks even when a token is present. |

Token costs are resolved per-model from LiteLLM's live price table (fetched once
and cached); unknown models fall back to the env override, then to `$0`.

## Project layout

```
src/
  cli.ts            entry point: review / resume commands, the approval prompt
  graph/            state, graph wiring, routing, and the five nodes
  domain/           pure logic: types, PR-URL parsing, triage, usage math
  services/         side effects: GitHub (Octokit), OpenAI, checkpointer, pricing
scripts/            demo-repo generator and one-off probes
```
