# SDD: ODP — Фаза D4 — event_type: enum → dictionary validation

Статус: **ready for implementation**  
ADR: [014](../../adr-014-operational-domain-profile.md)

**Критерий входа:** D3 UI на presets; dictionary populated.

---

## 1. Scope / Out of scope

### In scope

- Runtime validate `event_type` against `status_dictionary` + active ODP `activeEventTypes`
- API heatmap/map queries accept any active dictionary code
- Deprecate public `eventTypeSchema` z.enum (internal alias v1)
- Migration: `status_dictionary` cols `domain_profile_id`, `event_category`, `ui_group`

### Out of scope

- Removing enum from all worker tests at once
- Auto-generate dictionary from YAML

---

## 2. Phased rollout (E1–E3)

| Step | Change |
|------|--------|
| E1 | Parse persist: warn on unknown code |
| E2 | API strict validate on write paths |
| E3 | Remove z.enum from public exported schemas |

---

## 3. SSOT validation

```typescript
/** Проверяет код типа против active ODP + status_dictionary. */
function assertActiveEventType(code: string, ctx: DomainProfileContext): void;
```

Location: `packages/shared/src/domain/domain-profile/assertActiveEventType.ts`

---

## 4. Миграции

```sql
ALTER TABLE status_dictionary
  ADD COLUMN IF NOT EXISTS domain_profile_id text,
  ADD COLUMN IF NOT EXISTS event_category text,
  ADD COLUMN IF NOT EXISTS ui_group text;
```

Seed `uav_osint_ru_v1` rows for existing codes.

---

## 5. API

`map.controller.ts` — replace `eventTypeSchema.safeParse` with dictionary lookup.

---

## 6. DoD checklist

- [ ] New code in dictionary + ODP works without TS enum change
- [ ] Unknown code rejected at parse finalize with structured error
- [ ] Swagger lists dynamic types note
- [ ] Backward compat tests pass

---

## 7. Коммиты

| # | Содержание |
|---|------------|
| C1 | migration + dictionary seed |
| C2 | shared validate + API + parse finalize guard |
