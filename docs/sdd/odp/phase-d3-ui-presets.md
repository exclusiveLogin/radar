# SDD: ODP — Фаза D3 — UI presets из ODP

Статус: **ready for implementation**  
ADR: [014](../../adr-014-operational-domain-profile.md)

**Критерий входа:** D2 `GET /map/domain-profile/active` + `GET /map/status-dictionary`.

---

## 1. Scope / Out of scope

### In scope

- Web загружает active profile + dictionary at map init
- `MapHeatmapControls` строит кнопки из `uiPresets` + dictionary titles
- Удалить hardcode `EVENT_HEATMAP_FILTER_TYPES` из UI path (deprecated re-export v1)
- Filter `status_dictionary` by `activeEventTypes` from profile

### Out of scope

- Deck.gl / tracking layers
- Admin editor presets
- z.enum removal (D4)

---

## 2. Архитектура

```text
Map init:
  mapApi.domainProfileActive()
  mapApi.statusDictionary({ domainProfileId })
  → heatmapStore.hydrateFromOdp(preset, dictionary)

User toggle:
  heatmapStore → resolveEventTypesQuery() → GET /map/events/heatmap
```

Preset default: `heatmap_operational` from manifest.

---

## 3. Web changes

| File | Change |
|------|--------|
| `packages/web/src/shared/api/mapApi.ts` | `domainProfileActive()` |
| `packages/web/src/shared/state/heatmapStore.ts` | dynamic types Set |
| `packages/web/src/widgets/map-heatmap/MapHeatmapControls.tsx` | render from store |
| `packages/web/src/widgets/geo-map/useGeoMapLifecycle.ts` | fetch profile on init |

---

## 4. API (optional extend)

`GET /map/status-dictionary?domainProfile=uav_osint_ru_v1` — filter codes.

---

## 5. Backward compatibility

- No preset loaded → fallback current `EVENT_HEATMAP_FILTER_TYPES` (one release)
- Feature flag `VITE_ODP_UI_PRESETS=1`

---

## 6. DoD checklist

- [ ] Heatmap buttons match manifest preset
- [ ] Titles from dictionary, not hardcoded labels
- [ ] Without API profile → legacy behavior
- [ ] typecheck web green

---

## 7. Коммит

Single commit: web ODP heatmap integration.
