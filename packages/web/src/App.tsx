import { healthResponseSchema, type HealthResponse } from "@radar/shared";
import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return r.json() as unknown;
      })
      .then((json) => {
        const parsed = healthResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(
            `Ответ API не совпал со схемой: ${parsed.error.message}`,
          );
        }
        setHealth(parsed.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="page">
      <h1>Radar</h1>
      <p className="muted">Заглушка фронтенда: проверка API через прокси Vite.</p>
      {error && <p className="err">Ошибка: {error}</p>}
      {health && (
        <pre className="box">{JSON.stringify(health, null, 2)}</pre>
      )}
    </main>
  );
}
