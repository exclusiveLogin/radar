# SDD: ODP — Фаза D5 — Threat profile rules → Tracking

Статус: **ready for implementation**  
ADR: [014](../../adr-014-operational-domain-profile.md)  
Tracking: [phase-1](../tracking/phase-1-l1-mvp.md)

**Критерий входа:** D2 profile loader; Tracking T1 worker (or parallel).

---

## 1. Scope / Out of scope

### In scope

- `resolveThreatProfileFromRules()` из `manifest.threatProfileRules`
- Tracking worker loads rules from `DomainProfileContext`
- Denormalize `threat_profile` on `trajectory_nodes` / tracks from rules
- Unit tests on rule table

### Out of scope

- `PROFILE_KINEMATICS` (max velocity) — stays in core
- Multi-profile per channel

---

## 2. Алгоритм

```typescript
/** Первое совпадение when.* в порядке rules; иначе unknown. */
function resolveThreatProfileFromRules(input: {
  eventType: string;
  eventSubject?: string | null;
  eventCategory?: string | null;
  rules: ThreatProfileRule[];
}): ThreatProfile;
```

Rules source: `OperationalDomainProfile.threatProfileRules`.

---

## 3. Integration

| Consumer | Change |
|----------|--------|
| `TrackingRebuildService` | inject `DomainProfileContext` |
| `buildTrackMetadata` | use resolved profile |
| `trajectory_segment_rollup` | filter by profile (T2b) |

Replace literals in planned `resolveThreatProfile.ts`.

---

## 4. Tests

| Case | event | → profile |
|------|-------|-----------|
| R1 | subject=drone | uav |
| R2 | eventType=rocket_threat | rocket |
| R3 | subject=mws | balloon |
| R4 | no match | unknown |

Fixture: bundled `profile.manifest.json` rules block.

---

## 5. DoD checklist

- [ ] Tracking rebuild uses ODP rules when env set
- [ ] Fallback hardcode removed or feature-flagged off
- [ ] Rules change in manifest → rebuild changes profile without code deploy

---

## 6. Коммит

Single commit: tracking threat resolve from ODP.
