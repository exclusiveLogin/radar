# Operational Domain Packs

Конфигурация домена (БПЛА OSINT и др.) **вне кода**. SSOT: [docs/adr-014-operational-domain-profile.md](../docs/adr-014-operational-domain-profile.md).

> ⚠️ **Статус:** только **черновики-примеры** для планирования (ADR-014 D0).  
> Worker / API / web **ничего отсюда не загружают**. Parse по-прежнему из `extractEventType.ts`.

## Структура (целевая, после D2)

```text
data/domains/
  uav_osint_ru_v1/
    profile.manifest.json       # runtime (появится в D2)
    profile.manifest.example.json  # ← сейчас: иллюстрация формата
    parser-rules.v1.yaml        # ещё не создан (D1)
    geo-grooming.v1.yaml        # ещё не создан (D1)
```

## Default deployment (будущее)

См. режимы A–D в [ADR-014 § где живёт ODP](../docs/adr-014-operational-domain-profile.md#где-живёт-odp-bundled-vs-on-premise).

```env
OPERATIONAL_DOMAIN_PROFILE_ID=uav_osint_ru_v1
DOMAIN_PACKS_PATH=data/domains          # bundled
# DOMAIN_PACKS_PATH=/opt/radar/domains  # on-prem mount
```

## Статус реализации

| Файл | Есть в репо | Используется кодом |
|----------|-------------|-------------------|
| `profile.manifest.example.json` | ✅ | ❌ |
| `parser-rules.v1.yaml` | ❌ | ❌ |
| `geo-grooming.v1.yaml` | ❌ | ❌ |
| loader / CLI / API | ❌ | ❌ |

Пошаговое описание: [docs/rfc/operational-domain-profile-walkthrough.md](../docs/rfc/operational-domain-profile-walkthrough.md).  
Карта «файл кода → куда переезжает»: [walkthrough §13](../docs/rfc/operational-domain-profile-walkthrough.md#13-карта-миграции-файл-кода--куда-переезжает).
