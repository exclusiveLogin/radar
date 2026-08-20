import { Button, Panel } from "../../shared/ds";
import { AppLogList } from "../../shared/components/AppLogList";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  appLogEntries$,
  clearAppLogs,
} from "../../shared/state/appLogStore";

/**
 * Лента app-log в админке — обычная Panel, не floating overlay.
 */
export function AdminAppLogWidget() {
  const entries = useObservable(appLogEntries$, []);

  return (
    <Panel
      title="Системный лог"
      variant="glass"
      collapsible
      defaultCollapsed={false}
      persistenceKey="admin.app-log"
      actions={
        entries.length > 0 ? (
          <Button type="button" variant="ghost" onClick={() => clearAppLogs()}>
            Очистить
          </Button>
        ) : undefined
      }
    >
      <div className="admin-app-log" aria-live="polite">
        <AppLogList entries={entries} />
      </div>
    </Panel>
  );
}
