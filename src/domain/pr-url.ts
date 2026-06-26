import type { PrRef } from "./types";

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;

/**
 * Parse owner/repo/number from a GitHub PR URL (FR-1). Throws with a clear
 * message on malformed input so the CLI can fail fast.
 */
export function parsePrUrl(raw: string): PrRef {
  const url = raw.trim();
  const m = url.match(PR_URL);
  if (!m) {
    throw new Error(
      `Not a GitHub PR URL: "${raw}". Expected https://github.com/<owner>/<repo>/pull/<number>`,
    );
  }
  const [, owner, repo, number] = m;
  return { owner, repo, number: Number(number) };
}

/** Stable PR identity string, e.g. "owner/repo#42". */
export function prId(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

/** Checkpointer thread_id = prId:sha (plan §10 keying). */
export function threadId(ref: PrRef, sha: string): string {
  return `${prId(ref)}:${sha}`;
}
