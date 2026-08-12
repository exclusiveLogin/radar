import assert from "node:assert/strict";
import test from "node:test";
import { layoutPipelineColumns, shortRoutingKey } from "./pipelineMapLayout.ts";

test("shortRoutingKey strips radar. prefix", () => {
  assert.equal(shortRoutingKey("radar.message.parsed"), "message.parsed");
  assert.equal(shortRoutingKey("radar.parse.stabilized"), "parse.stabilized");
  assert.equal(shortRoutingKey("custom.key"), "custom.key");
});

test("layoutPipelineColumns: ingest → parse → tracking; geo parallel at rank 0", () => {
  const nodes = [
    { id: "ingest-live" },
    { id: "ingest-backfill" },
    { id: "parse" },
    { id: "geo-enrich" },
    { id: "tracking" },
  ];
  const edges = [
    { fromStepId: "ingest-live", toStepId: "parse", key: "radar.raw.ingested" },
    {
      fromStepId: "ingest-backfill",
      toStepId: "parse",
      key: "radar.raw.ingested",
    },
    {
      fromStepId: "ingest-backfill",
      toStepId: "parse",
      key: "radar.channel.backfill.completed",
    },
    { fromStepId: "parse", toStepId: "tracking", key: "radar.message.parsed" },
    {
      fromStepId: "parse",
      toStepId: "tracking",
      key: "radar.parse.stabilized",
    },
  ];

  const layout = layoutPipelineColumns(nodes, edges);
  assert.deepEqual(
    layout.columns.map((c) => ({
      rank: c.rank,
      ids: c.nodes.map((n) => n.id),
    })),
    [
      {
        rank: 0,
        ids: ["geo-enrich", "ingest-backfill", "ingest-live"],
      },
      { rank: 1, ids: ["parse"] },
      { rank: 2, ids: ["tracking"] },
    ],
  );
  assert.equal(layout.edges.length, 5);
  assert.equal(
    layout.edges.some((e) => e.fromStepId === "geo-enrich"),
    false,
  );
});

test("layoutPipelineColumns: ignores edges to missing nodes", () => {
  const layout = layoutPipelineColumns(
    [{ id: "a" }, { id: "b" }],
    [
      { fromStepId: "a", toStepId: "b", key: "k1" },
      { fromStepId: "a", toStepId: "ghost", key: "k2" },
    ],
  );
  assert.equal(layout.edges.length, 1);
  assert.deepEqual(layout.columns.map((c) => c.nodes.map((n) => n.id)), [
    ["a"],
    ["b"],
  ]);
});
