import { EllipsisText, Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  formatAge,
  resolveIngestProviderDisplayStatus,
} from "../../shared/state/derivations";
import {
  providers$,
  systemHealth$,
  workerStatus$,
} from "../../shared/state/providersStore";
import type { WidgetProps } from "../widgetProps";

/** Статус ingest-провайдеров: live probe + heartbeat, не только поле status в БД. */
export function ProvidersWidget({
  defaultCollapsed = false,
  panelPersistenceKey,
}: WidgetProps) {
  const providers = useObservable(providers$, []);
  const health = useObservable(systemHealth$, {
    apiOk: false,
    dbReady: false,
    lastCheckAt: null,
  });
  const workerStatus = useObservable(workerStatus$, null);

  const liveCtx = {
    apiOk: health.apiOk,
    dbReady: health.dbReady,
    workerReachable: workerStatus?.reachable ?? false,
    orchestratorRunning: workerStatus?.worker?.orchestrator.running ?? false,
  };

  return (
    <Panel
      title="Каналы"
      variant="glass"
      collapsible
      defaultCollapsed={defaultCollapsed}
      persistenceKey={panelPersistenceKey}
    >
      {providers.length === 0 ? (
        <p className="ds-muted">
          {!health.apiOk
            ? "API недоступен — статус каналов не загружен."
            : "Нет провайдеров."}
        </p>
      ) : (
        providers.map((p) => {
          const connection =
            workerStatus?.worker?.ingest.providers.find((c) => c.providerId === p.id) ?? null;
          const display = resolveIngestProviderDisplayStatus(p, { ...liveCtx, connection });
          return (
            <div
              key={p.id}
              className="ds-metric-row"
              style={{ flexDirection: "column", alignItems: "stretch" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <EllipsisText
                  text={p.title}
                  className="ds-ellipsis"
                  style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }}
                  tip={`${p.title}\n${p.key} · ${p.adapterKind}\nDB status: ${p.status}`}
                />
                <StatusDot
                  kind={display.kind}
                  label={display.label}
                  tip={display.tip}
                  pulse={display.pulse}
                />
              </div>
              <div className="ds-muted" style={{ fontSize: 12 }}>
                {p.adapterKind} · heartbeat: {formatAge(p.lastHeartbeatAt)}
                {!liveCtx.workerReachable && p.status === "active" ? " · worker offline" : null}
              </div>
              {p.lastError && (
                <EllipsisText
                  text={p.lastError}
                  className="ds-ellipsis"
                  style={{ fontSize: 12, color: "var(--status-error)", marginTop: 2 }}
                  tip={p.lastError}
                />
              )}
            </div>
          );
        })
      )}
    </Panel>
  );
}
