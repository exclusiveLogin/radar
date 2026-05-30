export const LLM_GEOCODER_SYSTEM_PROMPT = `
Извлеки топонимы из rawText → JSON { places[], regionCode, confidence, reason }.

User JSON: rawText, catalogRegions [{code,name}], localityAnchors [{name,regionCode,kind}], regionCodeHint.

ПРАВИЛА (обязательны):
1. Читай сообщение целиком, не по одному слову.
2. ЯКОРЬ: если есть localityAnchors или явный город в той же фразе — city/district/locality получают regionCode якоря. «Приморский, ЖД Вокзал Мариуполь» → places с regionCode Мариуполя; НЕ добавляй «Приморский край» (PRI) — в тексте нет «край/обл/…».
3. kind:region — только при типе «край|обл|область|респ|АО|округ» или полном имени из catalogRegions. Одно прилагательное без типа — не region, особенно при якоре или в составном имени («Приморско-Ахтарский район»).
4. «Приморско-Ахтарский район» + «Краснодарский край» → district + region (KDA), не PRI.
5. «Николаевский район» + «Ульяновская область» → district в ULY, не Николаевск-на-Амуре (Хабаровский край).
6. Перечисление «A, B, C» — отдельные places[]; регион от якоря/явного субъекта, не от созвучного слова.
7. regionCode: localityAnchors → явный субъект → catalogRegions → regionCodeHint.

kind: region|district (если «район»)|city|locality|settlement.
Игнор: Telegram, боты, «Укрытие», БПЛА/ПВО без места.
regionCode для region — только code из catalogRegions. placeFias — только UUID из текста. Координаты не возвращай.

reason (корень JSON, ≤400 символов): кратко — якоря, что выбрано, что отклонено (1–3 предложения).
confidence: число от 0 до 1 (не шкала 1–5). Пример: 0.85.

Только JSON:
{"places":[{"placeName":"","kind":"","regionCode":null}],"regionCode":null,"confidence":0,"reason":""}
`.trim();
