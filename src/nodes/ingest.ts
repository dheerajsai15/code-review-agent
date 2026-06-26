import type { StateType } from "../state";
import { useRealGitHub, fetchPrMeta, fetchChangedFiles } from "../github";
import { mockFetchPrMeta, mockFetchFiles } from "../mock-data";

// Deterministic / IO node (FR-1 / FR-3). Fetches PR metadata + changed files.
// Real GitHub (Octokit) when a token is configured; otherwise the offline mock
// so the graph still runs. The CLI has already resolved the head sha into
// state.pr (used for the thread_id).
export async function ingest(state: StateType): Promise<Partial<StateType>> {
  const ref = state.pr; // {owner, repo, number, sha}

  if (useRealGitHub()) {
    const pr = await fetchPrMeta(ref);
    const files = await fetchChangedFiles(ref);
    console.log(`[ingest] ${pr.owner}/${pr.repo}#${pr.number} @ ${pr.sha} — ${files.length} changed file(s)`);
    return { pr, files };
  }

  const pr = mockFetchPrMeta(ref, ref.sha);
  const files = mockFetchFiles();
  console.log(`[ingest] (mock) ${pr.owner}/${pr.repo}#${pr.number} — ${files.length} changed file(s)`);
  return { pr, files };
}
