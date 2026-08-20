import { eventSubjectSchema, geoEventCategorySchema } from "@radar/shared";

/** SSOT enum → строка для промпта (без дублирования литералов). */
const EVENT_CATEGORIES = geoEventCategorySchema.options.join(" | ");
const EVENT_SUBJECTS = eventSubjectSchema.options.join(" | ");
const PLACE_KINDS = "region | district | city | locality | settlement";

/**
 * System prompt LLM-геокодера + классификации события.
 * eventCategory — только значения geoEventCategorySchema (валидация ответа в llmEnricher).
 */
export const LLM_GEOCODER_SYSTEM_PROMPT = `
Задачи по rawText (обе обязательны):
A) GEO — извлечь топонимы → places[] (+ опционально общий regionCode).
B) TYPE — классифицировать оперативный смысл → eventCategory + eventSubject.

User JSON: rawText, catalogRegions, priorRegions, priorPlaces, priorValidatedLocations, localityAnchors, regionCodeHint, knownRegionCodes.

prior* / priorValidatedLocations — baseline catalog. Не отменяй geo без явного reason.
catalogRegions / regionCodeHint — гипотезы regex-каталога (могут быть неполными).

═══ GEO ═══
1. Читай сообщение целиком. Перечисление «A, B, C» / несколько районов → отдельные places[].
2. Несколько явных субъектов РФ в тексте → places/region-nodes по каждому; общий regionCode = null (не выбирай «один главный»).
3. Один явный субъект → regionCode этого субъекта; place без своего региона наследуют его.
4. priorRegions не пуст → новые places к prior region или явному субъекту в rawText; смену region только с reason.
5. prior пуст, но явный топоним → place + regionCode RU-XXX с confidence и reason.
6. ЯКОРЬ: localityAnchors / явный город → district/city/locality получают regionCode якоря.
7. kind:region — только «край|область|обл|респ|АО|округ» или полное имя субъекта.
8. ОМОНИМЫ: «…ский» на фоне другого субъекта → чужой город-омоним не поднимай (confidence ≤ 0.3, reason про омоним).
9. Игнор в places: Telegram, боты, «Укрытие», БПЛА/ПВО без места, футеры канала.

Каждому place: kind (${PLACE_KINDS}), confidence 0..1, reason ≤200 симв., regionCode когда известен.

═══ TYPE (eventCategory) ═══
Выбери РОВНО одно значение из enum:
${EVENT_CATEGORIES}

Смысл (оперативка ≠ noise):
• fixation — «фиксация/фиксации БПЛА», пролёт, «от N БПЛА», появление объекта.
• danger / threat — «опасность», угроза атаки (синонимы; предпочти threat при общей формулировке, danger при явной «опасность»).
• intercept — сбитие / перехват цели с локацией.
• pvo_work — «работа ПВО», огонь ПВО (не сводка за сутки).
• impact — уничтожение/падение/поражение на месте (не сводка ПВО).
• warning — приготовиться, тревога, волна (массовость не в типе).
• attention — «внимание», «в вашем направлении» без явной фиксации/опасности; «меры безопасности» БЕЗ угрозы/фиксации.
• rocket_threat — ракетная/реактивная опасность.
• cleared / all_clear — отбой / снятие угрозы / отмена сигнала.
• movement — движение/курс/транзит без фиксации как события (редко).
• noise — ТОЛЬКО: реклама, донаты, promo каналов, FAQ, политика/репортаж без оперативки, negative monitoring («фиксаций нет», «не наблюдаем»).
• other — неясно; geo при этом НЕ отменяй.

ЗАПРЕТ: не ставь noise, если в тексте есть фиксация / опасность / сбитие / работа ПВО / отбой / внимание по БПЛА.
«Фиксация БПЛА» + районы/город → eventCategory=fixation, НЕ noise.
«Опасность по БПЛА» → threat|danger, НЕ noise.
«Отбой опасности» → cleared|all_clear.
Prior geo не делает сообщение noise.

eventSubject (один из): ${EVENT_SUBJECTS}
• drone — БПЛА/дрон; rocket — ракета; mws — МВШ; aviation — авиация; other — иначе.
• null если eventCategory ∈ {cleared, all_clear, noise, other, attention без угрозы}.

═══ OUTPUT ═══
Только JSON:
{"places":[{"placeName":"","kind":"","regionCode":null,"confidence":0,"reason":""}],"regionCode":null,"confidence":0,"reason":"","eventCategory":null,"eventSubject":null}
`.trim();
