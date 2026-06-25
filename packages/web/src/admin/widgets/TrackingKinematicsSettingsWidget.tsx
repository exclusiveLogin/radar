import { useEffect, useMemo, useState } from "react";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
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

/** Overrides кинематики + Kalman gate per threatProfile. */
export function TrackingKinematicsSettingsWidget() {
  const status = useObservable(trackingStatus$, null);
  const [profile, setProfile] = useState<ThreatProfile>("uav");
  const [batchSize, setBatchSize] = useState("1000");
  const [form, setForm] = useState<KinematicsForm>(() => effectiveToForm("uav"));
  const [busy, setBusy] = useState(false);

  const profileOverrides = status?.config?.profiles;

  useEffect(() => {
    const cfg = status?.config;
    if (!cfg) return;
    setBatchSize(String(cfg.batchSize ?? 1000));
    setForm(effectiveToForm(profile, profileOverrides));
  }, [status, profile, profileOverrides]);

  const defaults = useMemo(() => PROFILE_KINEMATICS[profile], [profile]);

  const setField = (key: keyof KinematicsForm, value: string): void => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const resetProfile = (): void => {
    setForm(effectiveToForm(profile));
  };

  const save = async () => {
    setBusy(true);
    try {
      const profilePatch = formToOverrides(profile, form);
      await adminApi.trackingPatchConfig({
        batchSize: Number(batchSize) || 1000,
        profiles: { [profile]: profilePatch },
      });
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
          min={100}
          max={5000}
          value={batchSize}
          onChange={e => setBatchSize(e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Линковка / ST-DBSCAN</p>

      <div className="ds-form-row" style={{ marginTop: 4 }}>
        <Field label={`Макс. скорость, м/с (деф. ${defaults.maxVelocityMs})`}>
          <input
            className="ds-input"
            type="number"
            min={1}
            value={form.maxVelocityMs}
            onChange={e => setField("maxVelocityMs", e.target.value)}
          />
        </Field>
        <Field label={`Макс. линковка, м (деф. ${defaults.maxLinkDistanceM})`}>
          <input
            className="ds-input"
            type="number"
            min={1}
            value={form.maxLinkDistanceM}
            onChange={e => setField("maxLinkDistanceM", e.target.value)}
          />
        </Field>
      </div>

      <div className="ds-form-row" style={{ marginTop: 8 }}>
        <Field label={`Макс. разрыв, мс (деф. ${defaults.maxGapMs})`}>
          <input
            className="ds-input"
            type="number"
            min={1}
            value={form.maxGapMs}
            onChange={e => setField("maxGapMs", e.target.value)}
          />
        </Field>
        <Field label={`ST-DBSCAN ε, м (деф. ${defaults.stdbscanEpsilonSpatialM})`}>
          <input
            className="ds-input"
            type="number"
            min={1}
            value={form.stdbscanEpsilonSpatialM}
            onChange={e => setField("stdbscanEpsilonSpatialM", e.target.value)}
          />
        </Field>
      </div>

      <Field label={`ST-DBSCAN ε время, мс (деф. ${defaults.stdbscanEpsilonTemporalMs})`}>
        <input
          className="ds-input"
          type="number"
          min={1}
          value={form.stdbscanEpsilonTemporalMs}
          onChange={e => setField("stdbscanEpsilonTemporalMs", e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Kalman / innovation gate</p>

      <div className="ds-form-row">
        <Field label={`Q processNoiseScale (деф. ${defaults.processNoiseScale})`}>
          <input
            className="ds-input"
            type="number"
            min={0.01}
            step={0.1}
            value={form.processNoiseScale}
            onChange={e => setField("processNoiseScale", e.target.value)}
          />
        </Field>
        <Field label={`R × observationSigmaScale (деф. ${defaults.observationSigmaScale})`}>
          <input
            className="ds-input"
            type="number"
            min={0.1}
            step={0.1}
            value={form.observationSigmaScale}
            onChange={e => setField("observationSigmaScale", e.target.value)}
          />
        </Field>
      </div>

      <div className="ds-form-row" style={{ marginTop: 8 }}>
        <Field label={`χ² порог Mahalanobis (деф. ${defaults.chi2Threshold})`}>
          <input
            className="ds-input"
            type="number"
            min={1}
            step={0.5}
            value={form.chi2Threshold}
            onChange={e => setField("chi2Threshold", e.target.value)}
          />
        </Field>
        <Field label={`Rear-front, м (деф. ${defaults.rearThresholdM})`}>
          <input
            className="ds-input"
            type="number"
            min={100}
            step={1000}
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
