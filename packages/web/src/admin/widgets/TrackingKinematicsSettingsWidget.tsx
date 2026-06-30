import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
  DEFAULT_SEED_MIN,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  DEFAULT_FLOW_ALIGNMENT,
  DEFAULT_GREEDY_FLOW,
  DEFAULT_MAGNETIZE_WEIGHTS,
  DEFAULT_MAGNET_COST_WEIGHTS,
  DEFAULT_TURN_PENALTY,
  type ThreatProfile,
  type TrackingPipelineConfig,
  type AssociationAlgorithm,
  type GreedyFlowWeights,
} from "@radar/shared";

/** Дефолты NextGen для UI (SSOT значений — zod-схема на сервере). */
type NextGenCfg = NonNullable<TrackingPipelineConfig["nextgen"]>;
const NEXTGEN_DEFAULTS: NextGenCfg = {
  h3Resolution: 8,
  gravityCenterMassThreshold: 5,
  kalmanLocusChi2Threshold: 5.99,
  minBackboneNodes: 3,
  turnPenaltyWeight: DEFAULT_TURN_PENALTY.penaltyWeight,
  maxTurnDeg: DEFAULT_TURN_PENALTY.maxTurnDeg,
  rflEnabled: true,
};
import { Button, Field, Panel } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import { adminApi } from "../../shared/api/adminApi";
import { refreshTrackingStatus, trackingStatus$ } from "../../shared/state/adminStore";
import { reportAppError } from "../../shared/state/appLogStore";
import { TRACKING_PARAM_HINTS as H } from "./trackingParamHints";

const PROFILES: ThreatProfile[] = ["uav", "rocket", "balloon"];

const PROFILE_LABEL: Record<ThreatProfile, string> = {
  uav: "БПЛА",
  rocket: "Ракета",
  balloon: "МВШ",
  unknown: "Неизв.",
};

/** Диапазоны слайдеров (согласованы со schema / доменом). */
const MULTIPLIER_MAX = 10;
const SCALE_MIN = 0.5;
const SCALE_MAX = 5;
const SEED_MIN_MAX = 1;
const SEED_MIN_SLIDER_MIN = 0.1;
const SEED_FRONT_KM_MIN = 50;
const SEED_FRONT_KM_MAX = 800;
const SEED_D0_KM_MIN = 10;
const SEED_D0_KM_MAX = 300;
const INTERIOR_PENALTY_MIN = 0.1;

type CoeffSliderProps = {
  label: string;
  title?: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  className?: string;
};

function formatSliderValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}

/** Слайдер коэффициента в стиле DS. */
function CoeffSlider({
  label,
  title,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  className,
}: CoeffSliderProps) {
  return (
    <div className={["ds-slider-field", className].filter(Boolean).join(" ")} title={title}>
      <div className="ds-slider-field__head">
        <span className="ds-slider-field__label">{label}</span>
        <span className="ds-slider-field__value">{formatSliderValue(value, step)}</span>
      </div>
      {hint ? <span className="ds-field__hint">{hint}</span> : null}
      <input
        type="range"
        className="ds-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <div className="ds-slider-field__scale">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

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
    seedMin: cfg?.seedMin,
    seedMaxFrontDistanceKm: cfg?.seedMaxFrontDistanceKm,
    seedRegionFront: cfg?.seedRegionFront,
    seedRegionInteriorRf: cfg?.seedRegionInteriorRf,
    seedFrontProximityD0Km: cfg?.seedFrontProximityD0Km,
    reuseAcrossTracks: cfg?.reuseAcrossTracks,
    associationAlgorithm: cfg?.associationAlgorithm,
    flowWeight: cfg?.flowWeight,
    counterFlowPenalty: cfg?.counterFlowPenalty,
    flowEmpiricalMultiplier: cfg?.flowEmpiricalMultiplier,
    globalDirectionWeight: cfg?.globalDirectionWeight,
    globalDirectionBearingDeg: cfg?.globalDirectionBearingDeg ?? null,
    counterFlowRejectCos: cfg?.counterFlowRejectCos ?? null,
    greedyFlow: cfg?.greedyFlow ?? null,
    nextgen: cfg?.nextgen ?? null,
    clusteringMode: cfg?.clusteringMode ?? "collapse",
    magnet: cfg?.magnet ?? null,
    override: cfg?.profiles?.[profile] ?? null,
  });
}

/** Overrides кинематики + Kalman gate per threatProfile. */
export function TrackingKinematicsSettingsWidget() {
  const status = useObservable(trackingStatus$, null);
  const [profile, setProfile] = useState<ThreatProfile>("uav");
  const [seedMin, setSeedMin] = useState(DEFAULT_SEED_MIN);
  const [seedMaxFrontKm, setSeedMaxFrontKm] = useState(DEFAULT_SEED_MAX_FRONT_DISTANCE_KM);
  const [seedRegionFront, setSeedRegionFront] = useState(DEFAULT_SEED_WEIGHTS.regionFront);
  const [seedRegionInteriorRf, setSeedRegionInteriorRf] = useState(
    DEFAULT_SEED_WEIGHTS.regionInteriorRf,
  );
  const [seedFrontD0Km, setSeedFrontD0Km] = useState(DEFAULT_SEED_WEIGHTS.frontProximityD0Km);
  const [reuseAcrossTracks, setReuseAcrossTracks] = useState(false);
  const [associationAlgorithm, setAssociationAlgorithm] = useState<AssociationAlgorithm>("gnn");
  const [flowWeight, setFlowWeight] = useState(DEFAULT_FLOW_ALIGNMENT.flowWeight);
  const [counterFlowPenalty, setCounterFlowPenalty] = useState(
    DEFAULT_FLOW_ALIGNMENT.counterFlowPenalty,
  );
  const [flowEmpiricalMultiplier, setFlowEmpiricalMultiplier] = useState(
    DEFAULT_FLOW_ALIGNMENT.flowEmpiricalMultiplier,
  );
  const [globalDirectionWeight, setGlobalDirectionWeight] = useState(
    DEFAULT_FLOW_ALIGNMENT.globalDirectionWeight ?? 0,
  );
  const [globalDirectionBearingDeg, setGlobalDirectionBearingDeg] = useState(
    DEFAULT_FLOW_ALIGNMENT.globalDirectionBearingDeg ?? 45,
  );
  const [globalDirectionEnabled, setGlobalDirectionEnabled] = useState(
    (DEFAULT_FLOW_ALIGNMENT.globalDirectionBearingDeg ?? null) != null
      && (DEFAULT_FLOW_ALIGNMENT.globalDirectionWeight ?? 0) > 0,
  );
  // Жёсткий запрет противотока: enabled-флаг + порог cos (хранится как null при выкл).
  const [counterFlowRejectEnabled, setCounterFlowRejectEnabled] = useState(false);
  const [counterFlowRejectCos, setCounterFlowRejectCos] = useState(-0.2);
  // Веса жадной ассоциации (greedy-flow).
  const [greedyFlow, setGreedyFlow] = useState<GreedyFlowWeights>(DEFAULT_GREEDY_FLOW);
  const [nextgen, setNextgen] = useState<NextGenCfg>(NEXTGEN_DEFAULTS);
  const [clusteringMode, setClusteringMode] = useState<"collapse" | "magnet">("collapse");
  const [magnetWMag, setMagnetWMag] = useState(DEFAULT_MAGNET_COST_WEIGHTS.wMag);
  const [magnetWFlow, setMagnetWFlow] = useState(DEFAULT_MAGNET_COST_WEIGHTS.wFlow);
  const [lambdaCloud, setLambdaCloud] = useState(DEFAULT_MAGNETIZE_WEIGHTS.lambdaCloud);
  const [lambdaHist, setLambdaHist] = useState(DEFAULT_MAGNETIZE_WEIGHTS.lambdaHist);
  const [useHistoricalGravity, setUseHistoricalGravity] = useState(
    DEFAULT_MAGNETIZE_WEIGHTS.useHistoricalGravity,
  );
  const [geohashPrecision, setGeohashPrecision] = useState(
    DEFAULT_MAGNETIZE_WEIGHTS.geohashPrecision,
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
    setSeedMin(cfg.seedMin ?? DEFAULT_SEED_MIN);
    setSeedMaxFrontKm(cfg.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM);
    setSeedRegionFront(cfg.seedRegionFront ?? DEFAULT_SEED_WEIGHTS.regionFront);
    setSeedRegionInteriorRf(cfg.seedRegionInteriorRf ?? DEFAULT_SEED_WEIGHTS.regionInteriorRf);
    setSeedFrontD0Km(cfg.seedFrontProximityD0Km ?? DEFAULT_SEED_WEIGHTS.frontProximityD0Km);
    setReuseAcrossTracks(cfg.reuseAcrossTracks ?? false);
    setAssociationAlgorithm(cfg.associationAlgorithm ?? "gnn");
    setFlowWeight(cfg.flowWeight ?? DEFAULT_FLOW_ALIGNMENT.flowWeight);
    setCounterFlowPenalty(cfg.counterFlowPenalty ?? DEFAULT_FLOW_ALIGNMENT.counterFlowPenalty);
    setFlowEmpiricalMultiplier(
      cfg.flowEmpiricalMultiplier ?? DEFAULT_FLOW_ALIGNMENT.flowEmpiricalMultiplier,
    );
    const globalW = cfg.globalDirectionWeight ?? DEFAULT_FLOW_ALIGNMENT.globalDirectionWeight ?? 0;
    const globalBearing = cfg.globalDirectionBearingDeg ?? DEFAULT_FLOW_ALIGNMENT.globalDirectionBearingDeg ?? 45;
    setGlobalDirectionWeight(globalW);
    setGlobalDirectionBearingDeg(globalBearing);
    setGlobalDirectionEnabled((cfg.globalDirectionBearingDeg ?? null) != null && globalW > 0);
    const rejCos = cfg.counterFlowRejectCos ?? null;
    setCounterFlowRejectEnabled(rejCos != null);
    setCounterFlowRejectCos(rejCos ?? -0.2);
    setGreedyFlow({ ...DEFAULT_GREEDY_FLOW, ...(cfg.greedyFlow ?? {}) });
    setNextgen({ ...NEXTGEN_DEFAULTS, ...(cfg.nextgen ?? {}) });
    setClusteringMode(cfg.clusteringMode ?? "collapse");
    const m = cfg.magnet;
    setMagnetWMag(m?.wMag ?? DEFAULT_MAGNET_COST_WEIGHTS.wMag);
    setMagnetWFlow(m?.wFlow ?? DEFAULT_MAGNET_COST_WEIGHTS.wFlow);
    setLambdaCloud(m?.lambdaCloud ?? DEFAULT_MAGNETIZE_WEIGHTS.lambdaCloud);
    setLambdaHist(m?.lambdaHist ?? DEFAULT_MAGNETIZE_WEIGHTS.lambdaHist);
    setUseHistoricalGravity(m?.useHistoricalGravity ?? DEFAULT_MAGNETIZE_WEIGHTS.useHistoricalGravity);
    setGeohashPrecision(m?.geohashPrecision ?? DEFAULT_MAGNETIZE_WEIGHTS.geohashPrecision);
    setForm(effectiveToForm(profile, profileOverrides));
  }, [cfg, profile, profileOverrides]);

  const defaults = useMemo(() => PROFILE_KINEMATICS[profile], [profile]);

  const setField = (key: keyof KinematicsForm, value: string): void => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const resetProfile = (): void => {
    setForm(effectiveToForm(profile));
    setSeedMin(DEFAULT_SEED_MIN);
    setSeedMaxFrontKm(DEFAULT_SEED_MAX_FRONT_DISTANCE_KM);
    setSeedRegionFront(DEFAULT_SEED_WEIGHTS.regionFront);
    setSeedRegionInteriorRf(DEFAULT_SEED_WEIGHTS.regionInteriorRf);
    setSeedFrontD0Km(DEFAULT_SEED_WEIGHTS.frontProximityD0Km);
    setReuseAcrossTracks(false);
    setAssociationAlgorithm("gnn");
    setFlowWeight(DEFAULT_FLOW_ALIGNMENT.flowWeight);
    setCounterFlowPenalty(DEFAULT_FLOW_ALIGNMENT.counterFlowPenalty);
    setFlowEmpiricalMultiplier(DEFAULT_FLOW_ALIGNMENT.flowEmpiricalMultiplier);
    setGlobalDirectionWeight(DEFAULT_FLOW_ALIGNMENT.globalDirectionWeight ?? 0);
    setGlobalDirectionBearingDeg(DEFAULT_FLOW_ALIGNMENT.globalDirectionBearingDeg ?? 45);
    setGlobalDirectionEnabled(
      (DEFAULT_FLOW_ALIGNMENT.globalDirectionBearingDeg ?? null) != null
      && (DEFAULT_FLOW_ALIGNMENT.globalDirectionWeight ?? 0) > 0,
    );
    setCounterFlowRejectEnabled(false);
    setCounterFlowRejectCos(-0.2);
    setGreedyFlow(DEFAULT_GREEDY_FLOW);
    setNextgen(NEXTGEN_DEFAULTS);
    setClusteringMode("collapse");
    setMagnetWMag(DEFAULT_MAGNET_COST_WEIGHTS.wMag);
    setMagnetWFlow(DEFAULT_MAGNET_COST_WEIGHTS.wFlow);
    setLambdaCloud(DEFAULT_MAGNETIZE_WEIGHTS.lambdaCloud);
    setLambdaHist(DEFAULT_MAGNETIZE_WEIGHTS.lambdaHist);
    setUseHistoricalGravity(DEFAULT_MAGNETIZE_WEIGHTS.useHistoricalGravity);
    setGeohashPrecision(DEFAULT_MAGNETIZE_WEIGHTS.geohashPrecision);
  };

  const save = async () => {
    setBusy(true);
    try {
      const profilePatch = formToOverrides(profile, form);
      const saved = await adminApi.trackingPatchConfig({
        seedMin,
        seedMaxFrontDistanceKm: seedMaxFrontKm,
        seedRegionFront,
        seedRegionInteriorRf,
        seedFrontProximityD0Km: seedFrontD0Km,
        reuseAcrossTracks,
        associationAlgorithm,
        flowWeight,
        counterFlowPenalty,
        flowEmpiricalMultiplier,
        globalDirectionWeight: globalDirectionEnabled ? globalDirectionWeight : 0,
        globalDirectionBearingDeg: globalDirectionEnabled ? globalDirectionBearingDeg : null,
        counterFlowRejectCos: counterFlowRejectEnabled ? counterFlowRejectCos : null,
        greedyFlow,
        nextgen,
        clusteringMode,
        magnet: {
          wMag: magnetWMag,
          wFlow: magnetWFlow,
          lambdaCloud,
          lambdaHist,
          useHistoricalGravity,
          geohashPrecision,
        },
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

      <div className="ds-subpanel">
        <p className="ds-subpanel__title">Зарождение трека</p>
        <p className="ds-subpanel__hint">
          Seed только у фронта. Вес = Π множителей: буст у фронта &gt; 1, штраф в тылу &lt; 1.
        </p>
        <div className="ds-slider-grid">
          <CoeffSlider
            label={`Порог seed (деф. ${DEFAULT_SEED_MIN})`}
            title="Минимальный вес для зарождения нового трека."
            hint={H.seedMin}
            value={seedMin}
            min={SEED_MIN_SLIDER_MIN}
            max={SEED_MIN_MAX}
            step={0.01}
            onChange={setSeedMin}
          />
          <CoeffSlider
            label={`Макс. дистанция до фронта, км (деф. ${DEFAULT_SEED_MAX_FRONT_DISTANCE_KM})`}
            title="Дальше от фронта — seed не создаётся."
            hint={H.seedMaxFrontKm}
            value={seedMaxFrontKm}
            min={SEED_FRONT_KM_MIN}
            max={SEED_FRONT_KM_MAX}
            step={10}
            onChange={setSeedMaxFrontKm}
          />
          <CoeffSlider
            label={`Буст у фронта × (деф. ${DEFAULT_SEED_WEIGHTS.regionFront})`}
            title="Множитель веса в фронтовом регионе. 1 — нейтрально."
            hint={H.seedRegionFront}
            value={seedRegionFront}
            min={1}
            max={MULTIPLIER_MAX}
            step={0.05}
            onChange={setSeedRegionFront}
          />
          <CoeffSlider
            label={`Штраф в тылу × (деф. ${DEFAULT_SEED_WEIGHTS.regionInteriorRf})`}
            title="Множитель в глубине РФ. 1 — без штрафа, меньше — сильнее гасит seed."
            hint={H.seedRegionInteriorRf}
            value={seedRegionInteriorRf}
            min={INTERIOR_PENALTY_MIN}
            max={1}
            step={0.05}
            onChange={setSeedRegionInteriorRf}
          />
          <CoeffSlider
            className="ds-slider-grid__full"
            label={`Затухание близости D0, км (деф. ${DEFAULT_SEED_WEIGHTS.frontProximityD0Km})`}
            title="На какой дистанции от фронта спадает буст близости."
            hint={H.seedFrontD0Km}
            value={seedFrontD0Km}
            min={SEED_D0_KM_MIN}
            max={SEED_D0_KM_MAX}
            step={5}
            onChange={setSeedFrontD0Km}
          />
        </div>
      </div>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Ассоциация</p>
      <Field label="Алгоритм ассоциации" hint={H.associationAlgorithm}>
        <select
          className="ds-input"
          value={associationAlgorithm}
          onChange={e => setAssociationAlgorithm(e.target.value as AssociationAlgorithm)}
        >
          <option value="gnn">GNN (жадный argmin ρ)</option>
          <option value="greedy-flow">Greedy-flow (пары по току, монотонная глубина)</option>
          <option value="nextgen-gravity">NextGen Gravity (4-Phase H3 + RFL)</option>
          <option value="pdaf">PDAF (backlog)</option>
          <option value="jpdaf">JPDAF (backlog)</option>
        </select>
      </Field>
      {associationAlgorithm === "greedy-flow" && (
        <div className="ds-subpanel">
          <p className="ds-subpanel__title">Greedy-flow: веса и допуски</p>
          <p className="ds-subpanel__hint">
            Соединяет пары по току. cost = dist·w₁ + dt·w₂ − align·w₃; глубина монотонна (поздняя точка глубже на −ε).
          </p>
          <div className="ds-form-row" style={{ marginTop: 4 }}>
            <Field label={`Вес дистанции (деф. ${DEFAULT_GREEDY_FLOW.distWeightM})`} hint={H.greedyDist}>
              <input
                className="ds-input"
                type="number"
                value={greedyFlow.distWeightM}
                onChange={e => setGreedyFlow(g => ({ ...g, distWeightM: Number(e.target.value) }))}
              />
            </Field>
            <Field label={`Штраф разрыва, м/ч (деф. ${DEFAULT_GREEDY_FLOW.dtPenaltyPerHourM})`} hint={H.greedyDt}>
              <input
                className="ds-input"
                type="number"
                value={greedyFlow.dtPenaltyPerHourM}
                onChange={e => setGreedyFlow(g => ({ ...g, dtPenaltyPerHourM: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="ds-form-row" style={{ marginTop: 4 }}>
            <Field label={`Награда за ток, м (деф. ${DEFAULT_GREEDY_FLOW.flowAlignRewardM})`} hint={H.greedyFlowReward}>
              <input
                className="ds-input"
                type="number"
                value={greedyFlow.flowAlignRewardM}
                onChange={e => setGreedyFlow(g => ({ ...g, flowAlignRewardM: Number(e.target.value) }))}
              />
            </Field>
            <Field label={`Допуск глубины ε, м (деф. ${DEFAULT_GREEDY_FLOW.depthToleranceM})`} hint={H.greedyDepthTol}>
              <input
                className="ds-input"
                type="number"
                value={greedyFlow.depthToleranceM}
                onChange={e => setGreedyFlow(g => ({ ...g, depthToleranceM: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field
            label={`Жёсткий gate против тока, cos (−1..1; пусто=выкл, деф. ${DEFAULT_GREEDY_FLOW.counterFlowRejectCos})`}
            hint={H.greedyCounterCos}
          >
            <input
              className="ds-input"
              type="number"
              step={0.05}
              value={greedyFlow.counterFlowRejectCos ?? ""}
              onChange={e =>
                setGreedyFlow(g => ({
                  ...g,
                  counterFlowRejectCos: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </Field>
        </div>
      )}
      {associationAlgorithm === "nextgen-gravity" && (
        <div className="ds-subpanel">
          <p className="ds-subpanel__title">NextGen: гравитация и гладкость трасс</p>
          <p className="ds-subpanel__hint">
            Магистрали тянутся по тяжёлым H3-коридорам; штраф за поворот не даёт лучам разбегаться из хабов.
          </p>
          <div className="ds-form-row" style={{ marginTop: 4 }}>
            <Field
              label={`Штраф за поворот (деф. ${DEFAULT_TURN_PENALTY.penaltyWeight}; 0 = выкл)`}
              hint={H.nextgenTurnPenalty}
            >
              <input
                className="ds-input"
                type="number"
                step={0.5}
                min={0}
                max={10}
                value={nextgen.turnPenaltyWeight}
                onChange={e => setNextgen(n => ({ ...n, turnPenaltyWeight: Number(e.target.value) }))}
              />
            </Field>
            <Field
              label={`Макс. поворот, ° (деф. ${DEFAULT_TURN_PENALTY.maxTurnDeg})`}
              hint={H.nextgenMaxTurnDeg}
            >
              <input
                className="ds-input"
                type="number"
                step={5}
                min={0}
                max={180}
                value={nextgen.maxTurnDeg}
                onChange={e => setNextgen(n => ({ ...n, maxTurnDeg: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field
            label={`Мин. нод для магистрали (деф. ${NEXTGEN_DEFAULTS.minBackboneNodes}; иначе пунктир)`}
            hint={H.nextgenMinBackbone}
          >
            <input
              className="ds-input"
              type="number"
              step={1}
              min={2}
              max={10}
              value={nextgen.minBackboneNodes}
              onChange={e => setNextgen(n => ({ ...n, minBackboneNodes: Number(e.target.value) }))}
            />
          </Field>
        </div>
      )}
      <label
        style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, marginBottom: 8 }}
        title={H.reuseAcrossTracks}
      >
        <input
          type="checkbox"
          checked={reuseAcrossTracks}
          onChange={e => setReuseAcrossTracks(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          Переиспользовать точки в нескольких треках (fan-out in-locus)
          <span className="ds-field__hint" style={{ display: "block", marginTop: 2 }}>
            {H.reuseAcrossTracks}
          </span>
        </span>
      </label>

      <div className="ds-subpanel">
        <p className="ds-subpanel__title">Направленность</p>
        <p className="ds-subpanel__hint">
          Множитель ρ&apos; по направлению шага. Ток A — front_distance; B — P2P-коридор (count × множитель).
        </p>
        <div className="ds-slider-grid">
          <CoeffSlider
            label={`Сила бонуса по току γ (деф. ${DEFAULT_FLOW_ALIGNMENT.flowWeight})`}
            title="1 — умеренный эффект; 0 — выкл. Шаг по току дешевле для линковки."
            hint={H.flowWeight}
            value={flowWeight}
            min={0}
            max={MULTIPLIER_MAX}
            step={0.1}
            onChange={setFlowWeight}
          />
          <CoeffSlider
            label={`Сила штрафа противотока γ (деф. ${DEFAULT_FLOW_ALIGNMENT.counterFlowPenalty})`}
            title="1 — умеренный эффект; 0 — выкл. Шаг против тока дороже для линковки."
            hint={H.counterFlowPenalty}
            value={counterFlowPenalty}
            min={0}
            max={MULTIPLIER_MAX}
            step={0.1}
            onChange={setCounterFlowPenalty}
          />
          <CoeffSlider
            className="ds-slider-grid__full"
            label={`Множитель коридора (деф. ${DEFAULT_FLOW_ALIGNMENT.flowEmpiricalMultiplier})`}
            title="Сила B = count × множитель. 1 — нейтрально; 0 — только гео-ток A."
            hint={H.flowEmpirical}
            value={flowEmpiricalMultiplier}
            min={0}
            max={MULTIPLIER_MAX}
            step={0.1}
            onChange={setFlowEmpiricalMultiplier}
          />
        </div>
        <label
          style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, margin: "10px 0 4px" }}
          title={H.globalDirectionWeight}
        >
          <input
            type="checkbox"
            checked={globalDirectionEnabled}
            onChange={e => setGlobalDirectionEnabled(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            Глобальный directional-bias (доп. cos-компонента направления)
            <span className="ds-field__hint" style={{ display: "block", marginTop: 2 }}>
              {H.globalDirectionWeight}
            </span>
          </span>
        </label>
        {globalDirectionEnabled && (
          <div className="ds-slider-grid">
            <CoeffSlider
              label="Сила глобального bias γ_global"
              title="Мягкий приоритет общего направления поверх A/B. 0.2–0.8 обычно достаточно."
              hint={H.globalDirectionWeight}
              value={globalDirectionWeight}
              min={0}
              max={2}
              step={0.05}
              onChange={setGlobalDirectionWeight}
            />
            <CoeffSlider
              label="Глобальный азимут, ° (0=С, 90=В)"
              title="Опорное направление глобального bias."
              hint={H.globalDirectionBearingDeg}
              value={globalDirectionBearingDeg}
              min={0}
              max={360}
              step={1}
              onChange={setGlobalDirectionBearingDeg}
            />
          </div>
        )}
        <label
          style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, margin: "10px 0 4px" }}
          title={H.counterFlowReject}
        >
          <input
            type="checkbox"
            checked={counterFlowRejectEnabled}
            onChange={e => setCounterFlowRejectEnabled(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            Жёсткий запрет противотока (шаг к фронту/Украине отклоняется)
            <span className="ds-field__hint" style={{ display: "block", marginTop: 2 }}>
              {H.counterFlowReject}
            </span>
          </span>
        </label>
        {counterFlowRejectEnabled && (
          <div className="ds-slider-grid">
            <CoeffSlider
              className="ds-slider-grid__full"
              label="Порог cos∠(шаг, ток) (−0.2 — допуск бокового дрейфа; 0 — строго вглубь)"
              title="Линк отклоняется при cos < порога. Меньше — строже к фронту."
              hint={H.counterFlowRejectCos}
              value={counterFlowRejectCos}
              min={-1}
              max={1}
              step={0.05}
              onChange={setCounterFlowRejectCos}
            />
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Линковка / ST-DBSCAN</p>

      <Field label="Режим кластеризации" hint={H.clusteringMode}>
        <select
          className="ds-input"
          value={clusteringMode}
          onChange={e => setClusteringMode(e.target.value as "collapse" | "magnet")}
        >
          <option value="collapse">Collapse (legacy dedup — один winner)</option>
          <option value="magnet">Magnet (веса без схлопывания)</option>
        </select>
      </Field>

      {clusteringMode === "magnet" && (
        <div className="ds-subpanel">
          <p className="ds-subpanel__title">Магнитная фаза</p>
          <p className="ds-subpanel__hint">
            Магнетизм в cost всех алгоритмов. При fan-out (reuse) спутники остаются лучами; без reuse — свёртка в clusterMass winner.
          </p>
          <div className="ds-slider-grid">
            <CoeffSlider
              label={`wMag — сила магнетизма (деф. ${DEFAULT_MAGNET_COST_WEIGHTS.wMag})`}
              hint={H.magnetWMag}
              value={magnetWMag}
              min={0}
              max={MULTIPLIER_MAX}
              step={0.1}
              onChange={setMagnetWMag}
            />
            <CoeffSlider
              label={`wFlow — доп. бонус прямотока (деф. ${DEFAULT_MAGNET_COST_WEIGHTS.wFlow})`}
              hint={H.magnetWFlow}
              value={magnetWFlow}
              min={0}
              max={MULTIPLIER_MAX}
              step={0.1}
              onChange={setMagnetWFlow}
            />
            <CoeffSlider
              label={`λ_cloud — плотность облака (деф. ${DEFAULT_MAGNETIZE_WEIGHTS.lambdaCloud})`}
              hint={H.lambdaCloud}
              value={lambdaCloud}
              min={0}
              max={MULTIPLIER_MAX}
              step={0.05}
              onChange={setLambdaCloud}
            />
            <CoeffSlider
              label={`λ_hist — история места (деф. ${DEFAULT_MAGNETIZE_WEIGHTS.lambdaHist})`}
              hint={H.lambdaHist}
              value={lambdaHist}
              min={0}
              max={MULTIPLIER_MAX}
              step={0.05}
              onChange={setLambdaHist}
            />
            <Field label={`Geohash precision (деф. ${DEFAULT_MAGNETIZE_WEIGHTS.geohashPrecision})`} hint={H.geohashPrecision}>
              <input
                className="ds-input"
                type="number"
                min={3}
                max={10}
                value={geohashPrecision}
                onChange={e => setGeohashPrecision(Number(e.target.value))}
              />
            </Field>
          </div>
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, marginTop: 8 }}
            title={H.useHistoricalGravity}
          >
            <input
              type="checkbox"
              checked={useHistoricalGravity}
              onChange={e => setUseHistoricalGravity(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Историческая гравитация мест (pre-pass + heatmap)
              <span className="ds-field__hint" style={{ display: "block", marginTop: 2 }}>
                {H.useHistoricalGravity}
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="ds-form-row" style={{ marginTop: 4 }}>
        <Field label={`Макс. скорость цели, м/с (деф. ${defaults.maxVelocityMs})`} hint={H.maxVelocityMs}>
          <input
            className="ds-input"
            type="number"
            value={form.maxVelocityMs}
            onChange={e => setField("maxVelocityMs", e.target.value)}
          />
        </Field>
        <Field label={`Макс. шаг линковки между точками, м (деф. ${defaults.maxLinkDistanceM})`} hint={H.maxLinkDistanceM}>
          <input
            className="ds-input"
            type="number"
            value={form.maxLinkDistanceM}
            onChange={e => setField("maxLinkDistanceM", e.target.value)}
          />
        </Field>
      </div>

      <div className="ds-form-row" style={{ marginTop: 8 }}>
        <Field label={`Макс. пауза в треке, мс (деф. ${defaults.maxGapMs})`} hint={H.maxGapMs}>
          <input
            className="ds-input"
            type="number"
            value={form.maxGapMs}
            onChange={e => setField("maxGapMs", e.target.value)}
          />
        </Field>
        <Field label={`Радиус дедупликации ST-DBSCAN, м (деф. ${defaults.stdbscanEpsilonSpatialM})`} hint={H.stdbscanSpatial}>
          <input
            className="ds-input"
            type="number"
            value={form.stdbscanEpsilonSpatialM}
            onChange={e => setField("stdbscanEpsilonSpatialM", e.target.value)}
          />
        </Field>
      </div>

      <Field label={`Окно дедупликации ST-DBSCAN по времени, мс (деф. ${defaults.stdbscanEpsilonTemporalMs})`} hint={H.stdbscanTemporal}>
        <input
          className="ds-input"
          type="number"
          value={form.stdbscanEpsilonTemporalMs}
          onChange={e => setField("stdbscanEpsilonTemporalMs", e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11, fontWeight: 600, margin: "12px 0 6px" }}>Kalman / innovation gate</p>

      <div className="ds-subpanel" style={{ marginBottom: 10 }}>
        <p className="ds-subpanel__title">Масштабы Q / R</p>
        <p className="ds-subpanel__hint">
          Множители ковариации относительно базы профиля. Дефолт — значение профиля ({defaults.processNoiseScale} / {defaults.observationSigmaScale}).
        </p>
        <div className="ds-slider-grid">
          <CoeffSlider
            label={`Доверие к прогнозу Q × (деф. ${defaults.processNoiseScale})`}
            title="Выше — фильтр быстрее подстраивается под манёвры."
            hint={H.processNoiseScale}
            value={Number(form.processNoiseScale) || defaults.processNoiseScale}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.1}
            onChange={v => setField("processNoiseScale", String(v))}
          />
          <CoeffSlider
            label={`Шум наблюдения R × (деф. ${defaults.observationSigmaScale})`}
            title="Выше — шире эллипс наблюдения (телега / грубая гео)."
            hint={H.observationSigmaScale}
            value={Number(form.observationSigmaScale) || defaults.observationSigmaScale}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.1}
            onChange={v => setField("observationSigmaScale", String(v))}
          />
        </div>
      </div>

      <div className="ds-form-row">
        <Field label={`Порог линковки χ² (выше → допускает дальше, деф. ${defaults.chi2Threshold})`} hint={H.chi2Threshold}>
          <input
            className="ds-input"
            type="number"
            step="any"
            value={form.chi2Threshold}
            onChange={e => setField("chi2Threshold", e.target.value)}
          />
        </Field>
        <Field label={`Отсечка движения назад, м (rear-front, деф. ${defaults.rearThresholdM})`} hint={H.rearThresholdM}>
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

