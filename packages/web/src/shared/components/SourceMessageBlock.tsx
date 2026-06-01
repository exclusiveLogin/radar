import { useEffect, useState } from "react";
import { mapApi } from "../api/mapApi";
import { formatDateTime } from "../format/dateTime";

type Props = {
  regionCode?: string;
  placeId?: string;
};

/** Оригинальный текст Telegram-сообщения, приведшего к текущему статусу региона/места. */
export function SourceMessageBlock({ regionCode, placeId }: Props) {
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const [postedAt, setPostedAt] = useState<string | null>(null);
  const [channelKey, setChannelKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = regionCode
      ? mapApi.regionSourceMessage(regionCode)
      : placeId
        ? mapApi.placeSourceMessage(placeId)
        : Promise.resolve({ message: null });

    void load
      .then((res) => {
        if (cancelled) return;
        const msg = res.message;
        setText(msg?.rawText ?? null);
        setPostedAt(msg?.postedAt ?? null);
        setChannelKey(msg?.channelKey ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [regionCode, placeId]);

  if (loading) return <p className="ds-muted">Загрузка сообщения…</p>;
  if (error) return <p className="ds-muted">{error}</p>;
  if (!text) return <p className="ds-muted">Исходное сообщение не найдено.</p>;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="ds-muted" style={{ fontSize: 11, marginBottom: 4 }}>
        {channelKey ? `@${channelKey} · ` : null}
        {formatDateTime(postedAt)}
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "inherit",
          fontSize: 12,
        }}
      >
        {text}
      </pre>
    </div>
  );
}
