/**
 * ---
 * layer: shared/domain
 * domain: tracking
 * purpose: Browser-safe константы размера тика — без process.env и Node-зависимостей.
 *          Импортируется из browser.ts (Vite) и из worker/api через trackingDbLock.
 * ---
 */

/**
 * NextGen Ф2/Ф3 (кластеризация + Kalman-join) — O(n²) по кандидатам в кластере + Kalman ×
 * openTracks. 250 — рекомендация тюнинга, НЕ хард-лимит: выше настройки пользователя
 * (`config.batchSize`) не режем, но UI подсвечивает hint (см. TrackingPipelineWidget).
 */
export const NEXTGEN_RECOMMENDED_BATCH_SIZE = 250;
