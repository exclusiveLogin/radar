import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";

/**
 * Ставит phase_coverage pending для новых raw и catch-up при включении фазы.
 */
export class CoverageEnqueuer {
  constructor(
    private readonly coverage: IPhaseCoverageRepository,
    private readonly phases: IPhaseDefinitionRepository,
  ) {}

  /** После ingest: pending для всех enabled eager + scheduled фаз. */
  async onNewRawMessage(rawMessageId: string): Promise<void> {
    const phases = await this.phases.listEnabled();
    const autoPhases = phases.filter(
      (p) => p.trigger === "eager" || p.trigger === "scheduled",
    );
    for (const phase of autoPhases) {
      await this.coverage.enqueuePending({ rawMessageId, phaseId: phase.id });
    }
  }

  /** При enable фазы — догон всех raw без done. */
  async catchUpPhase(phaseId: string): Promise<number> {
    const result = await this.coverage.enqueueCatchUp(phaseId);
    return result.enqueued;
  }

  async listAutoPhases(): Promise<PhaseDefinitionRecord[]> {
    const phases = await this.phases.listEnabled();
    return phases.filter((p) => p.trigger === "eager" || p.trigger === "scheduled");
  }
}
