import assert from "node:assert/strict";
import test from "node:test";
import { RegionCatalog } from "../../infrastructure/geo-catalog/regionCatalog.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { repoDataPath } from "../../shims/monorepo-root.js";
import { extractPvoStats } from "./extractPvoStats.js";

// Загружаем реальный каталог регионов из репозитория.
function loadCatalog(): RegionCatalog {
  const catalogPath = path.join(repoDataPath(), "geo", "catalog", "regions.json");
  if (fs.existsSync(catalogPath)) {
    return RegionCatalog.loadFromCatalogJson(catalogPath);
  }
  // Если артефакты не скачаны — пустой каталог (тест пропустит проверки регионов).
  return RegionCatalog.empty();
}

const catalog = loadCatalog();

// --- Шаблон А: итог за период, список регионов без разбивки ---

test("extractPvoStats: totals.drones из шаблона А", () => {
  const input = "С 14:00 до 20:00 силами ПВО уничтожено 106 БПЛА над территориями Белгородской, Брянской областей";
  const stats = extractPvoStats(input, catalog);
  assert.equal(stats.totals.drones, 106);
  assert.equal(stats.totals.rockets, undefined);
  assert.equal(stats.totals.balloons, undefined);
});

test("extractPvoStats: period из шаблона А", () => {
  const input = "С 14:00 до 20:00 уничтожено 106 БПЛА";
  const stats = extractPvoStats(input, catalog);
  assert.ok(stats.period?.includes("14:00"), `period=${stats.period}`);
});

test("extractPvoStats: period «за прошедшую ночь»", () => {
  const input = "За прошедшую ночь и утро уничтожено 45 БПЛА";
  const stats = extractPvoStats(input, catalog);
  assert.ok(stats.period?.toLowerCase().includes("прошедш"), `period=${stats.period}`);
});

test("extractPvoStats: totals.rockets", () => {
  // БПЛА-счётчик требует «уничтожено N бпла» — порядок важен.
  const input = "Уничтожено 12 БПЛА. Также перехвачено 3 ракеты.";
  const stats = extractPvoStats(input, catalog);
  assert.equal(stats.totals.drones, 12);
  assert.equal(stats.totals.rockets, 3);
});

test("extractPvoStats: totals.balloons (МВШ)", () => {
  const input = "Перехвачены и уничтожены 2 МВШ над Саратовской областью";
  const stats = extractPvoStats(input, catalog);
  assert.equal(stats.totals.balloons, 2);
});

// --- Шаблон Б: счётчики по отдельным регионам ---

test("extractPvoStats: byRegion из шаблона Б", () => {
  const input =
    "За ночь ПВО работало. " +
    "Над Ленинградской областью уничтожено 59 БПЛА. " +
    "Над Смоленской областью уничтожено 31 БПЛА.";
  const stats = extractPvoStats(input, catalog);
  if (catalog.list().length === 0) return; // артефакты не загружены

  assert.ok(Array.isArray(stats.byRegion));
  assert.equal(stats.byRegion!.length, 2);
  const leningrad = stats.byRegion!.find((r) => r.code === "RU-LEN");
  assert.ok(leningrad, "RU-LEN не найден в byRegion");
  assert.equal(leningrad!.drones, 59);
});

// --- Регионы в regions ---

test("extractPvoStats: regions список при наличии каталога", () => {
  const input = "уничтожено 106 БПЛА над территориями Белгородской, Брянской, Курской областей";
  const stats = extractPvoStats(input, catalog);
  if (catalog.list().length === 0) return;

  const codes = stats.regions.map((r) => r.code);
  assert.ok(codes.includes("RU-BEL"), `RU-BEL не найден: ${JSON.stringify(codes)}`);
  assert.ok(codes.includes("RU-BRY"), `RU-BRY не найден: ${JSON.stringify(codes)}`);
  assert.ok(codes.includes("RU-KRS"), `RU-KRS не найден: ${JSON.stringify(codes)}`);
});

// --- Реальные тексты с «единицы» между числом и БПЛА ---

test("extractPvoStats: «уничтожено 334 единицы БПЛА» — totals.drones", () => {
  const input =
    "В течение прошедшей ночи силами противовоздушной обороны было уничтожено 334 единицы БПЛА над регионами России.";
  const stats = extractPvoStats(input, RegionCatalog.empty());
  assert.equal(stats.totals.drones, 334);
  assert.ok(stats.period?.toLowerCase().includes("прошедш"), `period=${stats.period}`);
});

test("extractPvoStats: «С 1 по 5 мая ... 2353 единицы БПЛА» — period + totals", () => {
  const input =
    "С 1 по 5 мая силами противовоздушной обороны было уничтожено 2353 единицы БПЛА над регионами России.";
  const stats = extractPvoStats(input, RegionCatalog.empty());
  assert.equal(stats.totals.drones, 2353);
  assert.ok(stats.period?.includes("1"), `period=${stats.period}`);
});

// --- Пустой каталог: не падает ---

test("extractPvoStats: не падает с пустым каталогом", () => {
  const input = "Уничтожено 5 БПЛА";
  const stats = extractPvoStats(input, RegionCatalog.empty());
  assert.equal(stats.totals.drones, 5);
  assert.deepEqual(stats.regions, []);
  assert.equal(stats.byRegion, undefined);
});
