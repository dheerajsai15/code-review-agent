// Token pricing. OpenAI has no pricing API, so we resolve a model's per-token
// cost from (in priority order):
//   1. an explicit env override  — works for ANY model, even brand-new ones
//      (OPENAI_INPUT_COST_PER_1M / OPENAI_OUTPUT_COST_PER_1M, USD per 1M tokens)
//   2. LiteLLM's community-maintained price table, fetched once and cached
//   3. zero — tokens are still reported, cost just shows as $0
//
// This keeps prices out of the source: a new model is handled either because
// the community table already lists it, or via the env override.

const PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

interface ModelPrice {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
}

/** Per-token (not per-million) USD costs. */
export interface TokenPrice {
  input: number;
  output: number;
}

// Fetched once per process. All parallel review branches await the same promise,
// so the table is downloaded a single time even under fan-out.
let tablePromise: Promise<Record<string, ModelPrice>> | null = null;

function loadTable(): Promise<Record<string, ModelPrice>> {
  // Assign the promise synchronously (without awaiting) so concurrent callers
  // share the one in-flight fetch — see note on `tablePromise` above.
  if (!tablePromise) {
    tablePromise = fetchTable();
  }
  return tablePromise;
}

async function fetchTable(): Promise<Record<string, ModelPrice>> {
  try {
    const res = await fetch(PRICING_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, ModelPrice>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pricing] live price table unavailable (${msg}); cost will show as $0`);
    return {};
  }
}

function envOverride(): TokenPrice | null {
  const input = process.env.OPENAI_INPUT_COST_PER_1M;
  const output = process.env.OPENAI_OUTPUT_COST_PER_1M;
  if (input && output) {
    return { input: Number(input) / 1e6, output: Number(output) / 1e6 };
  }
  return null;
}

export async function getModelPrice(model: string): Promise<TokenPrice> {
  const override = envOverride();
  if (override) return override;

  const table = await loadTable();
  const entry = table[model];
  return {
    input: entry?.input_cost_per_token ?? 0,
    output: entry?.output_cost_per_token ?? 0,
  };
}
