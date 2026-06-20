# Parse inspect — agent debug tooling

SSOT для отладки raw → parse artifacts. **Интерпретацию делает агент**, не CI gate.

## Когда какой CLI

| CLI | Назначение | Выход |
|-----|------------|-------|
| `parse:snap` | быстрый JSON one-off | stdout |
| `parse:inspect` | **agent debug** | `--out` dir (md+json) |
| `parse:report` | batch quality | `--outdir` json/yaml/csv |

## Команды (PowerShell, корень репо)

```powershell
# Текст из файла → артефакты для агента
npm run worker:parse:inspect -- packages/shared/src/domain/parse/__fixtures__/gf-p6-07-tuapse-vicinity-oneline.txt --out=packages/worker/tmp/inspect-tuapse --storage-mode=db

# Inline текст
npm run radar -- parse inspect -- --text="Туапсе Опасность" --out=packages/worker/tmp/inspect-inline --storage-mode=db

# Через radar (alias)
npm run radar -- parse inspect -- tests/snap_001.txt --out=packages/worker/tmp/inspect-snap
```

## Флаги

| Флаг | Default | Описание |
|------|---------|----------|
| `--text=` | — | inline текст (альтернатива файлу) |
| `--out=` | stdout JSON | каталог артефактов |
| `--storage-mode=` | **db** | `db` = prod catalog; `memory` = пустой catalog |
| `--full-json` | off | пишет `full.json` в `--out` |

## Структура `--out`

| Файл | Содержимое |
|------|------------|
| `00-input.txt` | исходный текст |
| `01-groom.json` | groomedText + blocks |
| `03-geo-hits.json` | region/place hits из index |
| `04-candidates.json` | candidates |
| `05-traits.json` | traitAttachments |
| `07-locations.json` | locations preview |
| `08-summary.md` | короткий trace для агента |

## Skill

Cursor skill: [`.cursor/skills/radar-parse-inspect/SKILL.md`](../.cursor/skills/radar-parse-inspect/SKILL.md)

## Пример (Tuapse)

После `--out` читать порядок: `08-summary.md` → `04-candidates.json` → `07-locations.json`.

Ожидание после vicinity/grooming fix:
- groomedText без `@radar`
- blocks: geo/unknown + signal
- place candidates: Туапсе, Адлер, Сочи
- trait `vicinity: true`
