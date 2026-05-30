import { EllipsisText, Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { formatAge } from "../../shared/state/derivations";
import { providers$ } from "../../shared/state/providersStore";
import type { WidgetProps } from "../widgetProps";

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <EllipsisText
                text={p.title}
                className="ds-ellipsis"
                style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }}
                tip={`${p.title}\n${p.key} · ${p.adapterKind}`}
              />
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
              <EllipsisText
                text={p.lastError}
                className="ds-ellipsis"
                style={{ fontSize: 11, color: "var(--status-error)", marginTop: 2 }}
                tip={p.lastError}
              />
            )}
          </div>
        ))
      )}
    </Panel>
  );
}
