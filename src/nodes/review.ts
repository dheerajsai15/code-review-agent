import type { StateType } from "../state";
import type { FileDiff } from "../types";
import { reviewFile } from "../llm";

// The only LLM node (plan §4). Spawned once per file via `Send`, so it receives
// a single file's payload — NOT the whole state.files list. Its return targets
// channels with reducers (fileReviews=concat, usage=sum), which is how the
// parallel branches merge on fan-in.
export async function review(payload: { file: FileDiff }): Promise<Partial<StateType>> {
  const { findings, usage } = await reviewFile(payload.file);
  console.log(`[review] ${payload.file.path} — ${findings.length} finding(s)`);
  return { fileReviews: findings, usage };
}
