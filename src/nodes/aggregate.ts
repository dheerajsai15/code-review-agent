import type { StateType } from "../state";
import type { Finding, Severity } from "../types";

// Deterministic node (plan §4). No LLM: drop low-confidence noise, rank by
// severity, group by file, and render the single summary markdown body (FR-4).

const MIN_CONFIDENCE = 0.5; // precision-over-recall: drop low-confidence items

const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  nit: 3,
};

export async function aggregate(state: StateType): Promise<Partial<StateType>> {
  const kept = (state.fileReviews ?? []).filter(
    (f) => (f.confidence ?? 1) >= MIN_CONFIDENCE,
  );

  kept.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.file.localeCompare(b.file),
  );

  const summaryBody = renderSummary(kept, state);
  console.log(`[aggregate] ${kept.length} finding(s) survived filtering`);
  return { comments: kept, summaryBody };
}

function renderSummary(findings: Finding[], state: StateType): string {
  const header = `## PR Review\n\n_Automated review of ${state.files?.length ?? 0} changed file(s)._`;

  if (findings.length === 0) {
    return `${header}\n\nNo issues found above the confidence threshold.`;
  }

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = byFile.get(f.file);
    if (bucket) bucket.push(f);
    else byFile.set(f.file, [f]);
  }

  const sections: string[] = [];
  for (const [file, items] of [...byFile.entries()].sort()) {
    const lines = items.map((f) => {
      const conf = f.confidence !== undefined ? ` _(confidence ${f.confidence.toFixed(2)})_` : "";
      return `- **[${f.severity.toUpperCase()} · ${f.category}]** ${f.message}${conf}`;
    });
    sections.push(`### \`${file}\`\n${lines.join("\n")}`);
  }

  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const summaryLine = (["blocker", "major", "minor", "nit"] as Severity[])
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");

  return `${header}\n\n**${findings.length} finding(s):** ${summaryLine}\n\n${sections.join("\n\n")}`;
}
