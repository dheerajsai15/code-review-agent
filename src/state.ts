import { Annotation } from "@langchain/langgraph";
import type { PrMeta, FileDiff, Finding, Usage } from "./types";
import { emptyUsage, sumUsage } from "./usage";

// The shared state object — the spine of the graph (plan §4).
export const State = Annotation.Root({
  pr: Annotation<PrMeta>(), // owner, repo, number, sha, author
  files: Annotation<FileDiff[]>(), // changed files after ingest

  // N parallel review branches write here. The reducer is LOAD-BEARING: the
  // default channel behavior is last-write-wins, which would silently keep
  // only one file's findings and drop the rest. concat merges all branches.
  fileReviews: Annotation<Finding[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),

  comments: Annotation<Finding[]>(), // aggregated + ranked (final set)
  summaryBody: Annotation<string>(), // rendered markdown comment body
  approved: Annotation<boolean>(), // set by the human gate

  usage: Annotation<Usage>({
    reducer: sumUsage,
    default: emptyUsage,
  }),
});

export type StateType = typeof State.State;
