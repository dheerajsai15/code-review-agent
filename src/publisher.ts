import type { PrRef } from "./types";
import { getOctokit, useRealGitHub } from "./github";

// All GitHub writes go through this interface (FR-2 / plan §3) so swapping
// PAT -> GitHub App later is a localized change.
export interface PrPublisher {
  postReview(prRef: PrRef, body: string): Promise<void>;
}

// PAT-backed publisher (Octokit). Posts ONE summary comment as a PR review with
// event COMMENT — attributed to the authenticated user (FR-6). Swap to a
// GitHubAppPrPublisher later without touching the `post` node.
export class PatPrPublisher implements PrPublisher {
  async postReview(prRef: PrRef, body: string): Promise<void> {
    await getOctokit().pulls.createReview({
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.number,
      body,
      event: "COMMENT",
    });
  }
}

// Offline stand-in: prints instead of writing to GitHub.
export class MockPrPublisher implements PrPublisher {
  async postReview(prRef: PrRef, body: string): Promise<void> {
    console.log("\n=== [MOCK] would post review comment ===");
    console.log(`PR: ${prRef.owner}/${prRef.repo}#${prRef.number}`);
    console.log("--- body ---");
    console.log(body);
    console.log("=== [MOCK] end ===\n");
  }
}

export function getPublisher(): PrPublisher {
  return useRealGitHub() ? new PatPrPublisher() : new MockPrPublisher();
}
