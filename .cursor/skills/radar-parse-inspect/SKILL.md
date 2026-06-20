---
name: radar-parse-inspect
description: >-
  Parse debug workflow: raw message → parse:inspect artifacts. Use when user asks
  to validate parse, explain missing locations, or debug channel message parsing.
---

# Radar parse inspect

SSOT doc: [docs/parse-inspect.md](../../docs/parse-inspect.md)

## When to use

- «Провалидируй parse», «почему нет Tuapse», «разбор сообщения»
- Пользователь скинул текст канала / snap
- Нужно объяснить groom → blocks → geo hits → candidates → locations

## Agent workflow

1. Сохранить текст → `packages/worker/tmp/inspect-<slug>.txt` или `--text=`.
2. Запустить (Windows, корень репо):

```powershell
npm run worker:parse:inspect -- packages/worker/tmp/inspect-<slug>.txt --out=packages/worker/tmp/inspect-<slug> --storage-mode=db
```

3. Прочитать **в порядке**: `08-summary.md` → `04-candidates.json` → `07-locations.json` → при необходимости `03-geo-hits.json`.
4. Ответ структурой: **Groom → Blocks → Geo hits → Candidates → Traits → Locations → Root cause** (файл/YAML/правило).
5. Если `--storage-mode=memory` — предупредить: catalog пуст, place candidates могут быть 0.

## Do not

- Не плодить ad-hoc tsx/SQL probe scripts
- Не использовать как CI pass/fail gate
- Не дублировать полный stdout `parse:snap` — только `parse:inspect --out`

## Reference fixture

`packages/shared/src/domain/parse/__fixtures__/gf-p6-07-tuapse-vicinity-oneline.txt`
