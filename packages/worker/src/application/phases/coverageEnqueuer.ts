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
    const [eager, scheduled] = await Promise.all([
      this.phases.listEnabled("eager"),
      this.phases.listEnabled("scheduled"),
    ]);
    for (const phase of [...eager, ...scheduled]) {
      await this.coverage.enqueuePending({ rawMessageId, phaseId: phase.id });
    }
  }

  /** При enable фазы — догон всех raw без done. */
  async catchUpPhase(phaseId: string): Promise<number> {
    const result = await this.coverage.enqueueCatchUp(phaseId);
    return result.enqueued;
  }

  async listAutoPhases(): Promise<PhaseDefinitionRecord[]> {
    const [eager, scheduled] = await Promise.all([
      this.phases.listEnabled("eager"),
      this.phases.listEnabled("scheduled"),
    ]);
    return [...eager, ...scheduled];
  }
}
