import { interval, type Subscription } from "rxjs";

/**
 * REST poll в сторах: немедленный вызов + interval(periodMs).
 * SSOT вместо setInterval в packages/web.
 */
export function startIntervalPoll(
  periodMs: number,
  task: () => void | Promise<void>,
): Subscription {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await task();
    } finally {
      running = false;
    }
  };

  void run();
  return interval(periodMs).subscribe(() => void run());
}
