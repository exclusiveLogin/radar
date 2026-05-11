import { healthResponseSchema, type HealthResponse } from "@radar/shared";
import { useEffect, useState } from "react";

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const parsed = healthResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Ответ API не совпал со схемой: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
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
