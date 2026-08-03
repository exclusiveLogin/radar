import { Counter, Gauge } from "prom-client";
import { apiPrometheusMetrics } from "./apiPrometheusMetrics";

/** SSOT-лейбл gateway: map=/ws, admin=/ws/admin. */
export type WsGatewayLabel = "map" | "admin";

const wsConnections = new Gauge({
  name: "radar_ws_connections",
  help: "Активные WebSocket-клиенты",
  labelNames: ["gateway"] as const,
  registers: [apiPrometheusMetrics.registry],
});

const wsConnectionsTotal = new Counter({
  name: "radar_ws_connections_total",
  help: "События connect/disconnect WebSocket",
  labelNames: ["gateway", "event"] as const,
  registers: [apiPrometheusMetrics.registry],
});

const wsMessagesTotal = new Counter({
  name: "radar_ws_messages_total",
  help: "WebSocket-сообщения (in=от клиента, out=к клиенту)",
  labelNames: ["gateway", "direction", "channel"] as const,
  registers: [apiPrometheusMetrics.registry],
});

/** Нулевая база до первого connect — иначе Grafana `or vector(0)` маскирует отсутствие серии. */
wsConnections.set({ gateway: "map" }, 0);
wsConnections.set({ gateway: "admin" }, 0);

/**
 * Тонкий recorder WS-метрик для MapGateway / AdminGateway.
 * Кардинальность: gateway ∈ {map,admin}, channel — известный набор каналов/типов.
 */
export const wsMetrics = {
  onConnect(gateway: WsGatewayLabel, active: number): void {
    wsConnectionsTotal.inc({ gateway, event: "connect" });
    wsConnections.set({ gateway }, active);
  },

  onDisconnect(gateway: WsGatewayLabel, active: number): void {
    wsConnectionsTotal.inc({ gateway, event: "disconnect" });
    wsConnections.set({ gateway }, active);
  },

  /** Входящее управляющее сообщение (subscribe/unsubscribe). */
  onInbound(gateway: WsGatewayLabel, messageType: string): void {
    wsMessagesTotal.inc({ gateway, direction: "in", channel: messageType });
  },

  /** Исходящее сообщение одному клиенту. */
  onOutbound(gateway: WsGatewayLabel, channel: string): void {
    wsMessagesTotal.inc({ gateway, direction: "out", channel });
  },
};
