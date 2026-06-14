# SDD: Parse — Фаза P4 — Semantic segmenter

Статус: **ready for implementation**  
RFC: [parse-processor-workspace.md](../../rfc/parse-processor-workspace.md)

**Критерий входа:** P3 registry; P1 geo + event type stable.

---

## 1. Scope / Out of scope

### In scope

- Replace / augment `splitMessageBlocks` with **semantic segmenter**
- Blocks by role: `signal`, `geo`, `stats`, `promo`, `footer`
- Grooming drops promo/footer **before** processors
- Block-context rules for **per-candidate eventType** (comma, pipe, adjacent blocks)
- ODP hook: segmenter patterns in domain pack (optional `segmenter-rules.v1.yaml`)

### Out of scope

- ML/LLM segmenter
- Full NLP sentence boundary detection
- Changing finalizer reconcile logic

---

## 2. Архитектура

```text
raw text
  → segmentMessage(text) → MessageBlock[]
  → groomBlocks(blocks)   → groomedText (drop promo/footer)
  → processors use blocks + groomedText
```

Segmenter runs **before** processor pipeline (not a registry processor — preprocessing SSOT).

---

## 3. Алгоритм v1 (rule-based)

| Step | Rule |
|------|------|
| S1 | Split on `\n`, `|`, `;` |
| S2 | Classify line: regex sets for signal/geo/stats/promo |
| S3 | Merge adjacent same-kind lines |
| S4 | Drop `promo`/`footer` from groomedText but keep in blocks log |
| S5 | Build `groomedText` = concat non-dropped blocks |

Patterns source:
- v1: port from `classifyContentKind.ts` + channel footer heuristics
- v2: `segmenter-rules.v1.yaml` in ODP pack

---

## 4. Block-context eventType (extends P1)

`EventTypeProcessor` v2:

| Context | Behavior |
|---------|----------|
| Single `signal` block | type on all candidates |
| Signal per geo line | match signal block adjacent to geo block by index |
| Comma-separated «Самара — отбой, Казань — внимание» | split → 2 signal fragments → 2 geo anchors |

Stable `candidate.id` = hash(`rawMessageId`, anchor.span, eventType fragment).

---

## 5. Контракты

```typescript
export function segmentMessage(rawText: string, rules?: SegmenterRules): {
  blocks: MessageBlock[];
  groomedText: string;
};
```

Tests must cover RFC § acceptance fixtures + multi-type messages.

---

## 6. Migration

- Feature flag `PARSE_SEMANTIC_SEGMENTER=1`
- Shadow mode: log diff old vs new block split without changing facts (optional week 1)
- Flip default after parity ≥ 99% on sample channel

---

## 7. DoD checklist

- [ ] Promo/footer stripped before GeoProcessor
- [ ] Multi-event raw produces multiple candidates with distinct types
- [ ] P1 golden fixtures still pass (or updated with documented intent)
- [ ] Segmenter rules documented in ODP pack (optional YAML)
- [ ] No regression on heal/re-finalize

---

## 8. Коммиты

| # | Содержание |
|---|------------|
| C1 | segmentMessage + groomBlocks + tests |
| C2 | EventTypeProcessor block-context + multi-type fixtures |
| C3 | (opt) segmenter-rules YAML + ODP loader |
