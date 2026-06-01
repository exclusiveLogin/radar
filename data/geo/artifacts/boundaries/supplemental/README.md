# Supplemental region outlines

- `front-regions.geojson` — ДНР/ЛНР/Запорожье/Херсон (`RU-DON`, `RU-LUG`, `RU-ZP`, `RU-KHE`), не входят в OSM `Russia_regions.geojson`.
- Пересборка: `npm run geo:front-regions:build` (скачивает `ukrainian_geodata/regiony.geojson`).

Крым и Севастополь — в `Russia_regions.geojson`; ISO `RU-CR` / `RU-SEV` задаются в `regions.json` и `FIXED_LABEL_ISO` в `region-geometry.catalog.ts`.
