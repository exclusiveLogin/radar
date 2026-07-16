import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";

/**
 * Plan pending jobs для parse phases (RMQ ids → job_parse_phase).
 */
export class CoverageEnqueuer {
  constructor(
    private readonly coverage: IPhaseCoverageRepository,
    private readonly phases: IPhaseDefinitionRepository,
  ) {}

  /** Targeted plan после ingest/reparse — только указанные materializationIds. */
  async planPendingForIds(materializationIds: string[]): Promise<{ planned: number }> {
    if (materializationIds.length === 0) return { planned: 0 };
    const phases = await this.listAutoPhases();
    let planned = 0;
    for (const phase of phases) {
      const result = await this.coverage.planPendingForIds(phase.id, materializationIds);
      planned += result.planned;
    }
    return { planned };
  }

  /** При enable фазы — догон всех raw без done. */
  async catchUpPhase(phaseId: string): Promise<number> {
    const result = await this.coverage.enqueueCatchUp(phaseId);
    return result.enqueued;
  }

  /** Все enabled ingestParse (catalog/event/scheduled) — не только scheduled. */
  async listAutoPhases(): Promise<PhaseDefinitionRecord[]> {
    return this.phases.listEnabled(undefined, "ingestParse");
  }
}