# GitHub PR Review Agent — MVP Plan (LangGraph.js)

> Handoff doc for Claude Code. This is the **MVP slice** of a larger agent. Scope is
> deliberately frozen — read "Out of scope" and "Locked decisions" before adding anything.

---

## 1. Goal & context

A portfolio project: an autonomous **GitHub Pull Request review agent** built on **LangGraph.js**.
A human pastes a PR URL, the agent reviews the diff, asks for approval, and on approval posts a
single summary review comment to the PR.

The point of choosing LangGraph (vs. a linear script) is to exercise the parts that are hard to fake:
typed shared state with reducers, conditional routing, dynamic parallel fan-out, a checkpointer, and a
human-in-the-loop interrupt. The README should explain *why* a graph was used and where deterministic
code was deliberately preferred over an LLM call.

---

## 2. MVP functional requirements

| ID | Requirement |
|----|-------------|
| **FR-1 Input** | Accept a GitHub PR URL. Parse `owner/repo/number`. Validate it resolves and is reachable with the token. Malformed/inaccessible URLs fail fast with a clear message. |
| **FR-2 Auth** | Authenticate to GitHub with a user-supplied token (fine-grained PAT, scoped to one repo, `pull requests: write`). **All writes go through a `PrPublisher` interface** — PAT-backed for the MVP, swappable to a GitHub App client later. Comments are attributed to the authenticated user. Token comes from env/secret; never prompted in plaintext. |
| **FR-3 Context** | Fetch PR metadata, the diff, and changed-file contents. Assemble per-file context = hunk + surrounding lines + path. This is the **only** context source for the MVP (no linters/scanners). |
| **FR-4 Review** | Produce structured findings (see `Finding` schema). Dedupe and rank into a final set before presenting. |
| **FR-5 Human gate** | Pause and present drafted findings for explicit approval **before any write**. Approve (post) or abort (discard). Implemented as a LangGraph `interrupt`, so a checkpointer is required (in-memory or SQLite is fine). |
| **FR-6 Posting** | On approval only, post **one summary comment** to the PR via `PrPublisher`, as the authenticated user. Nothing reaches GitHub without approval. |
| **FR-7 Run integrity** | One run reviews one PR end to end. Re-run idempotency (no double-post) is out of scope. |

### Locked decisions

1. **Output = single summary comment** (one PR-level markdown body, findings grouped by file).
   *Not* inline line-anchored comments — that's a v2 story.
2. **Static analysis = out.** Pure LLM-on-diff. Deterministic tooling is a later phase.
3. **Approval granularity = approve-all-or-abort.** No per-comment selection/editing yet.
4. **Trigger = manual CLI invocation** with a pasted URL. No webhook / queue / worker.

### Out of scope (do NOT build for MVP)

- Webhook / auto-trigger, job queue, worker pool
- GitLab support
- Batch / multi-PR runs
- Inline line-anchored comments
- Re-run idempotency / dedup of posts
- Multi-language static analysis
- Reviewer self-context cycle (fetch-definition-then-re-review loop)

### Done-when

Paste a PR URL → agent prints grouped findings in the terminal → you approve → a summary
comment appears on the PR under your account.

---

## 3. Identity / auth approach

Three ways to post: **PAT (as you)**, **machine user**, **GitHub App (as a `[bot]`)**.

- MVP uses a **fine-grained PAT**, posting as the user — fastest to "done-when", least-privilege when scoped to one repo.
- GitHub App is the better *destination* (own `[bot]` identity, per-repo permissions, separate rate budget) but its JWT → installation-token dance only pays off once webhooks + multiple repos exist.
- **Mitigation:** all GitHub writes go through a `PrPublisher` interface so swapping PAT → GitHub App later is a localized change.

```ts
interface PrPublisher {
  postReview(prRef: PrRef, body: string): Promise<void>;
}
// MVP: PatPrPublisher (Octokit + PAT). Later: GitHubAppPrPublisher.
```

> Caveat to revisit: posting under your own name on a public/shared repo is mildly misleading.
> If you demo publicly, prioritize the GitHub App so machine-authorship is legible.

---

## 4. Architecture

### State schema (the spine)

Everything flows through one shared state object. The reducers matter — see notes.

```ts
import { Annotation } from "@langchain/langgraph";

const State = Annotation.Root({
  pr: Annotation<PrMeta>(),                     // owner, repo, number, sha, author
  files: Annotation<FileDiff[]>(),              // changed files surviving triage
  fileReviews: Annotation<Finding[]>({          // N parallel branches write here
    reducer: (a, b) => a.concat(b),             // CONCAT — not last-write-wins
    default: () => [],
  }),
  comments: Annotation<Finding[]>(),            // aggregated + ranked (final set)
  summaryBody: Annotation<string>(),            // rendered markdown comment
  approved: Annotation<boolean>(),              // set by the human gate
  usage: Annotation<Usage>({                    // tokens + $ accumulate
    reducer: (a, b) => sumUsage(a, b),
    default: () => emptyUsage(),
  }),
});
type StateType = typeof State.State;
```

**Why the `fileReviews` reducer is load-bearing:** parallel review branches all write to this
channel. Default channel behavior is last-write-wins, so without `concat` you silently keep only
one file's review and lose the rest. Anything a parallel branch writes must target a channel with
a reducer.

### Nodes (MVP)

| Node | Type | Responsibility |
|------|------|----------------|
| `ingest` | deterministic / IO | Parse + validate URL (FR-1), validate token/access (FR-2), fetch PR meta + diff + file contents, build per-file context (FR-3). |
| *(triage)* | deterministic | Heuristic filter — skip lockfiles, generated/vendored, binary, oversized. Implemented as the **router function** on the conditional edge (no LLM). |
| `review` | **LLM** | The only LLM node. Reviews ONE file's payload, emits `Finding[]`. Spawned in parallel via `Send`, concurrency capped ~3–5. |
| `aggregate` | deterministic | Group by file, rank by severity, render the single summary markdown body. No LLM in v1. |
| `humanGate` | control | `interrupt` → approve-all or abort. Requires checkpointer. |
| `post` | deterministic / IO | Post the summary comment via `PrPublisher`. |

Three terminal paths: **skipped** (trivial diff), **aborted** (human said no), **posted** (success).

### Graph wiring

```ts
import { StateGraph, START, END, Send } from "@langchain/langgraph";

const graph = new StateGraph(State)
  .addNode("ingest", ingest)
  .addNode("review", review)        // fan-out target
  .addNode("aggregate", aggregate)
  .addNode("humanGate", humanGate)  // interrupt lives here
  .addNode("post", post)
  .addEdge(START, "ingest")
  .addConditionalEdges("ingest", routeAfterTriage, {
    review: "review",               // returns Send[] for fan-out (see below)
    skip: END,
  })
  .addEdge("review", "aggregate")   // fan-in; concat reducer merges branches
  .addEdge("aggregate", "humanGate")
  .addConditionalEdges("humanGate", routeAfterGate, {
    approve: "post",
    abort: END,
  })
  .addEdge("post", END)
  .compile({ checkpointer });       // REQUIRED — the interrupt needs it
```

> `.compile({ checkpointer })` is not optional: the `humanGate` interrupt works by checkpointing
> state and halting, then resuming. Use `MemorySaver` or a SQLite saver for the MVP.

### The `Send` fan-out

`Send` is `.map()` for graph nodes. You do NOT draw an edge per file at build time. A routing
function returns a **list of `Send` objects at runtime**, and LangGraph spawns the target node once
per `Send`, each carrying its own payload. Outputs merge through the channel reducer.

```ts
function routeAfterTriage(state: StateType) {
  const files = state.files.filter(isReviewable);   // heuristic triage here
  if (files.length === 0) return "skip";            // → END
  return files.map((file) => new Send("review", { file }));  // one branch per file
}

// Each branch receives ONE file's payload — not the whole list:
async function review(payload: { file: FileDiff }): Promise<Partial<StateType>> {
  const findings = await llmReview(payload.file);   // structured Finding[]
  return { fileReviews: findings };                 // merged via concat reducer
}

function routeAfterGate(state: StateType) {
  return state.approved ? "approve" : "abort";
}
```

Why `Send` over a `for` loop: a loop is sequential, lives outside the graph, and gets no
checkpointing or parallelism. With `Send`, each file's review is a first-class graph step, so
parallelism, checkpoint/resume, and per-branch retries all apply per file. This is the answer to
"why LangGraph instead of a script?"

### Flow (text)

```
START → ingest → [routeAfterTriage]
                    ├─ skip ───────────────────────────→ END (trivial, skipped)
                    └─ review (×N parallel via Send) → aggregate → humanGate → [routeAfterGate]
                                                                                   ├─ abort → END (aborted)
                                                                                   └─ approve → post → END (posted)
```

---

## 5. Design principles

- **Exactly one LLM node** (`review`). Triage and aggregate are deterministic. Keeps the
  per-iteration token cost low (re-running to tune the prompt only pays for reviews).
- **Keep the fan-out** — do not collapse it to a loop. It's the signature LangGraph feature and the
  reason the `concat` reducer exists. Cap concurrency ~3–5 to respect rate limits.
- **Checkpointer is mandatory** because of the interrupt. In-memory/SQLite for MVP.
- **Context assembly is the quality lever.** v1 = hunk + surrounding lines + path. Resist repo-wide
  retrieval until a metric says it's the bottleneck.
- **Precision over recall.** A noisy reviewer gets disabled. Aggregate should drop low-confidence /
  low-severity items. A good sanity check later: run on clean merged PRs and expect ~zero comments.

---

## 6. Proposed data contract — `Finding`

> Starting point, not yet finalized. This schema is consumed by `aggregate` AND will be scored by the
> eval harness later, so it's worth keeping stable. Refine before/while building `review`.

```ts
type Severity = "blocker" | "major" | "minor" | "nit";
type Category =
  | "bug" | "security" | "performance"
  | "concurrency" | "style" | "maintainability" | "test";

interface Finding {
  file: string;          // path, relative to repo root
  severity: Severity;
  category: Category;
  message: string;       // what's wrong + why; actionable
  line?: number;         // optional; unused in MVP (summary comment only)
  confidence?: number;   // 0..1, used by aggregate to filter noise
}
```

The `review` node should prompt the model to return **strictly this JSON shape** (array of
`Finding`), parse defensively, and drop malformed entries rather than failing the run.

---

## 7. Tech stack

- **Runtime:** Node.js + TypeScript
- **Graph:** `@langchain/langgraph`
- **GitHub:** `@octokit/rest` (behind `PrPublisher`)
- **Checkpointer:** `MemorySaver` or SQLite saver (MVP)
- **LLM:** your provider of choice (provider-agnostic; one call site in `review`)
- **CLI:** thin entry point that takes a PR URL, runs the graph, prints findings, reads approve/abort from stdin, resumes

---

## 8. Build sequence

1. **Walking skeleton** — graph runs on a pasted diff, prints fake/real findings to stdout. No GitHub write. Highest-morale milestone; get here fast.
2. **Resume-able MVP** — wire `ingest` to GitHub (fetch), wire `post` to GitHub (write via `PrPublisher`), the `interrupt` approval in the CLI. This is the target.
3. Polish: README explaining design choices, error handling, token/cost logging.

Suggested first deliverable for Claude Code: scaffold the project, the `State` schema, the five
nodes as stubs, the wiring in §4, and a CLI that runs the graph end to end with mocked `ingest`/`post`
— so the graph + interrupt + fan-out work before real GitHub I/O is added.

---

## 9. Open items / next to design

- `review` node **prompt** (the actual review instructions + few-shot shape).
- Finalize the `Finding` schema (§6).
- `aggregate` dedupe + ranking rules and the summary markdown template.
- Triage heuristics: exact skip rules + size caps.

---

## 10. Future phases (NOT MVP — context only)

Webhook ingress (verify HMAC, respond fast) → Redis queue (BullMQ) → stateless workers running the
graph, with Postgres checkpointer keyed by `${prId}:${sha}`. GitHub App identity. Debounce on
re-push (key by PR+sha, cancel stale in-flight runs). Static analysis nodes feeding the reviewer.
Inline line-anchored comments. Eval harness (fault injection → runner → precision/recall/cost).
Reviewer self-context cycle.
