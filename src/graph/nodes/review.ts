import type { StateType } from "../state";
import type { FileDiff } from "../../domain/types";
import { reviewFile } from "../../services/llm";

// The only LLM node (plan §4). Spawned once per file via `Send`, so it receives
// a single file's payload — NOT the whole state.files list. Its return targets
// channels with reducers (fileReviews=concat, usage=sum), which is how the
// parallel branches merge on fan-in.
export async function review(payload: { file: FileDiff }): Promise<Partial<StateType>> {
  const { file } = payload;
  try {
    const { findings, usage } = await reviewFile(file);
    console.log(`[review] ${file.path} — ${findings.length} finding(s)`);
    return { fileReviews: findings, usage };
  } catch (err) {
    // Resilience at the fan-in barrier: aggregate waits for ALL review branches,
    // so one file's failure (LLM/network error, or a schema-validation throw)
    // must not crash the superstep. Log it and contribute zero findings; the
    // other branches and the rest of the run continue unaffected.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[review] ${file.path} — skipped (error: ${msg})`);
    return { fileReviews: [] };
  }
}
