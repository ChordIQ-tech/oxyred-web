/**
 * Roteiro do processo Oxy-Red: etapas do tour, legendas, química e foco de
 * câmera. Conteúdo herdado do roteiro técnico usado no módulo 3D original.
 * O campo `focus` liga/desliga grupos de fluxo (ver `FLOW_KEYS`).
 */

export const FLOW_KEYS = Object.freeze([
  'briq', 'charge', 'bed', 'o2', 'gasIn', 'offgas', 'recirc', 'heat', 'melt', 'tap'
]);

export const OVERVIEW = Object.freeze({
  name: 'Visão geral da usina',
  dur: 7,
  cap: 'Reator compacto e modular (Ø 3,6 m · 200 mil t/ano), circuito fechado de gases e nenhuma chaminé.',
  chem: [],
  focus: null,
  cam: { look: [4.0, 6.8, 0.4], r: 32, th: 1.12, ph: 1.2 }
});

export const STEPS = Object.freeze([
  {
    name: 'Briquete autorredutor',
    dur: 10,
    cap: 'Cada briquete é uma mistura íntima de finos de minério, finos de carvão e cal, que reagem entre si.',
    chem: ['Fe₂O₃ + C + CaO'],
    mix: true,
    focus: ['briq', 'charge'],
    cam: { look: [-6.0, 11.2, 2.6], r: 7.6, th: 1.62, ph: 1.36 }
  },
  {
    name: 'Composição do briquete',
    dur: 7.5,
    cap: 'No corte seccional, minério, carvão e cal aparecem distribuídos por todo o briquete: setenta, vinte e três e sete por cento.',
    chem: [],
    mix: true,
    focus: ['briq'],
    cam: { look: [-6.0, 11.2, 2.6], r: 6.8, th: 1.66, ph: 1.38 }
  },
  {
    name: 'Carga contínua pelo topo',
    dur: 10,
    cap: 'Os briquetes sobem pelo elevador e são carregados continuamente pelo topo do reator compacto.',
    chem: [],
    focus: ['charge', 'bed'],
    cam: { look: [-1.2, 11.2, 0], r: 13, th: 1.95, ph: 1.25 }
  },
  {
    name: 'Injeção de O₂ e redução',
    dur: 10,
    cap: 'O oxigênio puro reage com o carbono e gera CO, que reduz o minério em estado sólido em cerca de trinta minutos.',
    chem: ['2C + O₂ → 2CO', 'Fe₂O₃ + 3CO → 2Fe + 3CO₂', 'C + CO₂ → 2CO · Boudouard'],
    focus: ['o2', 'gasIn', 'bed'],
    cam: { look: [-2.3, 4.9, 0], r: 16, th: 1.72, ph: 1.3 }
  },
  {
    name: 'Circuito fechado de gases',
    dur: 10,
    cap: 'O gás de topo é limpo e separado. CO₂ e H₂ seguem para amônia e ureia; CO e CH₄ voltam à base do reator.',
    chem: ['Nada é emitido para a atmosfera'],
    chemZero: true,
    focus: ['offgas', 'recirc'],
    cam: { look: [7.6, 7.2, 0], r: 22, th: 1.1, ph: 1.25 }
  },
  {
    name: 'Pós-combustão',
    dur: 10,
    cap: 'A queima do gás recirculado com oxigênio puro aquece o reator e acelera a redução do minério.',
    chem: ['2CO + O₂ → 2CO₂'],
    focus: ['heat', 'o2', 'recirc'],
    cam: { look: [0.4, 3.6, 0], r: 11.5, th: 1.35, ph: 1.22 }
  },
  {
    name: 'Fusão e gotejamento',
    dur: 7.5,
    cap: 'O ferro reduz dentro do briquete e só goteja entre 1.480 e 1.536 °C, acumulando-se no fundo do reator.',
    chem: ['Fe sólido → Fe líquido'],
    focus: ['melt', 'heat'],
    cam: { look: [0.6, 2.5, 0.5], r: 11, th: 1.5, ph: 1.2 }
  },
  {
    name: 'Vazamento e granulação',
    dur: 10,
    cap: 'A escória, mais leve, sobranada o ferro. No vazamento, o ferro é granulado. Usina modular, sem chaminés.',
    chem: ['Ferro verde · zero emissão de CO₂'],
    chemZero: true,
    focus: ['tap', 'melt'],
    cam: { look: [3.3, 6.4, 1.0], r: 31, th: 1.28, ph: 1.22 }
  }
]);

/** Legenda dos fluxos do processo (cores vêm do CSS via custom properties). */
export const FLOW_LEGEND = Object.freeze([
  { key: 'o2', label: 'O₂ puro', color: 'var(--o2)' },
  { key: 'co', label: 'CO redutor', color: 'var(--co)' },
  { key: 'co2', label: 'CO₂', color: 'var(--co2)' },
  { key: 'ch4', label: 'CH₄', color: 'var(--ch4)' },
  { key: 'h2', label: 'H₂', color: 'var(--h2)' },
  { key: 'n2', label: 'N₂ · só tanque', color: 'var(--n2)', hollow: true },
  { key: 'fe', label: 'Ferro líquido', color: 'ferro' },
  { key: 'slag', label: 'Escória', color: 'var(--slag)' }
]);

export const stepAt = index => (index < 0 ? OVERVIEW : STEPS[index]);
