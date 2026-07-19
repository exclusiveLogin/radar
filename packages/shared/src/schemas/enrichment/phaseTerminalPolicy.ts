/** Дефолт terminal-политики phase jobs: retries до terminal failed. */
export const DEFAULT_PHASE_TERMINAL_POLICY = {
  maxAttempts: 3,
  retryFailed: true,
} as const;
