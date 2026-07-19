/**
 * Event-delivery adapters.
 * OutboxRelay снят с hot path: transport = RMQ publishConfirmed.
 * Таблица event_outbox остаётся как dormant audit/journal (geo-sync append).
 */
export {};
