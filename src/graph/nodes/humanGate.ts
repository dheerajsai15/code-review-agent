import { interrupt } from "@langchain/langgraph";
import type { StateType } from "../state";

// Control node (FR-5). The interrupt checkpoints state and halts the run until a
// human resumes with "approve" or "abort". This is why a checkpointer is
// mandatory — and why durable (Postgres) checkpointing lets an abandoned run be
// resumed from a separate process.
export function humanGate(state: StateType): Partial<StateType> {
  const decision = interrupt({
    summaryBody: state.summaryBody,
    comments: state.comments,
  });
  return { approved: decision === "approve" };
}
