/**
 * @deprecated Используйте appLogStore — единая лента UI для всего приложения.
 */
export {
  appLogEntries$ as geoMapLogEntries$,
  pushAppLog as pushGeoMapLog,
  clearAppLogs as clearGeoMapLogs,
  type AppLogLevel as GeoMapLogLevel,
  type AppLogEntry as GeoMapLogEntry,
} from "./appLogStore";
