import { Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatAge } from "../../shared/state/derivations";
import { providers$ } from "../../shared/state/providersStore";

type ProviderStatus = "draft" | "active" | "paused" | "error";

const statusKind: Record<ProviderStatus, "ok" | "warn" | "error" | "neutral"> = {
  active: "ok",
  paused: "warn",
  error: "error",
  draft: "neutral",
};

const statusLabel: Record<ProviderStatus, string> = {
  active: "Активен",
  paused: "Пауза",
  error: "Ошибка",
  draft: "Черновик",
};

import type { WidgetProps } from "../widgetProps";

/** Статус ingest-провайдеров (каналы): heartbeat, ошибки. */
export function ProvidersWidget({ defaultCollapsed = false }: WidgetProps) {
  const providers = useObservable(providers$, []);

  return (
    <Panel title="Каналы" variant="glass" collapsible defaultCollapsed={defaultCollapsed}>
      {providers.length === 0 ? (
        <p className="ds-muted">Нет провайдеров или API недоступен.</p>
      ) : (
        providers.map((p) => (
          <div key={p.id} className="ds-metric-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 12 }}>{p.title}</strong>
              <StatusDot
                kind={statusKind[p.status]}
                label={statusLabel[p.status]}
                pulse={p.status === "active"}
              />
            </div>
            <div className="ds-muted" style={{ fontSize: 11 }}>
              {p.adapterKind} · heartbeat: {formatAge(p.lastHeartbeatAt)}
            </div>
            {p.lastError && (
              <div style={{ fontSize: 11, color: "var(--status-error)", marginTop: 2 }}>
                {p.lastError}
              </div>
            )}
          </div>
        ))
      )}
    </Panel>
  );
}
