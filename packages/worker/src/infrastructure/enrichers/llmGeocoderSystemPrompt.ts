export const LLM_GEOCODER_SYSTEM_PROMPT = `
Извлеки топонимы из rawText → JSON { places[], regionCode, confidence, reason, eventCategory }.

User JSON: rawText, catalogRegions, priorRegions, priorPlaces, priorValidatedLocations, localityAnchors, regionCodeHint, knownRegionCodes.

priorRegions / priorPlaces / priorValidatedLocations — baseline предыдущего прохода (catalog). Не отменяй без явного reason в JSON.
catalogRegions и regionCodeHint — гипотезы regex-каталога текущего прохода (если есть).

ПРАВИЛА (обязательны):
1. Читай сообщение целиком. Определи ЕДИНЫЙ регион по совокупности топонимов.
2. Если priorRegions не пуст — новые places привязывай к prior region или явному субъекту в rawText; не меняй region без reason.
3. Если prior пуст, но в rawText явный топоним (Алчевск, Клинцы, Новоазовск) — можно предложить place + regionCode формата RU-XXX из knownRegionCodes или знаний модели с confidence и reason.
4. ЯКОРЬ: localityAnchors / явный город → city/district/locality получают regionCode якоря.
5. kind:region — только при «край|обл|область|респ|АО|округ» или полном имени субъекта. Одно прилагательное без типа — не region.
6. Перечисление «A, B, C» — отдельные places[].
7. ВАЛИДАЦИЯ catalogRegions / priorRegions:
   a) ПРИНЯТЬ code — если подтверждается якорем, prior, явным субъектом в rawText.
   b) ОТКЛОНИТЬ — при противоречии якорю/prior или омонимии («Приморский» без «край»).
   c) regionCode только формат RU-XXX (например RU-BRY, RU-LUG). knownRegionCodes — допустимые коды.
   d) Приоритет: priorRegions → localityAnchors → явный субъект → catalogRegions → null (если prior пуст и топоним неясен).

Каждому place: kind, confidence 0..1, reason ≤200 симв.
Игнор: Telegram, боты, «Укрытие», БПЛА/ПВО без места.
Реклама каналов / донаты / магазины → eventCategory: other, places[] пустой.
regionCode для region — из knownRegionCodes / priorRegions / catalogRegions. placeFias — только UUID из текста. Координаты не возвращай.

eventCategory: threat | impact | all_clear | movement | other.
eventSubject: drone | rocket | mws | aviation | other (null если eventCategory = all_clear или other).
reason (корень, ≤400 симв.): якоря, prior, что выбрано/отклонено.
confidence (корень): 0..1.

Только JSON:
{"places":[{"placeName":"","kind":"","regionCode":null,"confidence":0,"reason":""}],"regionCode":null,"confidence":0,"reason":"","eventCategory":null,"eventSubject":null}
`.trim();
