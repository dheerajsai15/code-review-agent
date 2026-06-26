# PR Review Agent (LangGraph.js MVP)

An autonomous GitHub Pull Request review agent. Paste a PR URL, the agent reviews
the diff, pauses for your approval, and on approval posts a single summary comment.

This is the **walking-skeleton + resume scaffold** (plan build step 1): the graph,
typed state, fan-out, human-gate interrupt, and durable checkpointing are real;
`ingest` and `post` are mocked until step 2 wires GitHub I/O.

## Why a graph (not a script)

The graph exercises the parts that are hard to fake:

- **Typed shared state with reducers** — `fileReviews` uses a `concat` reducer so
  parallel review branches merge instead of clobbering each other.
- **Dynamic parallel fan-out** — `routeAfterTriage` returns a list of `Send`
  objects, spawning one `review` node per file (capped concurrency later). No
  static edge-per-file.
- **Human-in-the-loop interrupt** — `humanGate` checkpoints and halts before any
  write; nothing reaches GitHub without approval.
- **Durable checkpointer (Postgres)** — because the interrupt persists state, an
  abandoned run can be resumed from a *separate process* via `resume <thread-id>`.

Deterministic code is preferred where an LLM adds no value: triage (skip
lockfiles/generated/binary/oversized) and aggregate (filter, rank, render) have
**no LLM call**. The only LLM node is `review`.

## Flow

```
START -> ingest -> [triage router]
                      |- skip ----------------------------------> END (skipped)
                      |- review (xN parallel via Send) -> aggregate -> humanGate -> [gate router]
                                                                                       |- abort -> END (aborted)
                                                                                       |- approve -> post -> END (posted)
```

## Setup

```bash
npm install
cp .env.example .env        # DATABASE_URL + (optional) OPENAI_API_KEY
npm run db:up               # start Postgres (docker compose)
```

Without `DATABASE_URL` the agent uses an in-memory checkpointer (the graph runs,
but cross-process `resume` won't work). With `USE_LLM=false` (default) the
`review` node uses a deterministic offline stub, so no OpenAI key is needed to
see the whole graph run.

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
resume.

## Status

- [x] State schema + reducers, five nodes, graph wiring, fan-out, interrupt
- [x] Postgres checkpointer + `review`/`resume` CLI
- [x] Offline stub reviewer + optional OpenAI (`review` node)
- [x] **Step 2:** real `ingest` (Octokit fetch) + `post` (PAT publisher), behind
      `GITHUB_TOKEN` (unset / `USE_GITHUB=false` -> offline mocks)
- [ ] Polish: token/cost logging, error handling, prompt + schema refinement
