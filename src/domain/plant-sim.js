/**
 * Simulador de planta ilustrativo.
 *
 * IMPORTANTE: aqui não há modelo físico. As leituras são geradas a partir de
 * um cenário fixo + oscilações determinísticas, apenas para alimentar a
 * animação e os indicadores da demonstração (escopo Etapa 1). O ponto de
 * integração para modelos reais é `web/src/platform/adapters.js`; a
 * especificação dos modelos (termodinâmica, cinética, viabilidade) está em
 * `docs/ESCOPO_ETAPA2.md`.
 */

import { PROCESS, SCENARIO, GEOMETRY } from './params.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** PRNG determinístico (mulberry32) — mesma leitura em toda sessão. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fatores do cenário. `throughput` e `oxygen` são expostos ao painel de
 * parâmetros: são os únicos números que o usuário altera nesta etapa.
 */
export const SCENARIO_LIMITS = Object.freeze({
  throughput: Object.freeze({ min: 12000, max: 32000, step: 500, unit: 'kg/h', label: 'Carga de briquete' }),
  oxygen: Object.freeze({ min: 4000, max: 11000, step: 100, unit: 'Nm³/h', label: 'O₂ puro' }),
  targetTemp: Object.freeze({ min: 1480, max: 1536, step: 1, unit: '°C', label: 'Alvo de temperatura' })
});

/**
 * Produção estimada a partir dos parâmetros do cenário.
 * Relação ilustrativa: ~0,35 Nm³ de O₂ por kg de Fe, consumo específico de
 * briquete de 1,62 kg/kg Fe. Não é balanço estequiométrico validado.
 */
export function estimateProduction(params) {
  const oxygen = params.oxygen;
  const feKgH = oxygen * 2.85;
  const briquetteKgH = feKgH * 1.62;
  const annualT = (feKgH * 8760) / 1000;
  return {
    feKgH,
    feTPerHour: feKgH / 1000,
    briquetteKgH,
    specificBriquette: briquetteKgH / feKgH,
    annualT,
    /** Fator de utilização em relação à capacidade nominal, 0..1. */
    utilization: annualT / PROCESS.nominalCapacityTPerYear
  };
}

/**
 * Checagem de envelope operacional — NÃO é um modelo termodinâmico.
 * Apenas verifica se os parâmetros estão dentro das faixas declaradas, para
 * que a interface já mostre o lugar onde a viabilidade real será calculada.
 */
export function checkOperatingEnvelope(params) {
  const items = [
    {
      key: 'temp',
      label: 'Temperatura do metal',
      ok: params.targetTemp >= PROCESS.metalTempMinC && params.targetTemp <= PROCESS.metalTempMaxC,
      detail: `${PROCESS.metalTempMinC}–${PROCESS.metalTempMaxC} °C`
    },
    {
      key: 'oxygen',
      label: 'Vazão de O₂',
      ok: params.oxygen >= 4000 && params.oxygen <= 11000,
      detail: '4.000–11.000 Nm³/h (turndown)'
    },
    {
      key: 'throughput',
      label: 'Carga de briquete',
      ok: params.throughput >= 12000 && params.throughput <= 32000,
      detail: '12–32 t/h'
    },
    {
      key: 'carbon',
      label: 'Carbono redutor no briquete',
      ok: PROCESS.briquette.coal >= 0.18 && PROCESS.briquette.coal <= 0.28,
      detail: '18–28 % mássico'
    },
    {
      key: 'yield',
      label: 'Rendimento de Fe',
      ok: params.oxygen / Math.max(params.throughput, 1) < 0.42,
      detail: 'O₂ / carga < 0,42 Nm³/kg'
    }
  ];
  return {
    items,
    feasible: items.every(i => i.ok),
    /** Quais checagens precisam de modelo (termodinâmica/cinética) para valer. */
    pending: ['balance_mass', 'balance_energy', 'kinetics', 'refractory_life']
  };
}

/**
 * Cria o simulador. `sample()` recebe o estado da animação e devolve um frame
 * de telemetria, além de acumular histórico curto para os gráficos.
 */
export function createPlantSimulator(options = {}) {
  const params = {
    throughput: options.throughput ?? SCENARIO.throughputKgPerHour,
    oxygen: options.oxygen ?? SCENARIO.oxygenNm3PerHour,
    targetTemp: options.targetTemp ?? PROCESS.metalTempSetpointC
  };
  const random = mulberry32(options.seed ?? 20260806);
  const history = [];
  const historyLimit = options.historyLimit ?? 240;
  let elapsed = 0;
  let drift = 0;

  function sample(sceneState, dt = 0.25) {
    elapsed += dt;
    const t = elapsed;

    // Oscilação lenta determinística em torno do alvo do cenário.
    drift += (random() - 0.5) * 0.02;
    drift = clamp(drift, -0.9, 0.9);
    const wobble = 6 * Math.sin(t * 0.21 + drift) + 3 * Math.sin(t * 0.83 + 1 + drift * 0.4);
    const tapDip = sceneState?.tapOpen ? -8 * Math.min(1, (sceneState.tapElapsed ?? 0) * 0.4) : 0;
    const metalTempC = clamp(params.targetTemp + wobble + tapDip, PROCESS.metalTempMinC, PROCESS.metalTempMaxC);

    const load = params.oxygen / SCENARIO.oxygenNm3PerHour;
    const oxygenNm3h = params.oxygen * (1 + 0.01 * Math.sin(t * 0.6));
    const recirculatedNm3h = SCENARIO.recirculatedGasNm3PerHour * load * (1 + 0.02 * Math.sin(t * 0.37 + 2));

    const coPct = clamp(SCENARIO.offgasCOPercent + 1.4 * Math.sin(t * 0.33), 20, 60);
    const co2Pct = SCENARIO.offgasCO2Percent - 0.6 * Math.sin(t * 0.33);
    const h2Pct = SCENARIO.offgasH2Percent + 0.5 * Math.sin(t * 0.19 + 1.1);

    const production = estimateProduction(params);

    const frame = {
      t: Number(t.toFixed(2)),
      mode: 'simulado',
      metalTempC: Number(metalTempC.toFixed(1)),
      metalLevelPct: Math.round(clamp(sceneState?.metalLevelPct ?? 70, 0, 100)),
      tapOpen: Boolean(sceneState?.tapOpen),
      oxygenNm3h: Math.round(oxygenNm3h),
      recirculatedNm3h: Math.round(recirculatedNm3h),
      offgas: {
        coPct: Number(coPct.toFixed(1)),
        co2Pct: Number(co2Pct.toFixed(1)),
        h2Pct: Number(h2Pct.toFixed(1))
      },
      production: {
        feKgH: Math.round(production.feKgH),
        briquetteKgH: Math.round(production.briquetteKgH),
        specificBriquette: Number(production.specificBriquette.toFixed(2)),
        annualT: Math.round(production.annualT),
        utilization: Number(production.utilization.toFixed(3))
      },
      scenario: { ...params },
      regions: null // preenchido quando houver modelo de campo (Etapa 2)
    };

    history.push({ t: frame.t, metalTempC: frame.metalTempC, metalLevelPct: frame.metalLevelPct, coPct: frame.offgas.coPct });
    if (history.length > historyLimit) history.shift();

    return frame;
  }

  return {
    params,
    limits: SCENARIO_LIMITS,
    sample,
    setParam(key, value) {
      if (!(key in params)) throw new Error(`Parâmetro desconhecido: ${key}`);
      const lim = SCENARIO_LIMITS[key];
      const v = Number(value);
      if (!Number.isFinite(v)) throw new Error(`Valor inválido para ${key}`);
      params[key] = lim ? clamp(v, lim.min, lim.max) : v;
      return params[key];
    },
    envelope: () => checkOperatingEnvelope(params),
    production: () => estimateProduction(params),
    history: () => history.slice(),
    reset() {
      Object.assign(params, {
        throughput: SCENARIO.throughputKgPerHour,
        oxygen: SCENARIO.oxygenNm3PerHour,
        targetTemp: PROCESS.metalTempSetpointC
      });
      elapsed = 0;
      drift = 0;
      history.length = 0;
    }
  };
}

/** Distância ao limite do refratário, em mm, com base no desgaste máximo. */
export function refractoryMarginMm(maxWearMm) {
  return Math.max(0, GEOMETRY.refractoryInitialMm - maxWearMm - GEOMETRY.refractoryMinMm);
}
