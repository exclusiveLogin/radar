import { RegionGeometryCatalog } from "../packages/api/dist/map/region-geometry.catalog.js";

RegionGeometryCatalog.resetForTests();
const catalog = RegionGeometryCatalog.getInstance();
catalog.bindRegions([]);

const layer = catalog.buildLayer(
  new Map([
    ["RU-VOR", "yellow"],
    ["RU-SAR", "orange"],
  ]),
);
console.log("stats", catalog.debugStats());
console.log("active outlines", layer.features.length);
console.log(
  "voronezh",
  layer.features.find((f) => f.properties.regionCode === "RU-VOR")?.properties,
);
