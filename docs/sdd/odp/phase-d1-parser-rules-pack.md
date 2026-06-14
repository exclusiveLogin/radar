# SDD: ODP — Фаза D1 — Parser rules pack + geo grooming

Статус: **ready for implementation**  
ADR: [014](../../adr-014-operational-domain-profile.md)

**Критерий входа:** D0 docs ✅. Код parse работает (legacy `extractEventType.ts`).

---

## 1. Scope / Out of scope

### In scope

- `parser-rules.v1.yaml` — перенос regex из `extractEventType.ts` + subject rules
- `geo-grooming.v1.yaml` — strip prefixes из `geoCatalog.ts`
- Domain loader + classifier delegate
- CLI `domain:parser-rules:validate`
- Golden parity tests vs текущий parse

### Out of scope

- `profile.manifest.json` runtime (D2)
- UI presets (D3)
- `classifyContentKind` / `extractPvoStats` (v2 packs)
- Parse workspace (Parse P1)

---

## 2. Архитектура

```text
DOMAIN_PACKS_PATH/uav_osint_ru_v1/
  parser-rules.v1.yaml
  geo-grooming.v1.yaml

Worker bootstrap (minimal D1):
  loadParserRulePack(path)
  loadGeoGroomingPack(path)
  RuleBasedEventClassifier → classifyEventType(text, pack)

geoCatalog → applyGeoGrooming(text, groomingPack)
```

---

## 3. Контракты

### 3.1 Zod — `packages/shared/src/schemas/domain/parser-rule-pack.ts`

```typescript
export const parserRuleSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int(),
  pattern: z.string().min(1),
  flags: z.string().optional(), // "i" | "is" | "im"
  eventType: z.string().min(1),
});

export const subjectRuleSchema = z.object({
  id: z.string(),
  priority: z.number().int(),
  pattern: z.string(),
  flags: z.string().optional(),
  subject: z.enum(["drone", "rocket", "mws", "aviation", "other"]),
});

export const parserRulePackSchema = z.object({
  schemaVersion: z.literal(1),
  domainProfileId: z.string(),
  rules: z.array(parserRuleSchema),
  subjectRules: z.array(subjectRuleSchema).default([]),
});
```

### 3.2 Geo grooming pack

```typescript
export const geoGroomingPackSchema = z.object({
  schemaVersion: z.literal(1),
  stripLinePrefixes: z.array(z.string()),
  commercialNoisePatterns: z.array(z.string()).optional(),
});
```

---

## 4. Алгоритмы (SSOT)

| Модуль | Путь |
|--------|------|
| `loadParserRulePack.ts` | read YAML → validate Zod → sort by priority |
| `classifyEventTypeFromPack.ts` | first match wins (как сейчас) |
| `classifyEventSubjectFromPack.ts` | subject rules |
| `applyGeoGrooming.ts` | regex strip |

`extractEventType.ts` → re-export / delegate для BC.

---

## 5. Файлы данных

Создать:

- `data/domains/uav_osint_ru_v1/parser-rules.v1.yaml` — **1:1** перенос из TS
- `data/domains/uav_osint_ru_v1/geo-grooming.v1.yaml`

---

## 6. Worker / CLI

```bash
npm run worker -- domain:parser-rules:validate [--path data/domains/uav_osint_ru_v1]
```

Wiring: `createParsePipeline.ts` — inject pack (env path or default bundled).

---

## 7. Тесты

| Test | Описание |
|------|----------|
| parity | все cases из `extractEventType.test.ts` |
| parity | `rvkOperationalHints.test.ts`, `channelCityListPromo.test.ts` |
| validate CLI | invalid YAML → exit 1 |
| load | unknown eventType in rule → warn if not in dictionary (soft v1) |

---

## 8. DoD checklist

- [ ] YAML pack parity с legacy TS tests
- [ ] `geo-grooming` покрывает strip из geoCatalog
- [ ] validate CLI в package scripts
- [ ] Без изменения API контрактов parse output
- [ ] typecheck + lint green

---

## 9. Коммиты

| # | Содержание |
|---|------------|
| C1 | schemas + loader + classify from pack + tests |
| C2 | YAML files + geo grooming + wire worker |
