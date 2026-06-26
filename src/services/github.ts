import { Octokit } from "@octokit/rest";
import type { PrRef, PrMeta, FileDiff } from "../domain/types";

// All GitHub reads (ingest) live here. Writes go through PrPublisher (publisher.ts),
// which uses getOctokit() from this module. Real GitHub is used when GITHUB_TOKEN
// is set and USE_GITHUB isn't explicitly "false"; otherwise the mocks run so the
// graph still works offline.
export function useRealGitHub(): boolean {
  return !!process.env.GITHUB_TOKEN && process.env.USE_GITHUB !== "false";
}

let octokit: Octokit | undefined;

export function getOctokit(): Octokit {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set (fine-grained PAT with `pull requests: write`).");
  }
  if (!octokit) octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  return octokit;
}

// Used by the CLI before invoke: resolves full PR metadata (incl. head sha for
// the thread_id) and validates access early (FR-1/FR-2). Seeding this into state
// lets ingest skip its own meta fetch — one `pulls.get`, not two.
export async function fetchPrMeta(ref: PrRef): Promise<PrMeta> {
  try {
    const { data } = await getOctokit().pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });
    return {
      ...ref,
      sha: data.head.sha,
      author: data.user?.login ?? "unknown",
      title: data.title,
    };
  } catch (err) {
    throw clarify(ref, err);
  }
}

export async function fetchChangedFiles(ref: PrRef): Promise<FileDiff[]> {
  try {
    const files = await getOctokit().paginate(getOctokit().pulls.listFiles, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: 100,
    });
    // `patch` is the unified diff hunk(s), already including a few context lines —
    // that's the v1 per-file context (plan §3). Wider surrounding content is a
    // later quality lever. Binary files come back with no `patch` (triage drops them).
    return files.map((f) => ({
      path: f.filename,
      status: f.status,
      patch: f.patch ?? "",
      contents: undefined,
      additions: f.additions,
      deletions: f.deletions,
    }));
  } catch (err) {
    throw clarify(ref, err);
  }
}

function clarify(ref: PrRef, err: unknown): Error {
  const status = (err as { status?: number }).status;
  const where = `${ref.owner}/${ref.repo}#${ref.number}`;
  if (status === 404) {
    return new Error(`PR ${where} not found, or the token can't see it (check repo scope).`);
  }
  if (status === 401 || status === 403) {
    return new Error(`Not authorized for ${where} — check GITHUB_TOKEN and its permissions.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
