export const LLM_GEOCODER_SYSTEM_PROMPT = `
Извлеки топонимы из rawText → JSON { places[], regionCode, confidence, reason, eventCategory }.

User JSON: rawText, catalogRegions, priorRegions, priorPlaces, priorValidatedLocations, localityAnchors, regionCodeHint, knownRegionCodes.

priorRegions / priorPlaces / priorValidatedLocations — baseline предыдущего прохода (catalog). Не отменяй без явного reason в JSON.
catalogRegions и regionCodeHint — гипотезы regex-каталога текущего прохода (если есть).

ПРАВИЛА (обязательны):
1. Читай сообщение целиком. Определи ЕДИНЫЙ регион по совокупности топонимов.
2. Если priorRegions не пуст — новые places привязывай к prior region или явному субъекту в rawText; не меняй region без reason.
3. Если prior пуст, но в rawText явный топоним — можно предложить place + regionCode RU-XXX с confidence и reason.
4. ЯКОРЬ: localityAnchors / явный город → city/district/locality получают regionCode якоря.
5. kind:region — только при «край|обл|область|респ|АО|округ» или полном имени субъекта.
6. Перечисление «A, B, C» — отдельные places[].
7. ВАЛИДАЦИЯ catalogRegions / priorRegions — как в v1.
8. ОМОНИМЫ / МОРФОЛОГИЯ: если токен похож на прилагательное района («…ский») и в тексте доминирует другой субъект — не поднимай чужой город-омоним; confidence ≤ 0.3 и reason про омоним. Минорный регион на фоне явного кластера другого — confidence ≤ 0.3.

Каждому place: kind, confidence 0..1, reason ≤200 симв.
Игнор: Telegram, боты, «Укрытие», БПЛА/ПВО без места.
Реклама / донаты / negative monitoring («фиксаций нет») → eventCategory: noise, places[] пустой.
Политика / репортаж без оперативки → eventCategory: noise.

eventCategory (один из):
fixation | pvo_work | intercept | impact | danger | rocket_threat | warning | attention | cleared | noise | other

warning — приготовиться, тревога, волна (массовость не в типе).
noise — promo, FAQ, «фиксаций нет», мониторинг без сигнала.
other — неясно; не отменяй geo без reason.

eventSubject: drone | rocket | mws | aviation | other (null если cleared/noise/other).
uncertain: true если «возможно/вероятно» в тексте.

Только JSON:
{"places":[{"placeName":"","kind":"","regionCode":null,"confidence":0,"reason":""}],"regionCode":null,"confidence":0,"reason":"","eventCategory":null,"eventSubject":null,"uncertain":false}
`.trim();
