# ADR-002: Place Trust & Provenance

Дата: 2026-05-12  
Статус: Accepted

## Контекст

В realtime-пайплайне `place` может:
- совпасть с существующей записью (FIAS/alias/name+region),
- либо быть создан из внешнего кандидата (например LLM), если матч не найден.

Без слоя доверия такие места визуально и операционно неотличимы, что ухудшает качество UI и аналитики.

## Решение

1. Ввести trust/provenance модель для `places`:
   - `trust_state`: `unverified|partially_verified|verified|rejected`
   - `is_trusted`: bool
   - `trust_score`: numeric
   - `trust_updated_at`: timestamp
   - `evidence_providers`: список провайдеров, участвовавших в подтверждении.

2. Ввести append-only таблицу `place_evidence`:
   - `provider`: `catalog|dadata|nominatim|llm|operator|system`
   - `action`: `candidate|confirm|reject|enrich`
   - `confidence`, `payload`, `trace_id`, `created_at`.

3. Разделить семантику:
   - `active` отвечает за эксплуатационное участие записи;
   - `trusted` отвечает за уровень подтвержденности.

4. Правило realtime:
   - `matched_existing` -> evidence `confirm`, trust пересчитывается;
   - `created_new` -> evidence `candidate`, trust не выше policy-уровня источника.

5. Базовая policy доверия (по умолчанию):
   - `catalog`: 1.00
   - `dadata`: 0.95
   - `nominatim`: 0.80
   - `llm`: 0.55
   - `operator`: 1.00
   - `system`: 0.70

## Последствия

- Плюсы:
  - объяснимость происхождения данных;
  - управляемые предупреждения в UI;
  - готовая база для batch дообогащения.
- Минусы:
  - дополнительные поля и таблицы;
  - необходимость read-side агрегаций по trust/evidence.

## План развития

Итерация 1 (выполнено): модель trust/provenance + `place_evidence` + запись evidence в realtime validation.  
Итерация 2 (следующая): read-side поля, endpoint истории evidence, UI-ready `needsAttention`.  
Итерация 3: batch enrichment orchestration (rate limits, retry/backoff, promotion policy).
