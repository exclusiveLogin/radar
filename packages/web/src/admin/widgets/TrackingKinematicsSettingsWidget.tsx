import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
  DEFAULT_SEED_MIN,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  type ThreatProfile,
  type TrackingPipelineConfig,
} from "@radar/shared";
import { Button, Field, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { refreshTrackingStatus, trackingStatus$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";

const PROFILES: ThreatProfile[] = ["uav", "rocket", "balloon"];

const PROFILE_LABEL: Record<ThreatProfile, string> = {
  uav: "БПЛА",
  rocket: "Ракета",
  balloon: "МВШ",
  unknown: "Неизв.",
};

type KinematicsForm = {
  maxVelocityMs: string;
  maxLinkDistanceM: string;
  maxGapMs: string;
  stdbscanEpsilonSpatialM: string;
  stdbscanEpsilonTemporalMs: string;
  processNoiseScale: string;
  observationSigmaScale: string;
  chi2Threshold: string;
  rearThresholdM: string;
};

function effectiveToForm(
  profile: ThreatProfile,
  overrides?: TrackingPipelineConfig["profiles"],
): KinematicsForm {
  const k = resolveProfileKinematics(profile, overrides);
  return {
    maxVelocityMs: String(k.maxVelocityMs),
    maxLinkDistanceM: String(k.maxLinkDistanceM),
    maxGapMs: String(k.maxGapMs),
    stdbscanEpsilonSpatialM: String(k.stdbscanEpsilonSpatialM),
    stdbscanEpsilonTemporalMs: String(k.stdbscanEpsilonTemporalMs),
    processNoiseScale: String(k.processNoiseScale),
    observationSigmaScale: String(k.observationSigmaScale),
    chi2Threshold: String(k.chi2Threshold),
    rearThresholdM: String(k.rearThresholdM),
  };
}

function formToOverrides(
  profile: ThreatProfile,
  form: KinematicsForm,
): Partial<typeof PROFILE_KINEMATICS.uav> {
  const defaults = PROFILE_KINEMATICS[profile];
  const num = (v: string) => Number(v);
  const patch: Partial<typeof PROFILE_KINEMATICS.uav> = {};

  const fields: Array<keyof KinematicsForm> = [
    "maxVelocityMs",
    "maxLinkDistanceM",
    "maxGapMs",
    "stdbscanEpsilonSpatialM",
    "stdbscanEpsilonTemporalMs",
    "processNoiseScale",
    "observationSigmaScale",
    "chi2Threshold",
    "rearThresholdM",
  ];

  for (const key of fields) {
    if (num(form[key]) !== defaults[key]) {
      (patch as Record<string, number>)[key] = num(form[key]);
    }
  }

  return patch;
}

/**
 * Сигнатура серверного конфига для текущего профиля.
 * Форма ре-синкается только при её изменении (profile switch / save),
 * а не на каждый polling-тик статуса — иначе правки затираются.
 */
function configSignature(
  profile: ThreatProfile,
  cfg?: TrackingPipelineConfig | null,
): string {
  return JSON.stringify({
    profile,
    batchSize: cfg?.batchSize,
    seedMin: cfg?.seedMin,
    seedMaxFrontDistanceKm: cfg?.seedMaxFrontDistanceKm,
    seedRegionFront: cfg?.seedRegionFront,
    seedRegionInteriorRf: cfg?.seedRegionInteriorRf,
    seedFrontProximityD0Km: cfg?.seedFrontProximityD0Km,
    override: cfg?.profiles?.[profile] ?? null,
  });
}

/** Overrides кинематики + Kalman gate per threatProfile. */
export function TrackingKinematicsSettingsWidget() {
  const status = useObservable(trackingStatus$, null);
  const [profile, setProfile] = useState<ThreatProfile>("uav");
  const [batchSize, setBatchSize] = useState("1000");
  const [seedMin, setSeedMin] = useState(String(DEFAULT_SEED_MIN));
  const [seedMaxFrontKm, setSeedMaxFrontKm] = useState(String(DEFAULT_SEED_MAX_FRONT_DISTANCE_KM));
  const [seedRegionFront, setSeedRegionFront] = useState(String(DEFAULT_SEED_WEIGHTS.regionFront));
  const [seedRegionInteriorRf, setSeedRegionInteriorRf] = useState(
    String(DEFAULT_SEED_WEIGHTS.regionInteriorRf),
  );
  const [seedFrontD0Km, setSeedFrontD0Km] = useState(
    String(DEFAULT_SEED_WEIGHTS.frontProximityD0Km),
  );
  const [form, setForm] = useState<KinematicsForm>(() => effectiveToForm("uav"));
  const [busy, setBusy] = useState(false);

  const syncedSigRef = useRef<string | null>(null);
  const cfg = status?.config;
  const profileOverrides = cfg?.profiles;

  // Ре-синк формы только при реальной смене серверного конфига/профиля.
  useEffect(() => {
    if (!cfg) return;
    const sig = configSignature(profile, cfg);
    if (sig === syncedSigRef.current) return;
    syncedSigRef.current = sig;
    setBatchSize(String(cfg.batchSize ?? 1000));
    setSeedMin(String(cfg.seedMin ?? DEFAULT_SEED_MIN));
    setSeedMaxFrontKm(String(cfg.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM));
    setSeedRegionFront(String(cfg.seedRegionFront ?? DEFAULT_SEED_WEIGHTS.regionFront));
    setSeedRegionInteriorRf(String(cfg.seedRegionInteriorRf ?? DEFAULT_SEED_WEIGHTS.regionInteriorRf));
    setSeedFrontD0Km(String(cfg.seedFrontProximityD0Km ?? DEFAULT_SEED_WEIGHTS.frontProximityD0Km));
    setForm(effectiveToForm(profile, profileOverrides));
  }, [cfg, profile, profileOverrides]);

  const defaults = useMemo(() => PROFILE_KINEMATICS[profile], [profile]);

  const setField = (key: keyof KinematicsForm, value: string): void => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const resetProfile = (): void => {
    setForm(effectiveToForm(profile));
    setSeedMin(String(DEFAULT_SEED_MIN));
    setSeedMaxFrontKm(String(DEFAULT_SEED_MAX_FRONT_DISTANCE_KM));
    setSeedRegionFront(String(DEFAULT_SEED_WEIGHTS.regionFront));
    setSeedRegionInteriorRf(String(DEFAULT_SEED_WEIGHTS.regionInteriorRf));
    setSeedFrontD0Km(String(DEFAULT_SEED_WEIGHTS.frontProximityD0Km));
  };

  const save = async () => {
    setBusy(true);
    try {
      const profilePatch = formToOverrides(profile, form);
      const saved = await adminApi.trackingPatchConfig({
        batchSize: Number(batchSize) || 1000,
        seedMin: Number(seedMin) || DEFAULT_SEED_MIN,
        seedMaxFrontDistanceKm: Number(seedMaxFrontKm) || DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
        seedRegionFront: Number(seedRegionFront) || DEFAULT_SEED_WEIGHTS.regionFront,
        seedRegionInteriorRf: Number(seedRegionInteriorRf) || DEFAULT_SEED_WEIGHTS.regionInteriorRf,
        seedFrontProximityD0Km: Number(seedFrontD0Km) || DEFAULT_SEED_WEIGHTS.frontProximityD0Km,
        profiles: { [profile]: profilePatch },
      });
      // Помечаем как синхронизированное, чтобы refresh не сбросил только что сохранённое.
      syncedSigRef.current = configSignature(profile, saved);
      await refreshTrackingStatus();
    } catch (e) {
      reportAppError("Настройки треков", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Кинематика и Kalman">
      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
        Профиль угрозы — автоматически при rebuild. Дефолты под OSINT/телегу: широкий R, χ²≈20–30,
        rear-front 20–50 км (не 500 м).
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {PROFILES.map(p => (
          <Button key={p} variant={profile === p ? "primary" : "ghost"} onClick={() => setProfile(p)}>
            {PROFILE_LABEL[p]}
          </Button>
        ))}
      </div>

      <Field label="Размер батча (все профили)">
        <input
          className="ds-input"
          type="number"
          value={batchSize}
          onChange={e => setBatchSize(e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>
        Зарождение трека (фронт → тыл)
      </p>
      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 6px", lineHeight: 1.4 }}>
        Новый трек стартует только у фронта (точка ближе порога к фронт-региону). Дальше цепь
        тянется вглубь, rear-front gate режет «обратный ток». Вес seed = Π коэффициентов:
        чем выше у фронта и ниже в тылу — тем меньше ложных зарождений в глубине РФ.
      </p>
      <div className="ds-form-row">
        <Field label={`Мин. вес seed (порог зарождения, деф. ${DEFAULT_SEED_MIN})`}>
          <input
            className="ds-input"
            type="number"
            value={seedMin}
            onChange={e => setSeedMin(e.target.value)}
          />
        </Field>
        <Field label={`Макс. дистанция до фронта для seed, км (деф. ${DEFAULT_SEED_MAX_FRONT_DISTANCE_KM})`}>
          <input
            className="ds-input"
            type="number"
            value={seedMaxFrontKm}
            onChange={e => setSeedMaxFrontKm(e.target.value)}
          />
        </Field>
      </div>

      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "8px 0 6px", lineHeight: 1.4 }}>
        Веса штрафа/буста по географии. Буст у фронта &gt; 1 поднимает вес; штраф в тылу &lt; 1
        гасит зарождение вглубь страны. D0 — на сколько км спадает буст близости к фронту.
      </p>
      <div className="ds-form-row">
        <Field label={`Буст веса у фронта, ×(деф. ${DEFAULT_SEED_WEIGHTS.regionFront})`}>
          <input
            className="ds-input"
            type="number"
            step="any"
            value={seedRegionFront}
            onChange={e => setSeedRegionFront(e.target.value)}
          />
        </Field>
        <Field label={`Штраф веса в тылу РФ, ×(деф. ${DEFAULT_SEED_WEIGHTS.regionInteriorRf})`}>
          <input
            className="ds-input"
            type="number"
            step="any"
            value={seedRegionInteriorRf}
            onChange={e => setSeedRegionInteriorRf(e.target.value)}
          />
        </Field>
      </div>
      <Field label={`Затухание близости к фронту D0, км (деф. ${DEFAULT_SEED_WEIGHTS.frontProximityD0Km})`}>
        <input
          className="ds-input"
          type="number"
          step="any"
          value={seedFrontD0Km}
          onChange={e => setSeedFrontD0Km(e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Линковка / ST-DBSCAN</p>

      <div className="ds-form-row" style={{ marginTop: 4 }}>
        <Field label={`Макс. скорость цели, м/с (деф. ${defaults.maxVelocityMs})`}>
          <input
            className="ds-input"
            type="number"
            value={form.maxVelocityMs}
            onChange={e => setField("maxVelocityMs", e.target.value)}
          />
        </Field>
        <Field label={`Макс. шаг линковки между точками, м (деф. ${defaults.maxLinkDistanceM})`}>
          <input
            className="ds-input"
            type="number"
            value={form.maxLinkDistanceM}
            onChange={e => setField("maxLinkDistanceM", e.target.value)}
          />
        </Field>
      </div>

      <div className="ds-form-row" style={{ marginTop: 8 }}>
        <Field label={`Макс. пауза в треке, мс (деф. ${defaults.maxGapMs})`}>
          <input
            className="ds-input"
            type="number"
            value={form.maxGapMs}
            onChange={e => setField("maxGapMs", e.target.value)}
          />
        </Field>
        <Field label={`Радиус дедупликации ST-DBSCAN, м (деф. ${defaults.stdbscanEpsilonSpatialM})`}>
          <input
            className="ds-input"
            type="number"
            value={form.stdbscanEpsilonSpatialM}
            onChange={e => setField("stdbscanEpsilonSpatialM", e.target.value)}
          />
        </Field>
      </div>

      <Field label={`Окно дедупликации ST-DBSCAN по времени, мс (деф. ${defaults.stdbscanEpsilonTemporalMs})`}>
        <input
          className="ds-input"
          type="number"
          value={form.stdbscanEpsilonTemporalMs}
          onChange={e => setField("stdbscanEpsilonTemporalMs", e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Kalman / innovation gate</p>

      <div className="ds-form-row">
        <Field label={`Доверие к прогнозу Q (выше → манёвреннее, деф. ${defaults.processNoiseScale})`}>
          <input
            className="ds-input"
            type="number"
            step="any"
            value={form.processNoiseScale}
            onChange={e => setField("processNoiseScale", e.target.value)}
          />
        </Field>
        <Field label={`Шум наблюдения R × (выше → шире эллипс, деф. ${defaults.observationSigmaScale})`}>
          <input
            className="ds-input"
            type="number"
            step="any"
            value={form.observationSigmaScale}
            onChange={e => setField("observationSigmaScale", e.target.value)}
          />
        </Field>
      </div>

      <div className="ds-form-row" style={{ marginTop: 8 }}>
        <Field label={`Порог линковки χ² (выше → допускает дальше, деф. ${defaults.chi2Threshold})`}>
          <input
            className="ds-input"
            type="number"
            step="any"
            value={form.chi2Threshold}
            onChange={e => setField("chi2Threshold", e.target.value)}
          />
        </Field>
        <Field label={`Отсечка движения назад, м (rear-front, деф. ${defaults.rearThresholdM})`}>
          <input
            className="ds-input"
            type="number"
            value={form.rearThresholdM}
            onChange={e => setField("rearThresholdM", e.target.value)}
          />
        </Field>
      </div>

      <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8 }}>
        После сохранения — <strong>Rebuild</strong>. R база всё ещё от precision/trust события;
        множитель только расширяет эллипс под телегу.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          Сохранить
        </Button>
        <Button variant="ghost" disabled={busy} onClick={resetProfile}>
          Сбросить к дефолту
        </Button>
      </div>
    </Panel>
  );
}

