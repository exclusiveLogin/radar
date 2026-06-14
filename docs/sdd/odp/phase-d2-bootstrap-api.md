# SDD: ODP — Фаза D2 — Bootstrap + active profile API

Статус: **ready for implementation**  
ADR: [014](../../adr-014-operational-domain-profile.md)

**Критерий входа:** D1 parser pack loader работает.

---

## 1. Scope / Out of scope

### In scope

- Zod `operationalDomainProfileSchema`
- Loader: `profile.manifest.json` + link to rule packs
- Env bootstrap worker + API
- `GET /map/domain-profile/active`
- Rename example → runtime manifest in bundled pack

### Out of scope

- DB table `operational_domain_profiles` (v2)
- Web UI changes (D3)
- Admin UI editor

---

## 2. Архитектура

```text
OPERATIONAL_DOMAIN_PROFILE_ID + DOMAIN_PACKS_PATH
  → loadOperationalDomainProfile()
  → loadParserRulePack(manifest.parserRulePackIds)
  → loadGeoGrooming(manifest.geoGroomingPackId)
  → DomainProfileContext (singleton per process)

API: GET /map/domain-profile/active
  → { id, title, uiPresets, activeEventTypes }  // без regex
```

---

## 3. Контракты

### 3.1 Zod — `packages/shared/src/schemas/domain/operational-domain-profile.ts`

```typescript
export const uiFilterPresetSchema = z.object({
  id: z.string(),
  surface: z.enum(["heatmap", "timeline", "tracks", "widgets"]),
  label: z.string(),
  eventTypes: z.array(z.string()),
  eventCategories: z.array(z.string()).optional(),
  defaultEnabled: z.boolean().optional(),
});

export const threatProfileRuleSchema = z.object({
  threatProfile: z.enum(["uav", "rocket", "balloon", "unknown"]),
  when: z.object({
    eventTypes: z.array(z.string()).optional(),
    eventSubjects: z.array(z.string()).optional(),
    eventCategories: z.array(z.string()).optional(),
  }),
});

export const operationalDomainProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  locale: z.string().default("ru"),
  isDefault: z.boolean().optional(),
  activeEventTypes: z.array(z.string()),
  uiPresets: z.array(uiFilterPresetSchema),
  threatProfileRules: z.array(threatProfileRuleSchema).default([]),
  parserRulePackIds: z.array(z.string()),
  geoGroomingPackId: z.string().optional(),
});
```

### 3.2 API response (public subset)

```typescript
export const activeDomainProfileResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  locale: z.string(),
  activeEventTypes: z.array(z.string()),
  uiPresets: z.array(uiFilterPresetSchema),
});
```

---

## 4. Loader SSOT

`packages/shared/src/domain/domain-profile/`:

- `resolveDomainPacksPath(env)` — bundled fallback (ADR-014 hybrid)
- `loadOperationalDomainProfile(profileId, basePath)`
- `DomainProfileContext` type

Worker + API share loader (no duplicate logic).

---

## 5. Миграции

**v1:** без таблицы. Optional v2:

```sql
operational_domain_profiles (id, title, manifest jsonb, enabled, ...)
```

CLI skeleton (v2): `domain:manifest:import`

---

## 6. Bundled artifact

Promote:

```text
profile.manifest.example.json  →  profile.manifest.json  (bundled default)
```

Strip `_notice` field in runtime file.

---

## 7. DoD checklist

- [ ] Worker starts with env profile id
- [ ] API returns active profile JSON (Zod validated)
- [ ] Missing pack path → clear error at startup
- [ ] Swagger documents endpoint
- [ ] Hybrid path: override mount works

---

## 8. Коммиты

| # | Содержание |
|---|------------|
| C1 | shared schema + loader + tests |
| C2 | API endpoint + worker bootstrap wire |
