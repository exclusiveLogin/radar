import type { ChannelAdminItem } from "@radar/shared";
import { Button } from "../../shared/ds";

type Props = {
  channels: ChannelAdminItem[];
  activeBindingIds: Set<string>;
  busyBindingId: string | null;
  onLaunch: (bindingId: string) => void;
};

/** Список каналов с binding и кнопкой постановки backfill-job. */
export function BackfillChannelList({
  channels,
  activeBindingIds,
  busyBindingId,
  onLaunch,
}: Props) {
  const bound = channels.filter((c) => c.bindingId);

  if (bound.length === 0) {
    return <p className="ds-muted">Нет каналов с ingest-binding.</p>;
  }

  return (
    <ul className="ds-log-list" style={{ margin: 0 }}>
      {bound.map((ch) => {
        const bindingId = ch.bindingId!;
        const hasActive = activeBindingIds.has(bindingId);
        const busy = busyBindingId === bindingId;
        const label = ch.title?.trim() || ch.key;

        return (
          <li
            key={ch.id}
            className="ds-log-list__item"
            style={{ justifyContent: "space-between", gap: 8 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{label}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {ch.key}
                {ch.listening ? " · слушается" : ""}
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={hasActive || busy}
              title={hasActive ? "Уже есть активная задача" : undefined}
              onClick={() => onLaunch(bindingId)}
            >
              {busy ? "…" : "Докачать"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
