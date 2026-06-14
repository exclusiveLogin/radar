# SDD: Parse — Фаза P2 — Trait processors + AttachRule

Статус: **ready for implementation**  
RFC: [parse-processor-workspace.md](../../rfc/parse-processor-workspace.md)

**Критерий входа:** P1 finalizer stable; heal green.

---

## 1. Scope / Out of scope

### In scope

- `AttachRule` DSL (4–5 scopes)
- `TraitAttachment` schema
- Processors: **RepeatProcessor**, **MassProcessor**, **CountProcessor**
- Finalizer merge traits → `parsed_events.extras`
- Conflict resolution: priority by `processorId`

### Out of scope

- VicinityProcessor (отдельный commit или P2.1)
- `scope: system` synthetic events (остаётся P1-O3 default B)
- Processor registry file (P3)

---

## 2. AttachRule (SSOT)

```typescript
export type AttachRule =
  | { scope: "all_candidates" }
  | { scope: "by_kind"; kind: "place" | "region" | "system" }
  | { scope: "by_event_type"; type: string }
  | { scope: "first" | "last" }
  | { scope: "system" };
```

```typescript
export type TraitAttachment = {
  id: string;
  processorId: string;
  traitKey: string;           // repeat | mass | count | …
  value: unknown;
  attachRule: AttachRule;
  provenance?: { matchedText?: string; span?: { start: number; end: number } };
};
```

Location: `packages/shared/src/schemas/parse/trait-attachment.ts`

---

## 3. Processors

| Processor | Detect | Default attach | extras key |
|-----------|--------|----------------|------------|
| RepeatProcessor | повторн, снова, again | `all_candidates` | `repeat: true` |
| MassProcessor | много, массирован | `by_kind: place` | `mass: true` |
| CountProcessor | `\d+ (шт\|единиц)` | `first` | `count: number` |

Each processor:
- reads `groomedText`, `candidates`, existing `traitAttachments`;
- appends traits only (no candidate mutation).

---

## 4. Finalizer extension

`resolveTraitsForCandidate(candidate, attachments)`:

1. Filter attachments where rule matches candidate
2. Sort by processor priority table
3. Merge into `extras` (later wins on same key unless `provenance` says otherwise)

Priority table v1: `EventType > Repeat > Mass > Count` (config in code).

---

## 5. Тесты

| Case | Input snippet | Expected |
|------|---------------|----------|
| T1 | «повторная опасность» | all candidates `repeat: true` |
| T2 | «очень много» + place | only place candidate `mass: true` |
| T3 | conflict repeat on region vs place | attach rules isolate |

Fixture: RFC example «Балашов, Саратовская область, повторная…».

---

## 6. DoD checklist

- [ ] AttachRule Zod + 4 processors wired in pipeline order
- [ ] Finalizer extras reflect traits
- [ ] Re-finalize idempotent (traits don't duplicate)
- [ ] No regression P1 fixtures

---

## 7. Коммиты

| # | Содержание |
|---|------------|
| C1 | AttachRule schema + trait resolve in finalizer |
| C2 | Repeat/Mass/Count processors + tests |
