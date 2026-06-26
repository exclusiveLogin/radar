/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT коэффициентов типа события для seed/link весовой модели.
 * ---
 */

/** Коэффициенты участия типа в порождении трека и Kalman-correct. */
export type EventTypeCoeffs = {
  seedMult: number;
  kinematicMult: number;
  terminateOnAttach?: boolean;
};

/** Дефолты по плану phase-1c. */
export const EVENT_TYPE_COEFFICIENTS: Record<string, EventTypeCoeffs> = {
  fixation: { seedMult: 1.0, kinematicMult: 1.0 },
  danger: { seedMult: 0.65, kinematicMult: 0.85 },
  warning: { seedMult: 0.4, kinematicMult: 0.5 },
  mass_warning: { seedMult: 0.4, kinematicMult: 0.5 },
  pvo_work: { seedMult: 0, kinematicMult: 0 },
  pvo_report: { seedMult: 0, kinematicMult: 0 },
  intercept: { seedMult: 0, kinematicMult: 0, terminateOnAttach: true },
};

const DEFAULT_COEFFS: EventTypeCoeffs = { seedMult: 0.3, kinematicMult: 0.5 };

/** Коэффициенты для event_type; неизвестный тип — консервативный fallback. */
export function getEventTypeCoeffs(eventType: string): EventTypeCoeffs {
  return EVENT_TYPE_COEFFICIENTS[eventType] ?? DEFAULT_COEFFS;
}

/** Может ли тип породить новый трек (seedMult > 0). */
export function canSeedByEventType(eventType: string): boolean {
  return getEventTypeCoeffs(eventType).seedMult > 0;
}

/** Закрыть трек при attach (intercept). */
export function shouldTerminateOnAttach(eventType: string): boolean {
  return getEventTypeCoeffs(eventType).terminateOnAttach === true;
}
