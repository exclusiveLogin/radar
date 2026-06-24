# ODP — SDD (Operational Domain Profile)

Статус: **ready for implementation** (2026-06-14)  
База: [ADR-014](../../adr-014-operational-domain-profile.md), [walkthrough](../../rfc/operational-domain-profile-walkthrough.md) · Индекс SDD: [../README.md](../README.md)

---

## Индекс фаз

| Фаза | SDD | Критерий входа | Коммиты |
|------|-----|----------------|---------|
| **D0** | — (docs ✅) | — | — |
| **D1** | [phase-d1-parser-rules-pack.md](./phase-d1-parser-rules-pack.md) | ADR-014 принят | 2 |
| **D2** | [phase-d2-bootstrap-api.md](./phase-d2-bootstrap-api.md) | D1 loader работает | 2 |
| **D3** | [phase-d3-ui-presets.md](./phase-d3-ui-presets.md) | D2 API active profile | 1–2 |
| **D4** | [phase-d4-event-type-dictionary.md](./phase-d4-event-type-dictionary.md) | D3 UI на presets | 2 |
| **D5** | [phase-d5-threat-profile-rules.md](./phase-d5-threat-profile-rules.md) | Tracking T1 или parallel | 1 |
| **D6** | [phase-d6-api-read-decoupling.md](./phase-d6-api-read-decoupling.md) | D4 dictionary validate | 2–3 |

Порядок: **D1 параллельно Tracking T1** → D2–D3 → D4 → D5 → **D6** (read API).

---

## Env (сквозные)

| Key | Default |
|-----|---------|
| `OPERATIONAL_DOMAIN_PROFILE_ID` | `uav_osint_ru_v1` |
| `DOMAIN_PACKS_PATH` | `data/domains` |
| `DOMAIN_PACK_SOURCE` | `file` |

**Basemap pack (D2+):** поле `geoBasemapPackId` в profile pack ссылается на контракт [`data/geo/tiles.manifest.json`](../../../data/geo/tiles.manifest.json) — см. [map-tiles-selfhost.md](../../map-tiles-selfhost.md).

---

## Data layout

```text
data/domains/uav_osint_ru_v1/
  profile.manifest.json          # runtime (после D2)
  profile.manifest.example.json  # черновик (сейчас)
  parser-rules.v1.yaml           # D1
  geo-grooming.v1.yaml           # D1
```

---

## Связи

| ODP | Другой поток |
|-----|--------------|
| D1 parser-rules | Parse P1 EventTypeProcessor |
| D3 uiPresets | Tracking T1 heatmap filter |
| D5 threatProfileRules | Tracking T1 `resolveThreatProfile` |

| D6 API read decouple | Generic `/map/event-feed`, no SQL literals |

Порядок: **D1 параллельно Tracking T1** → D2–D3 → D4 → D5 → D6.

---

## Карта миграции кода

[walkthrough §13](../../rfc/operational-domain-profile-walkthrough.md#13-карта-миграции-файл-кода--куда-переезжает)
