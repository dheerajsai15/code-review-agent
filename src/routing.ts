import { Send } from "@langchain/langgraph";
import type { StateType } from "./state";
import { isReviewable } from "./triage";

// Conditional-edge router after ingest. Triage runs here (deterministic, no LLM):
// filter out unreviewable files, then fan out one `review` branch per survivor
// via `Send`. Returning Send[] is what spawns the parallel review nodes — there
// is no static edge-per-file. If nothing survives, route to "skip" (-> END).
export function routeAfterTriage(state: StateType): "skip" | Send[] {
  const reviewable = (state.files ?? []).filter(isReviewable);
  const skipped = (state.files?.length ?? 0) - reviewable.length;
  if (skipped > 0) console.log(`[triage] skipped ${skipped} file(s); reviewing ${reviewable.length}`);

  if (reviewable.length === 0) return "skip";
  return reviewable.map((file) => new Send("review", { file }));
}

// Conditional-edge router after the human gate.
export function routeAfterGate(state: StateType): "approve" | "abort" {
  return state.approved ? "approve" : "abort";
}
