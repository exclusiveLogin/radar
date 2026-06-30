import { Injectable } from "@nestjs/common";

/**
 * In-process gate: во время reset/rebuild map read L1 не стартует новых SELECT.
 * Снижает AccessShareLock на trajectory_* без pg_terminate_backend по пулу API.
 */
@Injectable()
export class TrackingL1ResetGate {
  private paused = false;

  /** Активен ли сброс L1 (TRUNCATE / soft rebuild). */
  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }
}
