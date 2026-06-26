import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Command, type StateSnapshot } from "@langchain/langgraph";
import { buildGraph, type App } from "./graph";
import { getCheckpointer, closeCheckpointer } from "./services/checkpointer";
import { parsePrUrl, threadId } from "./domain/pr-url";
import { mockResolveHeadSha, mockFetchPrMeta } from "./services/mocks";
import { useRealGitHub, fetchPrMeta } from "./services/github";
import type { Finding } from "./domain/types";

type Decision = "approve" | "abort";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "review") await runReview(rest);
    else if (cmd === "resume") await runResume(rest);
    else usageAndExit();
  } finally {
    await closeCheckpointer();
  }
}

function usageAndExit(): never {
  console.error(
    [
      "Usage:",
      "  npm run review -- <pr-url> [--approve|--abort]",
      "  npm run resume -- <thread-id> [--approve|--abort]",
      "",
      "Without a decision flag, an interactive y/n prompt is shown. If the",
      "prompt can't run (non-tty / closed), the run stays paused in the",
      "checkpointer and can be continued later with `resume <thread-id>`.",
    ].join("\n"),
  );
  process.exit(1);
}

// --- review: run from a URL to the human gate, then resume in-process ----------

async function runReview(args: string[]): Promise<void> {
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) usageAndExit();
  const decisionFlag = parseDecisionFlag(args);

  const ref = parsePrUrl(url);
  // Resolve the FULL PR metadata once (also validates URL + token access,
  // FR-1/FR-2). Seeding it lets ingest skip its own meta fetch.
  const pr = useRealGitHub() ? await fetchPrMeta(ref) : mockFetchPrMeta(ref, mockResolveHeadSha(ref));
  const tid = threadId(ref, pr.sha);
  const config = { configurable: { thread_id: tid } };

  console.log(`thread_id: ${tid}\n`);

  const app = buildGraph(await getCheckpointer());

  // Seed full PR metadata; ingest only fetches the changed files.
  await app.invoke({ pr }, config);

  await handleGate(app, config, tid, decisionFlag);
}

// --- resume: continue an abandoned run from its checkpoint ---------------------

async function runResume(args: string[]): Promise<void> {
  const tid = args.find((a) => !a.startsWith("--"));
  if (!tid) usageAndExit();
  const decisionFlag = parseDecisionFlag(args);
  const config = { configurable: { thread_id: tid } };

  const app = buildGraph(await getCheckpointer());
  const snap = await app.getState(config);

  if (!snap.createdAt) {
    console.error(`No checkpoint found for thread_id "${tid}". Was it run with Postgres?`);
    process.exit(1);
  }
  console.log(`Resuming thread_id: ${tid}\n`);
  await handleGate(app, config, tid, decisionFlag);
}

// --- shared gate handling ------------------------------------------------------

async function handleGate(
  app: App,
  config: { configurable: { thread_id: string } },
  tid: string,
  decisionFlag: Decision | undefined,
): Promise<void> {
  let snap = await app.getState(config);
  const pending = pendingInterrupt(snap);

  if (!pending) {
    reportOutcome(snap);
    return;
  }

  printFindings(pending);

  const decision = decisionFlag ?? (await promptDecision());
  if (decision === null) {
    console.log(`\nLeft paused. Resume later with:  npm run resume -- ${tid} --approve`);
    return;
  }

  await app.invoke(new Command({ resume: decision }), config);
  snap = await app.getState(config);
  reportOutcome(snap);
}

// --- helpers -------------------------------------------------------------------

function parseDecisionFlag(args: string[]): Decision | undefined {
  if (args.includes("--approve")) return "approve";
  if (args.includes("--abort")) return "abort";
  return undefined;
}

interface GatePayload {
  summaryBody: string;
  comments: Finding[];
}

/** Reads the interrupt value parked on the pending humanGate task, if any. */
function pendingInterrupt(snap: StateSnapshot): GatePayload | undefined {
  for (const task of snap.tasks ?? []) {
    const intr = task.interrupts?.[0];
    if (intr) return intr.value as GatePayload;
  }
  return undefined;
}

function printFindings(payload: GatePayload): void {
  console.log("\n----- drafted review -----\n");
  console.log(payload.summaryBody);
  console.log("\n--------------------------");
}

async function promptDecision(): Promise<Decision | null> {
  if (!process.stdin.isTTY) return null; // non-interactive: leave paused
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("\nPost this review to the PR? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes" ? "approve" : "abort";
  } finally {
    rl.close();
  }
}

function reportOutcome(snap: StateSnapshot): void {
  const values = snap.values as { approved?: boolean; summaryBody?: string };
  if (values.approved === true) console.log("\nOutcome: POSTED");
  else if (values.approved === false) console.log("\nOutcome: ABORTED (nothing posted)");
  else if (!values.summaryBody) console.log("\nOutcome: SKIPPED (no reviewable files)");
  else console.log("\nOutcome: pending (still at the gate)");
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});
