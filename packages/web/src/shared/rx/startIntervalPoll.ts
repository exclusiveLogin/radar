import { interval, type Subscription } from "rxjs";

/**
 * REST poll в сторах: немедленный вызов + interval(periodMs).
 * SSOT вместо setInterval в packages/web.
 */
export function startIntervalPoll(
  periodMs: number,
  task: () => void | Promise<void>,
): Subscription {
  void task();
  return interval(periodMs).subscribe(() => void task());
}
