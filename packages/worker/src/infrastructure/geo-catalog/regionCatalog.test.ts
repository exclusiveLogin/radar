import assert from "node:assert/strict";
import test from "node:test";
import { RegionCatalog } from "./regionCatalog.js";
import { repoDataPath } from "../../shims/monorepo-root.js";

test("buildAliases: род. падеж «воронежской области»", () => {
  const catalogPath = repoDataPath("geo", "catalog", "regions.json");
  const rc = RegionCatalog.loadFromCatalogJson(catalogPath);
  const vor = rc.getByCode("RU-VOR");
  assert.ok(vor);
  assert.ok(vor!.aliases.includes("воронежской области"));

  const text =
    "Отбой беспилотной опасности по всем ранее объявленным регионам, в том числе и по Воронежской области";
  const found = rc.findRegionsInText(text);
  assert.ok(found.some((r) => r.code === "RU-VOR"));
});
