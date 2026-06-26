import type { FileDiff } from "./types";

// Deterministic triage heuristics (plan §4 "triage"). No LLM. These are the
// rules the router applies to decide which files are worth an LLM review.
// Refine the exact lists/caps as needed (plan §9).

const SKIP_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Cargo.lock",
  "poetry.lock",
  "Gemfile.lock",
  "go.sum",
]);

const SKIP_PATH_SEGMENTS = ["/dist/", "/build/", "/vendor/", "/node_modules/", "/.next/"];

const SKIP_EXTENSIONS = [
  ".min.js",
  ".min.css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".pdf",
  ".lock",
  ".snap",
];

// Skip very large diffs — they blow the context budget and rarely review well.
const MAX_CHANGED_LINES = 1500;

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function isReviewable(file: FileDiff): boolean {
  if (file.status === "removed") return false; // nothing to review in a deletion
  if (!file.patch || file.patch.trim() === "") return false; // binary / no diff

  const name = basename(file.path);
  if (SKIP_FILENAMES.has(name)) return false;

  const lowerPath = `/${file.path.toLowerCase()}`;
  if (SKIP_PATH_SEGMENTS.some((seg) => lowerPath.includes(seg))) return false;
  if (SKIP_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) return false;

  if (file.additions + file.deletions > MAX_CHANGED_LINES) return false;

  return true;
}
