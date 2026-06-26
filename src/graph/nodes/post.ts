import type { StateType } from "../state";
import { getPublisher } from "../../services/publisher";

// Deterministic / IO node (FR-6). Only reached on approval. Posts the single
// summary comment through the PrPublisher interface (PAT-backed when a token is
// configured, mock otherwise).
export async function post(state: StateType): Promise<Partial<StateType>> {
  await getPublisher().postReview(state.pr, state.summaryBody);
  console.log("[post] review submitted");
  return {};
}
