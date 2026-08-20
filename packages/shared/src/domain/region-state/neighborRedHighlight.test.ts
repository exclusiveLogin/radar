import assert from "node:assert/strict";
import test from "node:test";
import type { StateLevel } from "../../schemas/geo/state-level";
import { resolveNeighborRedHighlights } from "./neighborRedHighlight";

const adjacency = {
  "RU-VOR": ["RU-BEL", "RU-LIP", "RU-ROS"],
  "RU-BEL": ["RU-VOR", "RU-KRS"],
  "RU-KRS": ["RU-BEL"],
};

function selfLevels(entries: Record<string, StateLevel>): Map<string, StateLevel> {
  return new Map(Object.entries(entries));
}

test("сосед красного региона без своих фактов получает подсветку", () => {
  const highlights = resolveNeighborRedHighlights(
    selfLevels({ "RU-VOR": "red" }),
    adjacency,
  );

  assert.equal(highlights.get("RU-BEL"), "RU-VOR");
  assert.equal(highlights.has("RU-KRS"), false, "сосед соседа не подсвечивается");
});

test("собственный статус приоритетнее подсветки — включая отбой", () => {
  const highlights = resolveNeighborRedHighlights(
    selfLevels({ "RU-VOR": "red", "RU-BEL": "green" }),
    adjacency,
  );

  assert.equal(highlights.size, 0);
});

test("без красных регионов подсветки нет", () => {
  const highlights = resolveNeighborRedHighlights(
    selfLevels({ "RU-VOR": "yellow" }),
    adjacency,
  );

  assert.equal(highlights.size, 0);
});
