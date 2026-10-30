/**
 * Pontos de integração da plataforma.
 *
 * Cada adaptador implementa o MESMO contrato que o serviço real terá. Na Etapa 1
 * só o simulador responde; CFD, surrogates, sensores reais e o motor de
 * viabilidade devolvem "indisponível" com a razão — em vez de fingir resultado.
 * Trocar o mock pelo real é substituir a implementação, sem tocar na HMI.
 */

import { SCENARIO, PROCESS, GEOMETRY } from '../domain/params.js';

/**
 * Converte um frame de telemetria em frame de sensor (tags de campo).
 * É este mapeamento que a ingestão real vai usar para OPC UA e MQTT.
 */
export function toSensorFrame(frame, source = 'simulador') {
  return {
    timestamp: new Date().toISOString(),
    source,
    quality: frame.mode === 'medido' ? 'good' : 'uncertain',
    tags: {
      bath_temp_c: frame.metalTempC,
      tap_open: frame.tapOpen,
      oxygen_flow_nm3h: frame.oxygenNm3h,
      offgas_co_pct: frame.offgas.coPct,
      offgas_co2_pct: frame.offgas.co2Pct,
      metal_level_pct: frame.metalLevelPct,
      refractory_working_temp_c: Math.round(frame.metalTempC * 0.917)
    }
  };
}

const unavailable = reason => ({ available: false, reason });

/** Adaptador de ingestão de campo. */
export function createSensorAdapter() {
  return {
    kind: 'sensors',
    status: 'simulado',
    description: 'Sem conexão com a planta. Mapeia a telemetria para tags de campo.',
    /** @returns frame no contrato `sensor-frame`. */
    read(frame) {
      if (!frame) return unavailable('nenhum frame de telemetria disponível');
      return { available: true, frame: toSensorFrame(frame) };
    }
  };
}

/** Adaptador CFD (PINNApple / OpenFOAM multirregião). */
export function createCfdAdapter() {
  return {
    kind: 'cfd',
    status: 'indisponivel',
    description: 'Contrato de manifesto validado; execução pertence à Etapa 2.',
    run() {
      return unavailable('caso CFD não é executado nesta etapa');
    },
    lastCase: null
  };
}

/** Adaptador de modelos substitutos (escalar e de campo). */
export function createSurrogateAdapter() {
  return {
    kind: 'surrogate',
    status: 'indisponivel',
    description: 'Requer modelo treinado e exportado (ONNX) — Etapa 2.',
    infer() {
      return unavailable('nenhum modelo carregado');
    }
  };
}

/** Motor termodinâmico/cinético: decide viabilidade do cenário. */
export function createFeasibilityAdapter() {
  return {
    kind: 'feasibility',
    status: 'indisponivel',
    description: 'Conjunto de equações e critérios de viabilidade — Etapa 2.',
    evaluate() {
      return unavailable('motor termodinâmico ainda não implementado');
    },
    /** Envelope declarado; não substitui o cálculo. */
    envelope() {
      return {
        metalTempC: [PROCESS.metalTempMinC, PROCESS.metalTempMaxC],
        oxygenNm3h: [4000, 11000],
        throughputKgH: [12000, 32000],
        briquetteCoal: [0.18, 0.28],
        refractoryMinMm: GEOMETRY.refractoryMinMm,
        nominalAnnualT: PROCESS.nominalCapacityTPerYear
      };
    }
  };
}

/** Agrupa os adaptadores; a HMI lê os status daqui. */
export function createPlatform(options = {}) {
  const adapters = {
    sensors: createSensorAdapter(),
    cfd: createCfdAdapter(),
    surrogate: createSurrogateAdapter(),
    feasibility: createFeasibilityAdapter()
  };
  return {
    adapters,
    scenarioRef: options.scenario ?? SCENARIO,
    status: () => Object.values(adapters).map(a => ({
      kind: a.kind,
      status: a.status,
      description: a.description
    }))
  };
}
