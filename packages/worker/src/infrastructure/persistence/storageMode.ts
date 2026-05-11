export enum WorkerStorageMode {
  Memory = "memory",
  Db = "db",
  Fs = "fs",
}

const workerStorageModeSet = new Set<string>(Object.values(WorkerStorageMode));

export function isWorkerStorageMode(value: string): value is WorkerStorageMode {
  return workerStorageModeSet.has(value);
}

export function resolveWorkerStorageMode(
  value: string | undefined,
  fallback: WorkerStorageMode = WorkerStorageMode.Memory,
): WorkerStorageMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (isWorkerStorageMode(normalized)) {
    return normalized;
  }
  return fallback;
}

export function resolveWorkerStorageModeFromEnv(): WorkerStorageMode {
  return resolveWorkerStorageMode(
    process.env.RADAR_STORAGE_MODE ?? process.env.RADAR_PERSISTENCE_MODE,
    WorkerStorageMode.Memory,
  );
}
