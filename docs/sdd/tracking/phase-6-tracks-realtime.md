# Phase 6 — Tracks Realtime (WS poller)

## Цель

После батча rebuild worker обновляет `tracking_pipeline_state.updated_at`. API поллер (~2s) эмитит `tracks-updated` на WS `/ws`; web refetch `tracksList` в live-режиме.

## Поток

```text
worker advanceWatermark → updated_at
API TracksRealtimePoller → tracks-updated { at }
MapGateway channel "tracks"
web tracksRevision$ → trackStoreEffects (debounce 1.5s, asOf=null)
```

## Контракт

`packages/shared/src/schemas/realtime/ws.ts`:

- канал `"tracks"`
- `{ type: "tracks-updated", payload: { at: ISO8601 } }`

## Файлы

| Слой | Файл |
|------|------|
| shared | `schemas/realtime/ws.ts` |
| api | `map/tracks-realtime.poller.ts`, `map.gateway.ts` |
| web | `mapStore.ts`, `trackStoreEffects.ts`, `trackStore.ts` |

## Критерии

- После rebuild карта обновляет треки без ручного refresh (слой tracks включён, live).
