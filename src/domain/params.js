/**
 * Parâmetros geométricos e de processo — fonte única de verdade do modelo de animação.
 *
 * Unidade de comprimento: metro. Unidade de vazão: Nm³/h. Massa: kg/h.
 *
 * As dimensões abaixo são as do reator descrito no roteiro técnico Oxy-Red
 * (Ø 3,6 m de face quente, ~11,85 m de altura, 200 mil t/ano). O domínio CFD
 * do repositório (`cad/`, `mesh/`, `cfd/`) usa a mesma nomenclatura de regiões,
 * porém numa malha de cunha em escala reduzida — ver `docs/ARQUITETURA.md`.
 */

export const GEOMETRY = Object.freeze({
  /** Raio interno (face quente) na cuba, m. */
  rInner: 1.8,
  /** Raio externo do casco, m. */
  rShell: 2.34,
  /** Base do cadinho (nível do metal no mínimo), m. */
  yHearth: 0.9,
  /** Altura das ventaneiras, m. */
  yTuyere: 3.25,
  /** Nível de carga no topo do leito, m. */
  yStock: 10.6,
  /** Topo do cone do reator, m. */
  yTop: 11.85,
  /** Número de ventaneiras. */
  nTuyeres: 8,
  /** Espessura inicial do refratário de trabalho, mm. */
  refractoryInitialMm: 450,
  /** Espessura mínima de segurança do refratário, mm. */
  refractoryMinMm: 150,
  /** Diâmetro nominal da face quente, m (derivado, exposto para relatórios). */
  get diameter() { return 2 * this.rInner; }
});

export const PROCESS = Object.freeze({
  /** Capacidade nominal da usina piloto comercial, t/ano. */
  nominalCapacityTPerYear: 200000,
  /** Capacidade do reator de prova de conceito, kg/h. */
  pocCapacityKgPerHour: 200,
  /** Faixa de temperatura do metal, °C. */
  metalTempMinC: 1480,
  metalTempMaxC: 1536,
  metalTempSetpointC: 1510,
  /** Composição do briquete autorredutor, fração mássica. */
  briquette: Object.freeze({ ore: 0.70, coal: 0.23, lime: 0.07 }),
  /** Há de se manter o circuito fechado: nada é emitido para a atmosfera. */
  atmosphericEmissionKgPerHour: 0
});

/**
 * Regiões do domínio multirregião (nomenclatura compartilhada com o caso CFD
 * `chtMultiRegionFoam`). A ordem é a mesma usada no contrato de telemetria.
 */
export const REGIONS = Object.freeze([
  'freeboard',
  'bed',
  'bath_slag',
  'bath_metal',
  'refractory_working',
  'refractory_insulating',
  'shell_steel'
]);

/** Regiões fluido vs. sólido — usado para validar frames de telemetria. */
export const REGION_KIND = Object.freeze({
  freeboard: 'fluid',
  bed: 'fluid',
  bath_slag: 'fluid',
  bath_metal: 'fluid',
  refractory_working: 'solid',
  refractory_insulating: 'solid',
  shell_steel: 'solid'
});

/** Zonas do revestimento usadas no mapa de desgaste (fiadas × setores). */
export const WEAR_ZONES = Object.freeze([
  'cuba_superior',
  'cuba_inferior',
  'ventaneiras',
  'cadinho_parede',
  'soleira'
]);

/**
 * Cenário de simulação ilustrativa. Nenhum modelo físico é resolvido nesta
 * etapa: os valores alimentam a animação e os indicadores de demonstração.
 */
export const SCENARIO = Object.freeze({
  throughputKgPerHour: 22800,
  oxygenNm3PerHour: 7900,
  recirculatedGasNm3PerHour: 5400,
  offgasCO2Percent: 34,
  offgasCOPercent: 41,
  offgasH2Percent: 18,
  briquetteResidenceMinMin: 26,
  briquetteResidenceMaxMin: 34
});
