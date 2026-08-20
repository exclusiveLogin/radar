/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Порт сброса шага: preview counts → apply mutation.
 * ---
 */

/** Контракт reset-адаптера шага (handler из step.resets.handler). */
export type StepResetPort = {
  preview(): Promise<Record<string, number>>;
  apply(): Promise<Record<string, number>>;
};
