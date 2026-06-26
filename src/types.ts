// Shared data contracts. The `Finding` shape (plan §6) is consumed by `aggregate`
// and will later be scored by an eval harness, so it's kept stable.

export type Severity = "blocker" | "major" | "minor" | "nit";

export type Category =
  | "bug"
  | "security"
  | "performance"
  | "concurrency"
  | "style"
  | "maintainability"
  | "test";

export interface Finding {
  file: string; // path, relative to repo root
  severity: Severity;
  category: Category;
  message: string; // what's wrong + why; actionable
  line?: number; // optional; unused in MVP (summary comment only)
  confidence?: number; // 0..1, used by aggregate to filter noise
}

/** Minimal PR identity, parseable from a URL before any fetch. */
export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Full PR metadata after ingest. */
export interface PrMeta extends PrRef {
  sha: string; // head commit; part of the checkpointer thread_id
  author: string;
  title: string;
}

/** One changed file's review payload. */
export interface FileDiff {
  path: string;
  status: string; // added | modified | removed | renamed
  patch: string; // unified diff hunk(s)
  contents?: string; // surrounding file content at head sha (context lever)
  additions: number;
  deletions: number;
}

/** Token + cost accounting, accumulated across parallel review branches. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}
