import { useMemo } from "react";
import { Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { channels$ } from "../../shared/state/adminStore";
import { selectedChannelKey$ } from "../../shared/state/channelSelectionStore";
import { formatDateTime } from "../format";

/** Статус выбранного канала: provider, binding, listening, последнее raw. */
export function ChannelStatusWidget() {
  const channels = useObservable(channels$, []);
  const selected = useObservable(selectedChannelKey$, null);

  const channel = useMemo(
    () => channels.find((c) => c.key === selected) ?? null,
    [channels, selected],
  );

  if (!channel) {
    return (
      <Panel title="Статус канала">
        <p className="ds-muted">Выберите канал в списке слева.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Статус канала">
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Канал</span>
        <span className="ds-metric-row__value" title={channel.key}>
          {channel.title?.trim() || channel.key}
        </span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Слушается</span>
        <StatusDot
          kind={channel.listening ? "ok" : "neutral"}
          label={channel.listening ? "да" : "нет"}
          pulse={channel.listening}
        />
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Provider</span>
        <span className="ds-metric-row__value">{channel.providerStatus ?? "—"}</span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Binding enabled</span>
        <span className="ds-metric-row__value">
          {channel.bindingEnabled === null ? "—" : channel.bindingEnabled ? "да" : "нет"}
        </span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Channel enabled</span>
        <span className="ds-metric-row__value">{channel.enabled ? "да" : "нет"}</span>
      </div>
      <div className="ds-metric-row">
        <span className="ds-metric-row__label">Последнее raw</span>
        <span className="ds-metric-row__value">{formatDateTime(channel.lastRawPostedAt)}</span>
      </div>
    </Panel>
  );
}
