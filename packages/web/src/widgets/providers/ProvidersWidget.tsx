import { EllipsisText, Panel, StatusDot } from "../../shared/ds";
import { EventCardHead } from "../../shared/components/EventCardHead";
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
import type { StateLevel } from "@radar/shared";

/** Маппинг display-статуса канала → цвет акцента карточки. */
function providerLevel(kind: "ok" | "warn" | "error" | "neutral"): StateLevel {
  if (kind === "ok") return "green";
  if (kind === "warn") return "yellow";
  if (kind === "error") return "red";
  return "grey";
}

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
        <ul className="ds-message-feed">
          {providers.map((p) => {
            const connection =
              workerStatus?.worker?.ingest.providers.find((c) => c.providerId === p.id) ?? null;
            const display = resolveIngestProviderDisplayStatus(p, { ...liveCtx, connection });
            const reason = [
              p.adapterKind,
              `heartbeat: ${formatAge(p.lastHeartbeatAt)}`,
              !liveCtx.workerReachable && p.status === "active" ? "worker offline" : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={p.id} className="ds-message-feed__item">
                <EventCardHead
                  title={p.title}
                  level={providerLevel(display.kind)}
                  reason={reason}
                  timeAction={
                    <StatusDot
                      kind={display.kind}
                      label={display.label}
                      tip={display.tip}
                      pulse={display.pulse}
                    />
                  }
                  meta={
                    <span className="ds-event-card__meta-code" title={p.key}>
                      {p.key}
                    </span>
                  }
                />
                {p.lastError && (
                  <EllipsisText
                    text={p.lastError}
                    className="ds-message-feed__text"
                    style={{ color: "var(--status-error)" }}
                    tip={p.lastError}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
