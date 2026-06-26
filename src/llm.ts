import { z } from "zod";
import type { FileDiff, Finding, Usage } from "./types";
import { emptyUsage } from "./usage";

// The single LLM call site (plan §5). Set USE_LLM=true + OPENAI_API_KEY to use a
// real model; otherwise a deterministic stub keeps the whole graph runnable
// offline so the fan-out / interrupt / checkpoint plumbing can be exercised
// before spending tokens.

const FindingSchema = z.object({
  file: z.string(),
  severity: z.enum(["blocker", "major", "minor", "nit"]),
  category: z.enum([
    "bug",
    "security",
    "performance",
    "concurrency",
    "style",
    "maintainability",
    "test",
  ]),
  message: z.string(),
  line: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const ResponseSchema = z.object({
  findings: z.array(FindingSchema),
});

const SYSTEM_PROMPT = `You are a precise, senior code reviewer. You review ONE changed file's diff.
Report only real, actionable problems: bugs, security issues, performance/concurrency hazards,
and clear maintainability/test gaps. Prefer precision over recall — a noisy reviewer gets ignored.
Do NOT comment on formatting a linter would catch, and do NOT restate what the code does.
Return findings strictly matching the schema. If the file looks fine, return an empty list.`;

export interface ReviewResult {
  findings: Finding[];
  usage: Usage;
}

export async function reviewFile(file: FileDiff): Promise<ReviewResult> {
  if (process.env.USE_LLM === "true" && process.env.OPENAI_API_KEY) {
    return reviewWithOpenAI(file);
  }
  return stubReview(file);
}

async function reviewWithOpenAI(file: FileDiff): Promise<ReviewResult> {
  // Imported lazily so the stub path has no hard dependency at runtime.
  const { ChatOpenAI } = await import("@langchain/openai");
  const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0,
  });
  const structured = model.withStructuredOutput(ResponseSchema, { name: "report" });

  const userPrompt = [
    `Path: ${file.path}`,
    `Status: ${file.status} (+${file.additions} / -${file.deletions})`,
    "",
    "Unified diff:",
    "```diff",
    file.patch,
    "```",
    file.contents ? "\nSurrounding file content:\n```\n" + file.contents + "\n```" : "",
  ].join("\n");

  const res = await structured.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  // Normalize: force the model's `file` to the real path; drop anything malformed.
  const findings = res.findings.map((f) => ({ ...f, file: file.path }));
  // TODO: thread real token usage from response_metadata once we stop relying on
  // withStructuredOutput (which hides usage). Approximate for now.
  return { findings, usage: emptyUsage() };
}

// Deterministic offline reviewer: emits a finding when it spots a couple of cheap
// smells in the patch text, so the graph produces non-trivial output without a key.
function stubReview(file: FileDiff): Promise<ReviewResult> {
  const findings: Finding[] = [];
  const added = file.patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

  added.forEach((line) => {
    if (/\bconsole\.log\(/.test(line)) {
      findings.push({
        file: file.path,
        severity: "nit",
        category: "maintainability",
        message: "Leftover `console.log` — remove before merging.",
        confidence: 0.8,
      });
    }
    if (/==(?!=)/.test(line) && !/===/.test(line)) {
      findings.push({
        file: file.path,
        severity: "minor",
        category: "bug",
        message: "Loose equality (`==`) can coerce unexpectedly; prefer `===`.",
        confidence: 0.7,
      });
    }
    if (/\bany\b/.test(line) && file.path.endsWith(".ts")) {
      findings.push({
        file: file.path,
        severity: "minor",
        category: "maintainability",
        message: "`any` defeats type checking; use a precise type.",
        confidence: 0.55,
      });
    }
  });

  const usage: Usage = {
    promptTokens: 200,
    completionTokens: 40 * Math.max(findings.length, 1),
    totalTokens: 200 + 40 * Math.max(findings.length, 1),
    costUsd: 0,
  };
  return Promise.resolve({ findings, usage });
}
