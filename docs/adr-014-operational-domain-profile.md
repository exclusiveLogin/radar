> **Имена таблиц:** актуальные — [database-table-naming.md](./database-table-naming.md). Ниже — исторический контекст.`n`n# ADR-014: Р’С‹РЅРѕСЃ РґРѕРјРµРЅРЅРѕР№ Р·РѕРЅС‹ Р‘РџР›Рђ (Operational Domain Profile)

Р”Р°С‚Р°: 2026-06-14  
РЎС‚Р°С‚СѓСЃ: **РџСЂРµРґР»РѕР¶РµРЅРѕ**

РЎРІСЏР·Р°РЅРѕ: [ADR-003](./adr-003-phase-enrichment-accumulator.md), [ADR-008](./adr-008-kinematic-vs-static-events.md), [rfc/parse-processor-workspace.md](./rfc/parse-processor-workspace.md), [sdd/odp/](./sdd/odp/README.md), [sdd/tracking/](./sdd/tracking/README.md)

---

## РљРѕРЅС‚РµРєСЃС‚

РџСЂРѕРґСѓРєС‚ РёСЃС‚РѕСЂРёС‡РµСЃРєРё Р·Р°С‚РѕС‡РµРЅ РїРѕРґ **РѕРґРёРЅ OSINT-РґРѕРјРµРЅ** (СЂР°РґР°СЂ, Telegram-РєР°РЅР°Р»С‹, РїРµСЂРµС…РІР°С‚, С„РёРєСЃР°С†РёРё). Р­С‚Рѕ РїСЂРѕСЏРІРёР»РѕСЃСЊ РІ РєРѕРґРµ РєР°Рє **Р¶С‘СЃС‚РєР°СЏ РїСЂРёРІСЏР·РєР° Рє РѕРґРЅРѕРјСѓ РґРѕРјРµРЅСѓ**, С…РѕС‚СЏ Р°СЂС…РёС‚РµРєС‚СѓСЂРЅРѕ СѓР¶Рµ РµСЃС‚СЊ Р·Р°РґРµР» РїРѕРґ РєРѕРЅС„РёРіСѓСЂР°С†РёСЋ (`status_dictionary`, phase manifest, parse workspace RFC).

**Р¦РµР»СЊ:** UI, РїР°СЂСЃРµСЂС‹ Рё tracking РЅР°СЃС‚СЂР°РёРІР°СЋС‚СЃСЏ **С„РёР»СЊС‚СЂР°РјРё Рё РјР°РЅРёС„РµСЃС‚Р°РјРё**, Р±РµР· РїСЂР°РІРєРё TypeScript РїСЂРё РґРѕР±Р°РІР»РµРЅРёРё С‚РёРїР° СЃРѕР±С‹С‚РёСЏ, СЃРјРµРЅРµ Р»РµРєСЃРёРєРё РёР»Рё Р·Р°РїСѓСЃРєРµ РІС‚РѕСЂРѕРіРѕ РґРѕРјРµРЅР° (СЂР°РєРµС‚С‹-only, РґСЂСѓРіРѕР№ СЂРµРіРёРѕРЅ, РґСЂСѓРіРѕР№ СЏР·С‹Рє).

**РќРµ С†РµР»СЊ:** РїРµСЂРµРїРёСЃР°С‚СЊ РІРµСЃСЊ parse big-bang РёР»Рё СЃРґРµР»Р°С‚СЊ Turing-complete DSL РїСЂР°РІРёР» РІ v1.

> рџ“– **РџРѕС€Р°РіРѕРІРѕ РїСЂРѕСЃС‚С‹Рј СЏР·С‹РєРѕРј:** [operational-domain-profile-walkthrough.md](./rfc/operational-domain-profile-walkthrough.md) вЂ” С€Р°РіРё D0вЂ“D5, **В§13 РєР°СЂС‚Р° РјРёРіСЂР°С†РёРё С„Р°Р№Р»РѕРІ**.

---

## РўРµРєСѓС‰РёР№ coupling (Р°СѓРґРёС‚ СЃР»РѕС‘РІ)

### РљР°СЂС‚Р°: РіРґРµ Р·Р°С€РёС‚ В«Р‘РџР›Рђ-РґРѕРјРµРЅВ»

| РЎР»РѕР№ | Р¤Р°Р№Р» / Р°СЂС‚Рµfact | Coupling | Severity |
|------|-----------------|----------|----------|
| **Shared contracts** | `packages/shared/src/schemas/ingest/event-type.ts` | Р—Р°РєСЂС‹С‚С‹Р№ `z.enum([fixation, вЂ¦])` вЂ” РЅРѕРІС‹Р№ С‚РёРї = РґРµРїР»РѕР№ | рџ”ґ РІС‹СЃРѕРєРёР№ |
| **Shared UI filter** | `packages/shared/src/schemas/map/event-heatmap.ts` | `EVENT_HEATMAP_FILTER_TYPES` вЂ” С…Р°СЂРґРєРѕРґ РїРѕРґРјРЅРѕР¶РµСЃС‚РІР° | рџџ  СЃСЂРµРґРЅРёР№ |
| **Parse rules** | `packages/worker/src/domain/parsing/extractEventType.ts` | ~30 regex СЃ `Р±РїР»Р°`, `РґСЂРѕРЅ`, `РјРІС€`, `СЂР°РєРµС‚` | рџ”ґ РІС‹СЃРѕРєРёР№ |
| **Parse subject** | `extractEventSubject.ts` (same file) | РџСЂРёРѕСЂРёС‚РµС‚ drone/rocket/mws | рџџ  СЃСЂРµРґРЅРёР№ |
| **Geo grooming** | `packages/worker/.../geoCatalog.ts` | Strip-prefix `(?:Р±РїР»Р°\|С„РёРєСЃР°С†РёСЏ\|вЂ¦)` | рџџ  СЃСЂРµРґРЅРёР№ |
| **Dictionary DB** | `status_dictionary` | Р•СЃС‚СЊ `parser_hints[]`, РЅРѕ **РЅРµ SSOT** РґР»СЏ regex | рџџЎ С‡Р°СЃС‚РёС‡РЅРѕ |
| **Map read** | `map-query.service.ts`, fold | JOIN РїРѕ `status_dictionary` вЂ” **СѓР¶Рµ data-driven** | рџџў OK |
| **Tracking (plan)** | `threatProfile: uav\|rocket\|balloon` | Enum РІ SDD; РјР°РїРїРёРЅРі РЅРµ РІ dictionary | рџџ  СЃСЂРµРґРЅРёР№ |
| **Product copy** | `docs/plan.md`, README | В«СЂР°РґР°СЂ РїРѕ Р‘РџР›РђВ» вЂ” РјР°СЂРєeting, РЅРµ РєРѕРґ | рџџў OK |

### Р’С‹РІРѕРґ РїРѕ СЃР»РѕСЏРј

```text
в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
в”‚  UI / API read-side     вЂ” С‡Р°СЃС‚РёС‡РЅРѕ OK (status_dictionary)   в”‚
в”њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¤
в”‚  Shared Zod enums       вЂ” Р–РЃРЎРўРљРР™ coupling (event types)    в”‚
в”њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¤
в”‚  Worker parse domain    вЂ” Р–РЃРЎРўРљРР™ coupling (regex rules)    в”‚
в”њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¤
в”‚  Facts (mat_parse_event)  вЂ” РЅРµР№С‚СЂР°Р»СЊРЅС‹ (event_type = string)  в”‚
в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
```

**Р“СЂР°РЅРёС†Р° decouple:** РјРµР¶РґСѓ **domain pack (РєРѕРЅС„РёРі)** Рё **platform core (shared + worker shell)**.  
Facts РѕСЃС‚Р°СЋС‚СЃСЏ append-only; РјРµРЅСЏРµС‚СЃСЏ **РёРЅС‚РµСЂРїСЂРµС‚Р°С†РёСЏ** Рё **РЅР°Р±РѕСЂ Р°РєС‚РёРІРЅС‹С… РїСЂР°РІРёР»/С„РёР»СЊС‚СЂРѕРІ**.

---

## Р РµС€РµРЅРёРµ

### 1. Operational Domain Profile (ODP)

Р•РґРёРЅР°СЏ СЃСѓС‰РЅРѕСЃС‚СЊ РєРѕРЅС„РёРіСѓСЂР°С†РёРё В«РєР°РєРѕР№ РјРёСЂ РјС‹ РјРѕРЅРёС‚РѕСЂРёРјВ»:

```typescript
type OperationalDomainProfile = {
  id: string;                    // e.g. "uav_osint_ru_v1"
  title: string;                 // "Р‘РџР›Рђ OSINT (Р Р¤)"
  locale: string;                // "ru"
  isDefault: boolean;
  /** РђРєС‚РёРІРЅС‹Рµ РєРѕРґС‹ РёР· status_dictionary */
  activeEventTypes: string[];
  /** UI presets: heatmap, map layers, widgets */
  uiPresets: UiFilterPreset[];
  /** РњР°РїРїРёРЅРі РґР»СЏ tracking threat_profile (ADR-007/013) */
  threatProfileRules: ThreatProfileRule[];
  /** РЎСЃС‹Р»РєРё РЅР° rule packs РїР°СЂСЃРµСЂР° */
  parserRulePackIds: string[];
  /** Geo grooming: noise prefixes, promo patterns */
  geoGroomingPackId?: string;
};
```

**SSOT v1:** JSON-РјР°РЅifest РІ СЂРµРїРѕ + Zod + import CLI (РїР°С‚С‚РµСЂРЅ РєР°Рє `phase_definitions`).  
**v2:** СЃС‚СЂРѕРєР° РІ Р‘Р” `operational_domain_profiles`, toggle РІ Р°РґРјРёРЅРєРµ (enabled profile per deployment).

### 2. Р Р°Р·РґРµР»РµРЅРёРµ: Platform Core vs Domain Pack

| Platform Core (РЅРµ Р·РЅР°РµС‚ РїСЂРѕ Р‘РџР›Рђ) | Domain Pack `uav_osint_ru` |
|----------------------------------|----------------------------|
| `mat_parse_event`, `mat_parse_location` | Regex / processor rules |
| `status_dictionary` schema | Entries + hints РґР»СЏ РґРѕРјРµРЅР° |
| `mapStateFold`, Time Machine | `state_level` mapping per type |
| Generic map API | UI filter presets |
| Tracking worker shell | `threatProfileRules`, kinematics profile |
| Parse workspace contract | EventTypeProcessor config |

Domain pack **РЅРµ РёРјРїРѕСЂС‚РёСЂСѓРµС‚СЃСЏ** РІ core РєР°Рє `if (Р±РїР»Р°)` вЂ” С‚РѕР»СЊРєРѕ С‡РµСЂРµР· **injected config** РїСЂРё bootstrap worker/web.

### 3. Event types вЂ” РѕС‚ open enum Рє dictionary-validated string

**РџСЂРѕР±Р»РµРјР°:** `eventTypeSchema = z.enum([...])` Р±Р»РѕРєРёСЂСѓРµС‚ РЅРѕРІС‹Рµ РєРѕРґС‹.

**РџСѓС‚СЊ (incremental):**

| Р­С‚Р°Рї | РР·РјРµРЅРµРЅРёРµ |
|------|-----------|
| **E1** | `eventTypeCodeSchema = z.string().min(1)` РІ persistence; enum РѕСЃС‚Р°С‘С‚СЃСЏ РґР»СЏ **legacy compile-time** РІ worker tests |
| **E2** | Runtime validate: `status_dictionary.code` exists + active + in current ODP |
| **E3** | РЈР±СЂР°С‚СЊ enum РёР· public API; РєР»РёРµРЅС‚С‹ С‡РёС‚Р°СЋС‚ dictionary |

`EventType` type alias в†’ `string` СЃ branded optional `EventTypeCode` РёР· dictionary snapshot.

### 4. Parser rules вЂ” external rule pack

**РџСЂРѕР±Р»РµРјР°:** `extractEventType.ts` вЂ” РјРѕРЅРѕР»РёС‚ regex.

**Р РµС€РµРЅРёРµ:** Rule Pack manifest (YAML/JSON):

```yaml
# data/domains/uav_osint_ru/parser-rules.v1.yaml
schemaVersion: 1
domainProfileId: uav_osint_ru_v1
rules:
  - id: cleared_threat
    priority: 10
    pattern: "РѕС‚Р±РѕР№.*(РѕРїР°СЃРЅРѕСЃС‚|РІРЅРёРјР°РЅРё|С‚СЂРµРІРѕРі|СѓРіСЂРѕР·)"
    flags: is
    eventType: cleared
  - id: pvo_stats_destroyed
    priority: 20
    pattern: "СѓРЅРёС‡С‚РѕР¶РµРЅ[Р°-СЏС‘]*\\s+\\d+\\s+(?:СѓРєСЂР°РёРЅСЃРєРёС…\\s+)?(?:Р±РїР»Р°|Р±РµСЃРїРёР»РѕС‚РЅ)"
    flags: i
    eventType: pvo_report
  # вЂ¦
```

**Runtime:**

```typescript
/** Р—Р°РіСЂСѓР¶Р°РµС‚ СѓРїРѕСЂСЏРґРѕС‡РµРЅРЅС‹Рµ РїСЂР°РІРёР»Р° РёР· pack; SSOT РІ data/, РЅРµ РІ TS. */
function classifyEventType(text: string, pack: ParserRulePack): string | null;
```

`extractEventType.ts` в†’ thin wrapper / re-export РґР»СЏ BC; golden tests РѕСЃС‚Р°СЋС‚СЃСЏ, РёСЃС‚РѕС‡РЅРёРє РїСЂР°РІРёР» вЂ” С„Р°Р№Р».

**РЎРІСЏР·СЊ СЃ parse RFC:** `EventTypeProcessor` С‡РёС‚Р°РµС‚ С‚РѕС‚ Р¶Рµ pack; workspace РЅРµ РґСѓР±Р»РёСЂСѓРµС‚ regex.

### 5. UI filters вЂ” data-driven presets

**РџСЂРѕР±Р»РµРјР°:** `EVENT_HEATMAP_FILTER_TYPES` Р·Р°С…Р°СЂРґРєРѕР¶РµРЅ.

**Р РµС€РµРЅРёРµ:**

```typescript
type UiFilterPreset = {
  id: string;                    // "heatmap_operational"
  surface: "heatmap" | "timeline" | "tracks" | "widgets";
  eventTypes: string[];          // codes from dictionary
  eventCategories?: string[];
  label: string;
  defaultEnabled?: boolean;
};
```

Web РїСЂРё СЃС‚Р°СЂС‚Рµ:

```text
GET /map/status-dictionary?domainProfile=uav_osint_ru_v1
GET /map/domain-profile/active   в†’ uiPresets
```

`MapHeatmapControls` СЃС‚СЂРѕРёС‚ РєРЅРѕРїРєРё РёР· **preset + dictionary titles**, РЅРµ РёР· const РІ shared.

### 6. Tracking threat_profile вЂ” mapping table, РЅРµ С…Р°СЂРґРєРѕРґ РІ resolve

**РџСЂРѕР±Р»РµРјР° (planned):** `resolveThreatProfile()` СЃ Р»РёС‚РµСЂР°Р»Р°РјРё rocket/mws.

**Р РµС€РµРЅРёРµ:** РїСЂР°РІРёР»Р° РІ ODP:

```typescript
type ThreatProfileRule = {
  threatProfile: "uav" | "rocket" | "balloon" | "unknown";
  when: {
    eventTypes?: string[];
    eventSubjects?: string[];
    eventCategories?: string[];
  };
};
```

Worker tracking Р·Р°РіСЂСѓР¶Р°РµС‚ rules РёР· active ODP; fallback `unknown`.

Kinematics (`PROFILE_KINEMATICS`) РѕСЃС‚Р°С‘С‚СЃСЏ РІ shared РєР°Рє **physics SSOT**, РЅРµ Р»РµРєСЃРёРєР° Р‘РџР›Рђ.

### 7. Geo grooming pack

Р’С‹РЅРµСЃС‚Рё prefix-strip РёР· `geoCatalog.ts`:

```yaml
# data/domains/uav_osint_ru/geo-grooming.v1.yaml
stripLinePrefixes:
  - "^(?:Р±РїР»Р°|СѓРіСЂРѕР·Р°|РѕРїР°СЃРЅРѕСЃС‚СЊ|РІРЅРёРјР°РЅРёРµ|С„РёРєСЃР°С†РёСЏ|РѕС‚Р±РѕР№)\\s+(?:РїРѕ|РЅР°)?\\s*"
commercialNoisePatterns: [...]
```

### 8. Multi-domain (future, РЅРµ v1)

РћРґРёРЅ deployment = **РѕРґРёРЅ active ODP** (default).  
РџРѕР·Р¶Рµ: channel-level override (`ingest_bindings.domain_profile_id`) РґР»СЏ СЃРјРµС€Р°РЅРЅС‹С… РёРЅСЃС‚Р°Р»Р»СЏС†РёР№.

---

## Р“РґРµ Р¶РёРІС‘С‚ ODP: bundled vs on-premise

ODP вЂ” **РґР°РЅРЅС‹Рµ**, РЅРµ РєРѕРґ. РџР»Р°С‚С„РѕСЂРјР° С‚РѕР»СЊРєРѕ **Р·Р°РіСЂСѓР¶Р°РµС‚ pack** РїСЂРё СЃС‚Р°СЂС‚Рµ; **РѕС‚РєСѓРґР°** С‡РёС‚Р°С‚СЊ вЂ” СЂРµС€Р°РµС‚ РґРµРїР»РѕР№.

### РўСЂРё СѓСЂРѕРІРЅСЏ (РЅРµ РїСѓС‚Р°С‚СЊ)

| РЈСЂРѕРІРµРЅСЊ | Р§С‚Рѕ | РљС‚Рѕ РІР»Р°РґРµР»РµС† | РњРµРЅСЏРµС‚СЃСЏ РєР°Рє |
|---------|-----|--------------|--------------|
| **Platform core** | worker, api, web, shared | РїСЂРѕРґСѓРєС‚ / git | СЂРµР»РёР· monorepo |
| **Domain pack (ODP)** | manifest, parser-rules, geo-grooming, presets | РїСЂРѕРґСѓРєС‚ **РёР»Рё** Р·Р°РєР°Р·С‡РёРє | С„Р°Р№Р»С‹ / import, **Р±РµР·** С„РѕСЂРєР° core |
| **Runtime dictionary** | `status_dictionary` РІ Р‘Р” | РѕР±С‰РёР№ | РјРёРіСЂР°С†РёРё + admin/import |

Facts (`mat_parse_event`) РЅРµР№С‚СЂР°Р»СЊРЅС‹; ODP РІР»РёСЏРµС‚ РЅР° **parse + UI + tracking mapping**, РЅРµ РЅР° СЃС…РµРјСѓ facts.

### Р РµР¶РёРј A вЂ” Bundled (default, В«РёР· РєРѕСЂРѕР±РєРёВ»)

Pack **РІС€РёС‚ РІ Р°СЂС‚Рµfact** РґРµРїР»РѕСЏ:

```text
radar/
  data/domains/uav_osint_ru_v1/     в†ђ git + Docker image
    profile.manifest.json
    parser-rules.v1.yaml
    geo-grooming.v1.yaml
```

| | |
|---|---|
| **РљРѕРіРґР°** | managed SaaS, С‚РёРїРѕРІРѕР№ В«Р Р°РґР°СЂ Р‘РџР›РђВ», dev/staging |
| **Env** | `DOMAIN_PACKS_PATH=data/domains` (default) |
| **РћР±РЅРѕРІР»РµРЅРёРµ** | СЂРµР»РёР· РѕР±СЂР°Р·Р° / git pull + restart worker |
| **РџР»СЋСЃ** | zero-config, CI golden tests = bundled pack |

РћРїС†РёРѕРЅР°Р»СЊРЅРѕ v2: npm `@radar/domain-uav-osint-ru` вЂ” С‚РѕС‚ Р¶Рµ РєРѕРЅС‚РµРЅС‚ РѕС‚РґРµР»СЊРЅС‹Рј РїР°РєРµС‚РѕРј (Р»РёС†РµРЅР·РёСЂРѕРІР°РЅРёРµ РґРѕРјРµРЅР°).

### Р РµР¶РёРј B вЂ” On-premise / customer-owned

Pack **РІРЅРµ** РѕР±СЂР°Р·Р° вЂ” volume РёР»Рё РєР°С‚Р°Р»РѕРі Р·Р°РєР°Р·С‡РёРєР°:

```text
/opt/radar/domains/uav_osint_ru_v1/
  profile.manifest.json
  parser-rules.v1.yaml
  ...
```

| | |
|---|---|
| **РљРѕРіРґР°** | Р·Р°РєСЂС‹С‚С‹Р№ РєРѕРЅС‚СѓСЂ, СЃРІРѕРё РєР°РЅР°Р»С‹/Р»РµРєСЃРёРєР°, РїСЂР°РІРєРё Р±РµР· РЅР°С€РµРіРѕ git |
| **Env** | `DOMAIN_PACKS_PATH=/opt/radar/domains` |
| **РћР±РЅРѕРІР»РµРЅРёРµ** | РїСЂР°РІРєР° YAML Сѓ Р·Р°РєР°Р·С‡РёРєР° в†’ validate CLI в†’ restart worker (v1) / reload (v2) |
| **РџР»СЋСЃ** | core Р·Р°РєСЂС‹С‚, РґРѕРјРµРЅ РЅР°СЃС‚СЂР°РёРІР°РµС‚ SI/Р·Р°РєР°Р·С‡РёРє |

On-premise **в‰  fork repo** вЂ” РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ `domains/`, Р±РёРЅР°СЂРЅРёРєРё С‚Рµ Р¶Рµ.

### Р РµР¶РёРј C вЂ” Hybrid (СЂРµРєРѕРјРµРЅРґСѓРµРј РґР»СЏ prod)

```text
1. Bundled pack РІ РѕР±СЂР°Р·Рµ     в†’ fallback / demo / РїРµСЂРІС‹Р№ boot
2. DOMAIN_PACKS_PATH         в†’ РµСЃР»Рё РєР°С‚Р°Р»РѕРі РµСЃС‚СЊ, С‡РёС‚Р°РµРј РµРіРѕ (override)
3. OPERATIONAL_DOMAIN_PROFILE_ID в†’ Р°РєС‚РёРІРЅС‹Р№ РїРѕРґРєР°С‚Р°Р»РѕРі
```

Loader:

```text
if DOMAIN_PACKS_PATH Р·Р°РґР°РЅ Рё СЃСѓС‰РµСЃС‚РІСѓРµС‚ в†’ customer path
else в†’ bundled data/domains РІРЅСѓС‚СЂРё image
```

Starter pack РІ РѕР±СЂР°Р·Рµ + override mount Р±РµР· РїРµСЂРµСЃР±РѕСЂРєРё.

### Р РµР¶РёРј D вЂ” Import РІ Р‘Р” (v2)

```bash
domain:manifest:import --path /opt/radar/domains/uav_osint_ru_v1
```

в†’ `operational_domain_profiles` (+ РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ rules snapshot РІ JSONB).

| | |
|---|---|
| **РљРѕРіРґР°** | РїРѕР»РёС‚РёРєР° В«no bind mountsВ», С‚РѕР»СЊРєРѕ DB |
| **Authoring** | git Сѓ Р·Р°РєР°Р·С‡РёРєР° в†’ import CLI |
| **Runtime SSOT** | Р‘Р” |

РћРґРёРЅ deployment вЂ” **РѕРґРёРЅ** source: `DOMAIN_PACK_SOURCE=file|db` (РЅРµ РѕР±Р° РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ РєР°Рє SSOT).

### РљС‚Рѕ С‡С‚Рѕ РЅР°СЃС‚СЂР°РёРІР°РµС‚ (on-premise)

| Р РѕР»СЊ | РњРµРЅСЏРµС‚ | РќРµ С‚СЂРѕРіР°РµС‚ |
|------|--------|------------|
| Vendor | core, bundled pack | вЂ” |
| Р—Р°РєР°Р·С‡РёРє / SI | pack YAML, `DOMAIN_PACKS_PATH`, import dictionary | TypeScript |
| РђРЅР°Р»РёС‚РёРє (v2) | titles / ui_group РІ dictionary | regex rules |

### Docker (on-prem)

```yaml
worker:
  environment:
    OPERATIONAL_DOMAIN_PROFILE_ID: uav_osint_ru_v1
    DOMAIN_PACKS_PATH: /etc/radar/domains
  volumes:
    - ./customer-domains:/etc/radar/domains:ro
```

Web С‡РёС‚Р°РµС‚ ODP **С‚РѕР»СЊРєРѕ С‡РµСЂРµР· API** (`GET /map/domain-profile/active`), РЅРµ filesystem.

### Default РґР»СЏ В«Р Р°РґР°СЂВ»

| РЎСЂРµРґР° | Р РµР¶РёРј |
|-------|--------|
| dev / CI | **A** bundled |
| managed prod | **C** bundled + optional mount |
| on-prem РєРѕРЅС‚СЂР°РєС‚ | **B** РёР»Рё **C** |

**v1:** file loader + `DOMAIN_PACKS_PATH` (СЂРµР¶РёРјС‹ **A + C**). DB import (**D**) вЂ” v2.

---

## РџРѕРєСЂС‹С‚РёРµ: ODP в‰  РѕРґРёРЅ manifest

**Р§РµСЃС‚РЅС‹Р№ РѕС‚РІРµС‚:** РѕРґРёРЅ `profile.manifest.json` **РЅРµ СЃРЅРёРјР°РµС‚** РІРµСЃСЊ coupling. ODP вЂ” СЌС‚Рѕ **РЅР°Р±РѕСЂ pack-С„Р°Р№Р»РѕРІ + dictionary + РґРѕСЂР°Р±РѕС‚РєР° loader РІ core**.

### Р§С‚Рѕ РїРѕРєСЂС‹РІР°РµС‚ С‚РѕР»СЊРєРѕ manifest

| РћР±Р»Р°СЃС‚СЊ | РџРѕР»СЏ ODP |
|---------|----------|
| РљР°РєРёРµ С‚РёРїС‹ СЃРѕР±С‹С‚РёР№ Р°РєС‚РёРІРЅС‹ РІ РґРѕРјРµРЅРµ | `activeEventTypes` |
| РљРЅРѕРїРєРё/С„РёР»СЊС‚СЂС‹ heatmap, РІРёРґР¶РµС‚С‹ | `uiPresets` |
| Р‘РџР›Рђ vs СЂР°РєРµС‚Р° vs С€Р°СЂ РґР»СЏ С‚СЂРµРєРѕРІ | `threatProfileRules` |
| РЎСЃС‹Р»РєРё РЅР° РґСЂСѓРіРёРµ С„Р°Р№Р»С‹ | `parserRulePackIds`, `geoGroomingPackId` |

в‰€ **30вЂ“40%** С‚РµРєСѓС‰РµРіРѕ domain coupling.

### Р§С‚Рѕ С‚СЂРµР±СѓРµС‚ РѕС‚РґРµР»СЊРЅС‹С… pack-С„Р°Р№Р»РѕРІ (РЅРµ manifest)

| РЎРµР№С‡Р°СЃ РІ РєРѕРґРµ | Pack | Р¤Р°Р·Р° |
|---------------|------|------|
| `extractEventType.ts` (~30 regex) | `parser-rules.v1.yaml` | D1 |
| `extractEventSubject()` | С‚РѕС‚ Р¶Рµ pack РёР»Рё subject rules | D1 |
| `geoCatalog.ts` prefix strip | `geo-grooming.v1.yaml` | D1 |
| `classifyContentKind.ts` (EVENT_HINTS, Р±РїР»Р°вЂ¦) | `content-kind.v1.yaml` (v2, РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ) | backlog |
| `extractPvoStats.ts` | `pvo-stats-rules.v1.yaml` (v2) | backlog |

### Р§С‚Рѕ С‚СЂРµР±СѓРµС‚ РїСЂР°РІРєРё core (РЅРµ РєРѕРЅС„РёРі)

| РњРµСЃС‚Рѕ | РџРѕС‡РµРјСѓ РЅРµ manifest | Р¤Р°Р·Р° |
|-------|-------------------|------|
| `eventTypeSchema` z.enum | С‚РёРї СЃРёСЃС‚РµРјС‹ + API validation | D4 |
| Loader: read pack в†’ inject classifier | РёРЅС„СЂР°СЃС‚СЂСѓРєС‚СѓСЂР° | D1вЂ“D2 |
| Web: С‡РёС‚Р°С‚СЊ presets РёР· API | UI wiring | D3 |
| `map-query` literal `event_type = 'вЂ¦'` | generic filter by `feed_kind` / dictionary | D6 |
| `PROFILE_KINEMATICS` (max velocityвЂ¦) | **С„РёР·РёРєР°**, РЅРµ Р»РµРєСЃРёРєР° вЂ” **РѕСЃС‚Р°С‘С‚СЃСЏ РІ core** | вЂ” |
| fold / Time Machine | СѓР¶Рµ С‡РµСЂРµР· `status_dictionary` | OK |

### РС‚РѕРіРѕРІР°СЏ РјР°С‚СЂРёС†Р°

```text
                    manifest   full ODP pack   code refactor
Parse regex            вЂ”            вњ…              вњ… loader
UI heatmap filters     вњ…           вњ…              вњ… D3
Threat mapping         вњ…           вњ…              вњ… D5
Geo grooming           вЂ”            вњ…              вњ… loader
Event type enum        вЂ”            вЂ”               вњ… D4
Content kind / noise   вЂ”            partial v2      вњ…
Macro stats parse        вЂ”            v2              вњ…
API read routes          вЂ”            вЂ”               вњ… D6
Kinematics physics     вЂ”            вЂ”               stays in core
```

**Р РµР°Р»СЊРЅРѕ РїСЂРёРІРµСЃС‚Рё coupling РІ РїРѕСЂСЏРґРѕРє вЂ” РґР°**, РЅРѕ СЌС‚Рѕ **РїСЂРѕРіСЂР°РјРјР° D1вЂ“D5**, РЅРµ РѕРґРёРЅ JSON. Manifest вЂ” **РґРёСЂРёР¶С‘СЂ**, РЅРµ РІСЃСЏ РѕСЂРєРµСЃС‚СЂРѕРІРєР°.

---

```text
Worker start / API start
  в†’ load active OperationalDomainProfile (env OPERATIONAL_DOMAIN_PROFILE_ID)
  в†’ load linked parser rule pack + geo grooming
  в†’ inject into RuleBasedEventClassifier / ParseWorkspace registry
  в†’ inject uiPresets exposure via API

Web start
  в†’ fetch active domain profile + status_dictionary
  в†’ hydrate heatmapStore / layer panels from presets
```

Env:

| Key | Default | РќР°Р·РЅР°С‡РµРЅРёРµ |
|-----|---------|------------|
| `OPERATIONAL_DOMAIN_PROFILE_ID` | `uav_osint_ru_v1` | id Р°РєС‚РёРІРЅРѕРіРѕ pack |
| `DOMAIN_PACKS_PATH` | `data/domains` | РєР°С‚Р°Р»РѕРі packs (bundled РёР»Рё mount) |
| `DOMAIN_PACK_SOURCE` | `file` | `file` \| `db` (v2) |

---

## РњРёРіСЂР°С†РёРё / С…СЂР°РЅРµРЅРёРµ (v1)

```sql
-- v1 optional: С‚РѕР»СЊРєРѕ manifest file, Р±РµР· С‚Р°Р±Р»РёС†С‹
-- v2:
operational_domain_profiles (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  manifest      jsonb NOT NULL,
  is_default    boolean DEFAULT false,
  enabled       boolean DEFAULT true,
  created_at    timestamptz,
  updated_at    timestamptz
);
```

`status_dictionary` СЂР°СЃС€РёСЂРёС‚СЊ (additive):

| Column | Purpose |
|--------|---------|
| `domain_profile_id` | nullable; NULL = all domains |
| `event_category` | threat / movement / impact / вЂ¦ (SSOT РІРјРµСЃС‚Рѕ extras-only) |
| `affects_kinematics` | ADR-008 |
| `threat_profile` | optional mapping for tracking |
| `ui_group` | heatmap / operational / hidden |

---

## РџР»Р°РЅ РІРЅРµРґСЂРµРЅРёСЏ (РЅРµ Р±Р»РѕРєРёСЂСѓРµС‚ tracking С„Р°Р·Сѓ 1)

РџРѕРґСЂРѕР±РЅРѕРµ РѕРїРёСЃР°РЅРёРµ РєР°Р¶РґРѕРіРѕ С€Р°РіР°: [operational-domain-profile-walkthrough.md](./rfc/operational-domain-profile-walkthrough.md).

| Phase | Deliverable | Coupling СЃРЅРёРјР°РµС‚СЃСЏ |
|-------|-------------|-------------------|
| **D0** | ADR + walkthrough + manifest schema Zod | вЂ” |
| **D1** | Rule pack YAML + loader; `extractEventType` в†’ delegate | Parse regex |
| **D2** | ODP manifest + CLI import; API `GET /domain-profile/active` | Bootstrap |
| **D3** | UI heatmap/layers from presets + dictionary | UI const |
| **D4** | `eventType` runtime validation; deprecate z.enum | Shared enum |
| **D5** | Threat profile rules in ODP | Tracking resolve |
| **D6** | [API read-side decoupling](#api-read-side-decoupling-С„Р°Р·Р°-d6) | Domain routes, SQL literals, Swagger enum |

**РџР°СЂР°Р»Р»РµР»СЊРЅРѕ СЃ Tracking P1:** D1 РјРѕР¶РЅРѕ РЅР°С‡Р°С‚СЊ СЃСЂР°Р·Сѓ (parser pack); D3вЂ“D6 вЂ” РїРѕСЃР»Рµ РёР»Рё РІРјРµСЃС‚Рµ СЃ tracking.

---

## API read-side decoupling (С„Р°Р·Р° D6)

**РџСЂРѕР±Р»РµРјР°:** ODP (D1вЂ“D5) СЃРЅРёРјР°РµС‚ coupling РІ parse/UI/tracking, РЅРѕ **HTTP read-layer РѕСЃС‚Р°С‘С‚СЃСЏ domain-hardcoded**: РѕС‚РґРµР»СЊРЅС‹Рµ РјР°СЂС€СЂСѓС‚С‹ РїРѕРґ РѕРґРёРЅ РґРѕРјРµРЅ, SQL СЃ Р»РёС‚РµСЂР°Р»Р°РјРё С‚РёРїРѕРІ, Swagger СЃ `z.enum`, DTO СЃ domain-РїРѕР»СЏРјРё. Р­С‚Рѕ **РІС‚РѕСЂРѕР№ РїРѕР»РЅРѕС†РµРЅРЅС‹Р№ endpoint pack** вЂ” Р±РµР· D6 СЃРјРµРЅР° РґРѕРјРµРЅР° РїРѕС‚СЂРµР±СѓРµС‚ РїСЂР°РІРєРё API.

### РђРЅС‚Рё-patterns (Р·Р°РїСЂРµС‰РµРЅРѕ РїРѕСЃР»Рµ D6)

| Anti-pattern | РџСЂРёРјРµСЂ СЃРµР№С‡Р°СЃ | РџРѕС‡РµРјСѓ РїР»РѕС…Рѕ |
|--------------|---------------|--------------|
| Domain-named route | `GET /map/pvo-reports` | РЅРѕРІС‹Р№ РґРѕРјРµРЅ в†’ РЅРѕРІС‹Р№ URL |
| Literal РІ SQL | `event_type = 'pvo_report'` | РѕР±С…РѕРґРёС‚ dictionary |
| Closed enum РІ query | `eventTypeSchema` z.enum | РґРµРїР»РѕР№ РЅР° РЅРѕРІС‹Р№ РєРѕРґ |
| Swagger examples | `fixation,pvo_work,...` | РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ в‰  active ODP |
| Widget title hardcode | РЅР°Р·РІР°РЅРёРµ feed РІ UI | РЅРµ РёР· preset/dictionary |

### Р¦РµР»РµРІР°СЏ РјРѕРґРµР»СЊ

```text
Client
  в†’ GET /map/domain-profile/active
  в†’ GET /map/status-dictionary
  в†’ GET /map/events/heatmap?eventTypes=вЂ¦
  в†’ GET /map/event-feed?feedKind=macro_report
```

**SSOT:** `status_dictionary` + ODP. API вЂ” С‚РѕРЅРєРёР№ query layer.

| v0 | v1 |
|----|-----|
| `GET /map/pvo-reports` | `GET /map/event-feed?feedKind=macro_report` (+ deprecated alias) |
| Heatmap enum | validate вЉ† active ODP + dictionary (D4) |

Dictionary: `feed_kind`, `map_surface`, optional `extras_schema` (v2).

### РљР°Рє API В«Р·Р°РјС‹РєР°РµС‚СЃСЏВ» РЅР° ODP (Р±РµР· Р°РІС‚РѕСЌРЅРґРїРѕРёРЅС‚РѕРІ)

**РћС‚РІРµС‚ РѕРґРЅРѕР№ С„СЂР°Р·РѕР№:** С‡РµСЂРµР· **РѕР±С‰РёР№ loader РІ `packages/shared`** + **inject `DomainProfileContext` РІ API/worker** + **generic read-handlers СЃ РІР°Р»РёРґР°С†РёРµР№ query** вЂ” **РЅРµ** С‡РµСЂРµР· РіРµРЅРµСЂР°С†РёСЋ РјР°СЂС€СЂСѓС‚РѕРІ РёР· `profile.manifest.json`.

#### Non-goals (СЏРІРЅРѕ РЅРµ РґРµР»Р°РµРј)

| РџРѕРґС…РѕРґ | РџРѕС‡РµРјСѓ РѕС‚РІРµСЂРіРЅСѓС‚ |
|--------|------------------|
| Auto-endpoint РЅР° РєР°Р¶РґС‹Р№ `uiPresets[]` | СЃРЅРѕРІР° endpoint pack, С‚РѕР»СЊРєРѕ codegen; N presets в†’ N controllers |
| Auto-endpoint РЅР° РєР°Р¶РґС‹Р№ `activeEventTypes` | explosion URL; С‚РёРїС‹ РјРµРЅСЏСЋС‚СЃСЏ С‡РµСЂРµР· dictionary, РЅРµ С‡РµСЂРµР· router |
| Web С‡РёС‚Р°РµС‚ pack СЃ РґРёСЃРєР° | СѓС‚РµС‡РєР° deployment path; web = API client only |
| Domain concept РІ path (`/map/<lexicon>/вЂ¦`) | РЅРѕРІС‹Р№ РґРѕРјРµРЅ = РЅРѕРІС‹Рµ routes |
| Р”СѓР±Р»РёСЂРѕРІР°С‚СЊ ODP loader РІ `packages/api` | РґРІР° SSOT, drift worker vs API |

#### SSOT Рё bootstrap (D2)

```text
packages/shared/src/domain/domain-profile/
  resolveDomainPacksPath(env)
  loadOperationalDomainProfile(profileId, basePath)
  в†’ DomainProfileContext   // singleton РЅР° РїСЂРѕС†РµСЃСЃ Nest/worker

Worker Module.onModuleInit / worker bootstrap:
  ctx = loadвЂ¦(OPERATIONAL_DOMAIN_PROFILE_ID, DOMAIN_PACKS_PATH)
  inject в†’ RuleBasedEventClassifier, TrackingRebuild, вЂ¦

API Module (Nest):
  DomainProfileModule provides DOMAIN_PROFILE_CONTEXT
  MapController / MapQueryService inject ctx
```

Web **РЅРµ** РёРјРїРѕСЂС‚РёСЂСѓРµС‚ loader вЂ” С‚РѕР»СЊРєРѕ HTTP:

```text
GET /map/domain-profile/active   в†’ uiPresets, activeEventTypes (public subset)
GET /map/status-dictionary       в†’ titles, feed_kind, map_surface, kinematics
```

#### Generic endpoints vs manifest-driven routes

Manifest **РЅРµ РїРѕСЂРѕР¶РґР°РµС‚** URL. РћРЅ Р·Р°РґР°С‘С‚ **РїРѕР»РёС‚РёРєСѓ**, РєРѕС‚РѕСЂСѓСЋ **СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ** handlers РїСЂРёРјРµРЅСЏСЋС‚:

| Handler (С„РёРєСЃРёСЂРѕРІР°РЅРЅС‹Р№ URL) | Р§С‚Рѕ Р±РµСЂС‘С‚ РёР· ODP / dictionary |
|-----------------------------|-------------------------------|
| `GET /map/events/heatmap` | `eventTypes` query вЉ† `activeEventTypes` + dictionary validate |
| `GET /map/event-feed` | `feedKind` в†’ JOIN `status_dictionary.feed_kind` |
| `GET /map/tracks` | threat filter РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ РёР· preset; kinematics РёР· dictionary |
| `GET /map/domain-profile/active` | СЏРІРЅР°СЏ РІС‹РґР°С‡Р° manifest subset РєР»РёРµРЅС‚Сѓ |

РќРѕРІС‹Р№ С‚РёРї СЃРѕР±С‹С‚РёСЏ РёР»Рё feed = **СЃС‚СЂРѕРєР° РІ dictionary** (+ РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ preset РІ manifest), **Р±РµР·** РЅРѕРІРѕРіРѕ `@Get()` РІ controller.

#### Validation layer (D4 + D6)

Р•РґРёРЅР°СЏ С‚РѕС‡РєР° РїРµСЂРµРґ SQL вЂ” РЅРµ СЂР°Р·РјР°Р·Р°РЅРЅР°СЏ РїРѕ controller:

```typescript
// packages/shared РёР»Рё packages/api/src/map/domain-profile/
assertQueryableEventTypes(codes: string[], ctx: DomainProfileContext): void;
assertFeedKind(feedKind: string, ctx: DomainProfileContext): void;

// Nest: guard РёР»Рё MapQueryService private method
// Reject 400 РµСЃР»Рё code в€‰ activeEventTypes РёР»Рё РЅРµС‚ РІ dictionary РґР»СЏ profile
```

SQL **С‚РѕР»СЊРєРѕ** С‡РµСЂРµР· dictionary flags:

```sql
-- вњ… РїРѕСЃР»Рµ D6
JOIN status_dictionary sd ON sd.code = pe.event_type
WHERE sd.feed_kind = $1
  AND (sd.domain_profile_id IS NULL OR sd.domain_profile_id = $profileId)

-- вќЊ Р·Р°РїСЂРµС‰РµРЅРѕ
WHERE pe.event_type = 'pvo_report'
```

#### РџРѕС‚РѕРє read-request (СЃРєРІРѕР·РЅРѕР№)

```mermaid
sequenceDiagram
  participant Web
  participant API
  participant Ctx as DomainProfileContext
  participant DB as status_dictionary + facts

  Web->>API: GET /domain-profile/active
  API->>Ctx: read cached ctx
  API-->>Web: uiPresets, activeEventTypes

  Web->>API: GET /events/heatmap?eventTypes=fixation,pvo_work
  API->>Ctx: assertQueryableEventTypes
  API->>DB: heatmap query JOIN dictionary
  API-->>Web: GeoJSON points

  Web->>API: GET /event-feed?feedKind=macro_report
  API->>Ctx: assertFeedKind
  API->>DB: feed query WHERE feed_kind
  API-->>Web: feed items
```

#### Р Р°СЃС€РёСЂРµРЅРёРµ РґРѕРјРµРЅР° (checklist Р±РµР· РґРµРїР»РѕСЏ API)

1. Р”РѕР±Р°РІРёС‚СЊ РєРѕРґ РІ `status_dictionary` (+ `feed_kind` / `map_surface` РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё).
2. Р”РѕР±Р°РІРёС‚СЊ РєРѕРґ РІ `activeEventTypes` Рё preset РІ manifest pack.
3. `domain:manifest:import` РёР»Рё reload mount (v2).
4. РљР»РёРµРЅС‚ РїРѕРґС…РІР°С‚С‹РІР°РµС‚ preset С‡РµСЂРµР· `/domain-profile/active`.

**РќРµ С‚СЂРµР±СѓРµС‚СЃСЏ:** РЅРѕРІС‹Р№ controller method, РїСЂР°РІРєР° `z.enum`, РїСЂР°РІРєР° Swagger enum list РІ TS.

#### Deprecated alias (РїРµСЂРµС…РѕРґРЅС‹Р№)

`GET /map/pvo-reports` в†’ thin delegate РЅР° `listEventFeed({ feedKind: 'macro_report' })` + `@ApiDeprecated` РѕРґРЅР° РІРµСЂСЃРёСЏ. РЈРґР°Р»РµРЅРёРµ вЂ” РѕС‚РґРµР»СЊРЅС‹Р№ gate (СЃРј. РѕС‚РєСЂС‹С‚С‹Рµ РІРѕРїСЂРѕСЃС‹ В§6).

#### Р“РґРµ Р¶РёРІС‘С‚ РєРѕРґ (РѕСЂРёРµРЅС‚РёСЂ)

| РЎР»РѕР№ | РџСѓС‚СЊ |
|------|------|
| Loader + types | `packages/shared/src/domain/domain-profile/` |
| Nest provider | `packages/api/src/map/domain-profile/domain-profile.module.ts` |
| Query validate | `packages/api/src/map/domain-profile/assert-queryable.ts` |
| Generic feeds | `packages/api/src/map/event-feed/` |

SDD РґРµС‚Р°Р»Рё: [phase-d6-api-read-decoupling.md](./sdd/odp/phase-d6-api-read-decoupling.md).

---

## РќРµ РґРµР»Р°РµРј

- РџРѕР»РЅР°СЏ i18n РІСЃРµС… regex РІ v1
- Admin UI СЂРµРґР°РєС‚РѕСЂ РїСЂР°РІРёР» (С‚РѕР»СЊРєРѕ manifest РІ git v1)
- РќРµСЃРєРѕР»СЊРєРѕ active ODP РЅР° РѕРґРёРЅ deployment РІ v1
- РЈРґР°Р»РµРЅРёРµ `status_dictionary` РІ РїРѕР»СЊР·Сѓ С‚РѕР»СЊРєРѕ YAML (Р‘Р” РѕСЃС‚Р°С‘С‚СЃСЏ SSOT РґР»СЏ runtime edits)
- Auto-generation HTTP routes РёР· ODP manifest (СЃРј. [В§ D6 Non-goals](#non-goals-СЏРІРЅРѕ-РЅРµ-РґРµР»Р°РµРј))

---

## РџРѕСЃР»РµРґСЃС‚РІРёСЏ

| РџР»СЋСЃ | РњРёРЅСѓСЃ |
|------|-------|
| РќРѕРІС‹Р№ event type Р±РµР· РґРµРїР»РѕСЏ core | Р”РІР° РёСЃС‚РѕС‡РЅРёРєР° РїСЂР°РІРґС‹ РґРѕ D4 (YAML + enum) вЂ” РЅСѓР¶РµРЅ import sync |
| Р’С‚РѕСЂРѕР№ РґРѕРјРµРЅ = РЅРѕРІС‹Р№ pack, РЅРµ fork repo | РњРёРіСЂР°С†РёСЏ golden tests РЅР° YAML packs |
| UI С„РёР»СЊС‚СЂС‹ СЃРѕРіР»Р°СЃРѕРІР°РЅС‹ СЃ parse | Bootstrap СЃР»РѕР¶РЅРµРµ |
| Tracking kinematics РѕС‚РґРµР»С‘РЅ РѕС‚ Р»РµРєСЃРёРєРё | v1 РІСЃС‘ РµС‰С‘ РѕРґРёРЅ default ODP |

---

## РљСЂРёС‚РµСЂРёРё РїСЂРёРЅСЏС‚РёСЏ

- [ ] РќРѕРІРѕРµ РїСЂР°РІРёР»Рѕ parse РґРѕР±Р°РІР»СЏРµС‚СЃСЏ РІ YAML + `parser-rules:validate` Р±РµР· РїСЂР°РІРєРё `extractEventType.ts`
- [ ] Heatmap UI СЃС‚СЂРѕРёС‚СЃСЏ РёР· ODP preset + dictionary (РЅРµС‚ `EVENT_HEATMAP_FILTER_TYPES` hardcode)
- [ ] `GET /map/status-dictionary` С„РёР»СЊС‚СЂСѓРµС‚ РїРѕ active domain profile
- [ ] Golden tests parse РїСЂРѕС…РѕРґСЏС‚ РЅР° pack `uav_osint_ru_v1` (parity СЃ С‚РµРєСѓС‰РёРј behavior)
- [ ] `GET /map/event-feed` Р±РµР· domain literals; deprecated aliases РґРѕРєСѓРјРµРЅС‚РёСЂРѕРІР°РЅС‹ (D6)

---

## РЎРІСЏР·СЊ СЃ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРјРё ADR

| ADR | РР·РјРµРЅРµРЅРёРµ |
|-----|-----------|
| ADR-003 | ODP = РµС‰С‘ РѕРґРёРЅ manifest СЂСЏРґРѕРј СЃ phase_definitions |
| ADR-008 | `affects_kinematics` + `event_category` РІ status_dictionary |
| Parse RFC | EventTypeProcessor в†ђ parser rule pack |
| Tracking SDD | `resolveThreatProfile` в†ђ ODP rules, РЅРµ literals |

---

## РћС‚РєСЂС‹С‚С‹Рµ РІРѕРїСЂРѕСЃС‹

1. YAML vs JSON РґР»СЏ rule packs РІ СЂРµРїРѕ?
2. Versioning pack: `uav_osint_ru_v1` vs semver С„Р°Р№Р»РѕРІ?
3. Channel-level ODP override вЂ” РЅСѓР¶РµРЅ Р»Рё РІ v1?
4. РљРѕРіРґР° СѓРґР°Р»СЏС‚СЊ `z.enum` event types РїРѕР»РЅРѕСЃС‚СЊСЋ (D4 gate)?
5. Bundled-only vs customer pack licensing (РѕС‚РґРµР»СЊРЅС‹Р№ npm domain package)?
6. D6: СЃСЂРѕРє СѓРґР°Р»РµРЅРёСЏ `/map/pvo-reports` alias?

---

## РЎРј. С‚Р°РєР¶Рµ

- [operational-domain-profile-walkthrough.md](./rfc/operational-domain-profile-walkthrough.md) вЂ” **РїРѕС€Р°РіРѕРІРѕ С‡РµР»РѕРІРµС‡РµСЃРєРёРј СЏР·С‹РєРѕРј**
- [sdd/tracking/plan.md](./sdd/tracking/plan.md)
- [place-trust-explained.md](./place-trust-explained.md) вЂ” Р°РЅР°Р»РѕРіРёСЏ: policy РІ data, РЅРµ РІ РєРѕРґРµ

