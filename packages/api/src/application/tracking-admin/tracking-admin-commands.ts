import {
  trackingPipelineConfigSchema,
  type TrackingPipelineConfig,
} from "@radar/shared";

export type TrackingRebuildMode = "full_rebuild" | "soft_rebuild";
export type TrackingRunControl = "pause" | "resume" | "cancel";

/** Порт записи состояния tracking без привязки к Nest или TypeORM. */
export interface TrackingAdminCommandPort {
  readConfig(): Promise<TrackingPipelineConfig>;
  saveConfig(config: TrackingPipelineConfig): Promise<void>;
  countUnconsumedPipeline(): Promise<number>;
  findControllableRunId(): Promise<string | null>;
  isPipelineEnabled(): Promise<boolean>;
  createRun(mode: "incremental" | TrackingRebuildMode): Promise<string>;
  activateRun(runId: string): Promise<void>;
  setPipelineEnabled(enabled: boolean): Promise<void>;
  resetPipeline(): Promise<void>;
  getRunStatus(runId: string): Promise<string | null>;
  setRunPaused(runId: string, paused: boolean): Promise<void>;
  cancelRun(runId: string): Promise<void>;
}

/** Ошибка команды, которую transport-граница переводит в HTTP 400. */
export class TrackingAdminCommandError extends Error {}

/** Валидирует и сохраняет частичное изменение конфигурации пайплайна. */
export class PatchTrackingConfigUseCase {
  constructor(private readonly port: TrackingAdminCommandPort) {}

  async execute(body: unknown): Promise<TrackingPipelineConfig> {
    const patch = trackingPipelineConfigSchema.partial().parse(body);
    const current = await this.port.readConfig();
    const next = trackingPipelineConfigSchema.parse({
      ...current,
      ...patch,
      profiles: patch.profiles
        ? mergeProfileOverrides(current.profiles, patch.profiles)
        : current.profiles,
    });
    await this.port.saveConfig(next);
    return next;
  }
}

/** Включает пайплайн и создаёт run только при накопившейся работе. */
export class SetTrackingEnabledUseCase {
  constructor(private readonly port: TrackingAdminCommandPort) {}

  async execute(enabled: boolean): Promise<{ ok: true; enabled: boolean }> {
    await this.port.setPipelineEnabled(enabled);
    if (!enabled) return { ok: true, enabled };

    const remaining = await this.port.countUnconsumedPipeline();
    const activeRunId = await this.port.findControllableRunId();
    if (remaining === 0 || activeRunId) return { ok: true, enabled };

    const runId = await this.port.createRun("incremental");
    await this.port.activateRun(runId);
    return { ok: true, enabled };
  }
}

/** Запускает полную или мягкую пересборку после общего сброса L1. */
export class StartTrackingRebuildUseCase {
  constructor(private readonly port: TrackingAdminCommandPort) {}

  async execute(mode: TrackingRebuildMode): Promise<{ ok: true; runId: string }> {
    await this.port.resetPipeline();
    try {
      const runId = await this.port.createRun(mode);
      await this.port.activateRun(runId);
      return { ok: true, runId };
    } catch (error) {
      await this.port.setPipelineEnabled(true);
      throw error;
    }
  }
}

/** Сбрасывает L1 и очередь tracking без создания нового run. */
export class ResetTrackingPipelineUseCase {
  constructor(private readonly port: TrackingAdminCommandPort) {}

  async execute(): Promise<{ ok: true }> {
    await this.port.resetPipeline();
    return { ok: true };
  }
}

/** Управляет жизненным циклом активного rebuild run. */
export class ControlTrackingRunUseCase {
  constructor(private readonly port: TrackingAdminCommandPort) {}

  async execute(command: TrackingRunControl): Promise<{ ok: true }> {
    if (command === "pause") return this.pause();
    if (command === "resume") return this.resume();
    return this.cancel();
  }

  private async pause(): Promise<{ ok: true }> {
    const runId = await this.port.findControllableRunId() ?? await this.startIncrementalRun();
    await this.port.setRunPaused(runId, true);
    return { ok: true };
  }

  private async startIncrementalRun(): Promise<string> {
    if (!await this.port.isPipelineEnabled()) {
      throw new TrackingAdminCommandError("pipeline disabled");
    }
    const runId = await this.port.createRun("incremental");
    await this.port.activateRun(runId);
    return runId;
  }

  private async resume(): Promise<{ ok: true }> {
    const runId = await this.requireControllableRun("no pausable run");
    if (await this.port.getRunStatus(runId) !== "paused") {
      throw new TrackingAdminCommandError("run is not paused");
    }
    await this.port.setRunPaused(runId, false);
    return { ok: true };
  }

  private async cancel(): Promise<{ ok: true }> {
    const runId = await this.requireControllableRun("no active run");
    await this.port.cancelRun(runId);
    return { ok: true };
  }

  private async requireControllableRun(message: string): Promise<string> {
    const runId = await this.port.findControllableRunId();
    if (!runId) throw new TrackingAdminCommandError(message);
    return runId;
  }
}

function mergeProfileOverrides(
  current: TrackingPipelineConfig["profiles"],
  patch: NonNullable<TrackingPipelineConfig["profiles"]>,
): TrackingPipelineConfig["profiles"] {
  const merged = { ...current };
  for (const [key, profilePatch] of Object.entries(patch)) {
    const profile = key as keyof typeof patch;
    merged[profile] = { ...merged[profile], ...profilePatch };
  }
  return merged;
}
