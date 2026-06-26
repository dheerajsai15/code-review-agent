import type { StateType } from "../state";
import { useRealGitHub, fetchChangedFiles } from "../../services/github";
import { mockFetchFiles } from "../../services/mocks";

// Deterministic / IO node (FR-3). The CLI already resolved full PR metadata into
// state.pr (and used it to build the thread_id), so ingest only fetches the
// changed files — real GitHub when a token is configured, otherwise the mock.
export async function ingest(state: StateType): Promise<Partial<StateType>> {
  const pr = state.pr; // full metadata, seeded by the CLI
  const files = useRealGitHub() ? await fetchChangedFiles(pr) : mockFetchFiles();

  const tag = useRealGitHub() ? "" : " (mock)";
  console.log(`[ingest]${tag} ${pr.owner}/${pr.repo}#${pr.number} @ ${pr.sha} — ${files.length} changed file(s)`);
  return { files };
}
