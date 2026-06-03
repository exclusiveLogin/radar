/** Результат мутации фазы; dry-run возвращает planned без SQL. */
export type PhaseMutationResult = {
  phase: string;
  action: "wipe" | "reset" | "clear";
  dryRun: boolean;
  counts: Record<string, number>;
  notes?: string[];
};
