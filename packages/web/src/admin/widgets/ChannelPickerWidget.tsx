import { useMemo, useState } from "react";
import { Panel, StatusDot } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { channels$ } from "../../shared/state/adminStore";
import { selectChannel, selectedChannelKey$ } from "../../shared/state/channelSelectionStore";

/** Action-панель: выбор канала формирует контекст для остальных панелей. */
export function ChannelPickerWidget() {
  const channels = useObservable(channels$, []);
  const selected = useObservable(selectedChannelKey$, null);
  const [query, setQuery] = useState("");

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
          {visible.map((channel) => (
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
                kind={channel.listening ? "ok" : "neutral"}
                label={channel.listening ? "слушается" : "пауза"}
                pulse={channel.listening}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
