import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

// The interrupt requires a checkpointer. Postgres (Docker) is the durable choice
// — it lets an abandoned run be resumed from a separate process. If DATABASE_URL
// is unset we fall back to an in-memory saver so the graph still runs, but
// cross-process `resume` won't work (state lives only in that process).

let pool: pg.Pool | undefined;

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[checkpointer] DATABASE_URL unset — using in-memory saver (no durable resume)");
    return new MemorySaver();
  }

  pool = new pg.Pool({ connectionString: url });
  const saver = new PostgresSaver(pool);
  await saver.setup(); // idempotent: CREATE TABLE IF NOT EXISTS ...
  return saver;
}

/** Close the shared pool so the CLI process can exit cleanly. */
export async function closeCheckpointer(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
