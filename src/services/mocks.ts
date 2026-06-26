import type { PrRef, PrMeta, FileDiff } from "../domain/types";

// Stand-ins for GitHub I/O (build step 1). Replaced by Octokit in step 2.
// Both are deterministic so the same URL yields the same sha -> same thread_id,
// which keeps the resume flow reproducible.

/** Mock of "GET pull request" — just the head sha, resolved before invoke. */
export function mockResolveHeadSha(ref: PrRef): string {
  let h = 0;
  for (const ch of `${ref.owner}/${ref.repo}/${ref.number}`) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return `mock${h.toString(16).padStart(8, "0")}`;
}

export function mockFetchPrMeta(ref: PrRef, sha: string): PrMeta {
  return {
    ...ref,
    sha,
    author: "octocat",
    title: `Mock PR #${ref.number}`,
  };
}

// A small fixture set that deliberately includes files triage should drop
// (a lockfile, a build artifact) alongside reviewable source with planted smells.
export function mockFetchFiles(): FileDiff[] {
  return [
    {
      path: "src/auth.ts",
      status: "modified",
      additions: 6,
      deletions: 1,
      patch: [
        "@@ -10,6 +10,11 @@ export function checkToken(input) {",
        "-  if (input != null) {",
        "+  if (input == null) {",
        "+    console.log('no token', input);",
        "+    return false;",
        "+  }",
        "+  const claims: any = decode(input);",
        "+  return claims.valid;",
        " }",
      ].join("\n"),
    },
    {
      path: "src/util/format.ts",
      status: "added",
      additions: 3,
      deletions: 0,
      patch: ["@@ -0,0 +1,3 @@", "+export const toUpper = (s: string) => s.toUpperCase();", "+", "+// no issues here"].join(
        "\n",
      ),
    },
    {
      path: "package-lock.json",
      status: "modified",
      additions: 412,
      deletions: 9,
      patch: "@@ -1,5 +1,5 @@\n-  lockfile noise\n+  lockfile noise",
    },
    {
      path: "dist/bundle.min.js",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "@@ -1 +1 @@\n-minified\n+minified",
    },
  ];
}
