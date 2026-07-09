/**
 * Колбэк tick от legacy-демона → obs write-path.
 */
export type ObsTickReporter = (metrics?: Record<string, unknown>) => void | Promise<void>;
