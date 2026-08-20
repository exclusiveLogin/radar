import type { ExecutorSnapshot, HostSnapshot } from "@radar/shared";

/** Исполнители process/thread, сгруппированные по host. */
export function ExecutorsPanel({
  hosts,
  executors,
}: {
  hosts: HostSnapshot[];
  executors: ExecutorSnapshot[];
}) {
  const processAndThreads = executors.filter((e) => e.kind === "process" || e.kind === "thread");
  if (processAndThreads.length === 0) {
    return <p className="ds-muted">Нет process/thread executors</p>;
  }

  const hostById = new Map(hosts.map((h) => [h.hostId, h]));
  const byHost = new Map<string, ExecutorSnapshot[]>();
  for (const executor of processAndThreads) {
    const list = byHost.get(executor.hostId) ?? [];
    list.push(executor);
    byHost.set(executor.hostId, list);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {[...byHost.entries()].map(([hostId, hostExecutors]) => {
        const host = hostById.get(hostId);
        const processes = hostExecutors.filter((e) => e.kind === "process");
        const threads = hostExecutors.filter((e) => e.kind === "thread");

        return (
          <section key={hostId} className="admin-phase-enrich-card">
            <div className="admin-phase-enrich-card__head">
              <span className="admin-phase-enrich-card__id">{hostId}</span>
              {host && <span className="ds-muted">{host.role}</span>}
            </div>

            {processes.length > 0 && (
              <ExecutorGroup title="process" items={processes} all={hostExecutors} />
            )}
            {threads.length > 0 && (
              <ExecutorGroup title="thread" items={threads} all={hostExecutors} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function ExecutorGroup({
  title,
  items,
  all,
}: {
  title: string;
  items: ExecutorSnapshot[];
  all: ExecutorSnapshot[];
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <h5 style={{ margin: "0 0 4px", fontSize: 12, color: "var(--text-muted)" }}>{title}</h5>
      <ul className="ds-log-list">
        {items.map((executor) => {
          const childThreads =
            executor.kind === "process"
              ? all.filter((e) => e.kind === "thread" && e.parentId === executor.executorId)
              : [];

          return (
            <li key={executor.executorId} className="ds-log-list__item" style={{ gap: 8 }}>
              <span>{executor.executorId}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{executor.status}</span>
              {childThreads.length > 0 && (
                <span style={{ fontSize: 12 }}>threads: {childThreads.length}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
