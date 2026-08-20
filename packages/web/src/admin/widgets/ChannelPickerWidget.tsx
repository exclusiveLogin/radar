import { useMemo, useState } from "react";
import { Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { resolveChannelIngestDisplay } from "../../shared/state/derivations";
import { channels$, telemetry$ } from "../../shared/state/adminStore";
import { selectChannel, selectedChannelKey$ } from "../../shared/state/channelSelectionStore";

/** Action-панель: выбор канала формирует контекст для остальных панелей. */
export function ChannelPickerWidget() {
  const channels = useObservable(channels$, []);
  const telemetry = useObservable(telemetry$, null);
  const selected = useObservable(selectedChannelKey$, null);
  const [query, setQuery] = useState("");
  const connections = telemetry?.worker.worker?.ingest.providers ?? [];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) => c.key.toLowerCase().includes(q) || (c.title ?? "").toLowerCase().includes(q),
    );
  }, [channels, query]);

  return (
    <Panel title={`Каналы (${channels.length})`}>
      <input
        className="ds-input"
        placeholder="Поиск канала…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {visible.length === 0 ? (
        <p className="ds-muted">Нет каналов.</p>
      ) : (
        <ul className="ds-pick-list">
          {visible.map((channel) => {
            const connection =
              connections.find((c) => c.providerId === channel.providerId) ?? null;
            const display = resolveChannelIngestDisplay({
              listening: channel.listening,
              providerStatus: channel.providerStatus,
              connection,
            });
            return (
            <li
              key={channel.id}
              className={`ds-pick-list__item${
                selected === channel.key ? " ds-pick-list__item--active" : ""
              }`}
              onClick={() => selectChannel(channel.key)}
            >
              <span className="ds-pick-list__name" title={channel.key}>
                {channel.title?.trim() || channel.key}
              </span>
              <StatusDot
                kind={display.kind}
                label={display.label}
                pulse={display.pulse}
                tip={display.tip}
              />
            </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
