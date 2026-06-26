import { StateGraph, START, END, type BaseCheckpointSaver } from "@langchain/langgraph";
import { State } from "./state";
import { ingest } from "./nodes/ingest";
import { review } from "./nodes/review";
import { aggregate } from "./nodes/aggregate";
import { humanGate } from "./nodes/humanGate";
import { post } from "./nodes/post";
import { routeAfterTriage, routeAfterGate } from "./routing";

// Graph wiring (plan §4). Three terminal paths: skipped (trivial diff),
// aborted (human said no), posted (success).
export function buildGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(State)
    .addNode("ingest", ingest)
    .addNode("review", review) // fan-out target
    .addNode("aggregate", aggregate)
    .addNode("humanGate", humanGate) // interrupt lives here
    .addNode("post", post)
    .addEdge(START, "ingest")
    .addConditionalEdges("ingest", routeAfterTriage, {
      review: "review", // routeAfterTriage returns Send[] for fan-out
      skip: END,
    })
    .addEdge("review", "aggregate") // fan-in; concat reducer merges branches
    .addEdge("aggregate", "humanGate")
    .addConditionalEdges("humanGate", routeAfterGate, {
      approve: "post",
      abort: END,
    })
    .addEdge("post", END)
    .compile({ checkpointer }); // REQUIRED — the interrupt needs it
}

export type App = ReturnType<typeof buildGraph>;
