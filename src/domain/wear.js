/**
 * Domínio de desgaste do refratário: normalização de dados, rampa de cor e
 * estatísticas. Funções puras — nenhuma dependência de three.js ou do DOM,
 * para poderem ser testadas em Node (`tests/web`).
 */

import { WEAR_ZONES, GEOMETRY } from './params.js';

/** Rampa azul → branco → amarelo → laranja (frações de 0 a 1). */
export const WEAR_STOPS = Object.freeze([
  [0.0, [0.227, 0.435, 0.847]],
  [0.33, [0.859, 0.910, 1.0]],
  [0.66, [1.0, 0.816, 0.439]],
  [1.0, [1.0, 0.353, 0.169]]
]);

export const NODATA_RGB = Object.freeze([0.169, 0.184, 0.208]);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Cor de uma fração de desgaste (0..1) como `[r,g,b]` em 0..1. */
export function wearRamp(fraction) {
  const f = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  for (let i = 0; i < WEAR_STOPS.length - 1; i++) {
    const [f0, c0] = WEAR_STOPS[i];
    const [f1, c1] = WEAR_STOPS[i + 1];
    if (f >= f0 && f <= f1) {
      const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t
      ];
    }
  }
  return WEAR_STOPS[WEAR_STOPS.length - 1][1].slice();
}

export const toCss = rgb => `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;

/** Classificação textual usada nos painéis. */
export function wearStatus(fraction) {
  if (fraction > 0.66) return { label: 'Alto', css: toCss(WEAR_STOPS[3][1]) };
  if (fraction > 0.33) return { label: 'Moderado', css: toCss(WEAR_STOPS[2][1]) };
  return { label: 'Normal', css: toCss(WEAR_STOPS[0][1]) };
}

const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const normZone = s => String(s)
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[\s-]+/g, '_');

const niceCeil = x => {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
};

/** CSV com `# chave=valor` no cabeçalho, separadores `,` `;` ou tab. */
export function parseWearCsv(text) {
  const meta = {};
  let delim = null;
  let header = null;
  const rows = [];

  String(text).replace(/\r/g, '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('#')) {
      const m = line.slice(1).trim().match(/^([^=]+)=(.*)$/);
      if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
      return;
    }
    if (!header) {
      delim = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      header = line.split(delim).map(s => s.trim().toLowerCase());
      return;
    }
    rows.push(line.split(delim).map(s => s.trim()));
  });

  if (!header) throw new Error('CSV vazio.');

  const ix = name => header.indexOf(name);
  const cz = ix('zona');
  const cf = ix('fiada');
  const cs = ix('setor');
  const cv = ix('valor');
  const cc = ix('corrida');
  if ([cz, cf, cs, cv].some(x => x < 0)) {
    throw new Error('O cabeçalho do CSV precisa de: zona, fiada, setor, valor (e, opcional, corrida).');
  }

  const maxDim = {};
  const snaps = new Map();
  rows.forEach((r, n) => {
    const z = normZone(r[cz] || '');
    const f = parseInt(r[cf], 10);
    const s = parseInt(r[cs], 10);
    if (!(f >= 1 && s >= 1)) throw new Error(`Linha ${n + 2}: fiada e setor devem ser inteiros a partir de 1.`);
    let vt = r[cv] || '';
    if (delim === ';') vt = vt.replace(',', '.');
    const v = vt === '' ? null : num(vt);
    const label = cc >= 0 && r[cc] ? r[cc] : 'Dados';
    if (!snaps.has(label)) snaps.set(label, []);
    snaps.get(label).push([z, f, s, v]);
    const d = maxDim[z] || (maxDim[z] = [0, 0]);
    d[0] = Math.max(d[0], f);
    d[1] = Math.max(d[1], s);
  });

  const snapshots = [];
  snaps.forEach((list, label) => {
    const valores = {};
    list.forEach(([z, f, s, v]) => {
      if (!valores[z]) {
        valores[z] = Array.from({ length: maxDim[z][0] }, () => Array(maxDim[z][1]).fill(null));
      }
      valores[z][f - 1][s - 1] = v;
    });
    snapshots.push({ rotulo: label, valores });
  });

  return {
    titulo: meta.titulo,
    tipo: meta.tipo,
    espessura_inicial_mm: meta.espessura_inicial_mm,
    espessura_minima_mm: meta.espessura_minima_mm,
    limite_mm: meta.limite_mm,
    escala_max: meta.escala_max,
    snapshots
  };
}

/**
 * Normaliza o dataset de desgaste em um formato único.
 *
 * Aceita três entradas:
 *  1. canônico do repositório: `{zones:{zk:{N,M,e0,emin}}, snaps:[{x,label,wear}]}`;
 *  2. do módulo 3D original: `{snapshots:[{rotulo, valores}]}`;
 *  3. valor único: `{valores:{...}}`.
 */
export function normalizeWearDataset(raw, options = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Dados inválidos.');

  const tipo = String(raw.tipo || 'desgaste_mm').trim().toLowerCase();
  if (!['desgaste_mm', 'espessura_residual_mm', 'indice'].includes(tipo)) {
    throw new Error('tipo deve ser desgaste_mm, espessura_residual_mm ou indice.');
  }

  // e0/emin podem vir do topo do arquivo ou, no formato canônico, por zona.
  let e0 = num(raw.espessura_inicial_mm);
  let emin = num(raw.espessura_minima_mm);

  const source = Array.isArray(raw.snaps)
    ? 'wear-core'
    : (Array.isArray(raw.snapshots) && raw.snapshots.length ? 'modulo3d' : (raw.valores ? 'valores' : null));
  if (!source) throw new Error('Não encontrei valores. Use "snaps", "snapshots" ou "valores" no JSON.');

  const zonesIn = raw.zones || {};
  const dims = {};
  const zoneMeta = {};
  const warns = [];
  const snaps = [];

  if (source === 'wear-core') {
    Object.entries(zonesIn).forEach(([kRaw, meta]) => {
      const k = normZone(kRaw);
      if (!WEAR_ZONES.includes(k)) {
        warns.push(`Zona ignorada: ${kRaw}`);
        return;
      }
      const N = Number(meta?.N);
      const M = Number(meta?.M);
      if (!(N > 0 && M > 0)) throw new Error(`Zona ${kRaw}: N e M precisam ser positivos.`);
      if (N > 200 || M > 360) throw new Error(`Zona ${kRaw}: máximo de 200 fiadas e 360 setores.`);
      dims[k] = [N, M];
      zoneMeta[k] = { N, M, e0: num(meta.e0), emin: num(meta.emin) };
    });
    if (!Object.keys(dims).length) throw new Error(`Nenhuma zona reconhecida. Use: ${WEAR_ZONES.join(', ')}.`);

    raw.snaps.forEach((sn, si) => {
      const wear = {};
      Object.entries(dims).forEach(([k, [N, M]]) => {
        const arr = sn?.wear?.[k];
        if (arr === undefined || arr === null) {
          wear[k] = Array.from({ length: N }, () => Array(M).fill(null));
          return;
        }
        if (!Array.isArray(arr) || arr.length !== N || arr.some(r => !Array.isArray(r) || r.length !== M)) {
          throw new Error(`Zona ${k}: matriz de desgaste ${N}×${M} esperada.`);
        }
        wear[k] = arr.map(r => r.map(num));
      });
      const label = String(sn?.label ?? sn?.rotulo ?? `Corrida ${si + 1}`);
      snaps.push({ rotulo: label, corrida: num(sn?.x), wear });
    });
  } else {
    const snapsIn = source === 'modulo3d'
      ? raw.snapshots
      : [{ rotulo: raw.rotulo || 'Dados', valores: raw.valores }];

    snapsIn.forEach((sn, si) => {
      const wear = {};
      Object.entries(sn.valores || {}).forEach(([kRaw, arr]) => {
        const k = normZone(kRaw);
        if (!WEAR_ZONES.includes(k)) {
          if (si === 0) warns.push(`Zona ignorada: ${kRaw}`);
          return;
        }
        if (!Array.isArray(arr) || !arr.length || !Array.isArray(arr[0])) {
          throw new Error(`Zona ${kRaw}: esperado uma matriz [fiadas][setores].`);
        }
        const N = arr.length;
        const M = arr[0].length;
        if (N > 200 || M > 360) throw new Error(`Zona ${kRaw}: máximo de 200 fiadas e 360 setores.`);
        if (arr.some(r => !Array.isArray(r) || r.length !== M)) {
          throw new Error(`Zona ${kRaw}: todas as fiadas precisam ter o mesmo número de setores.`);
        }
        if (dims[k] && (dims[k][0] !== N || dims[k][1] !== M)) {
          throw new Error(`Zona ${kRaw}: o tamanho da matriz muda entre corridas.`);
        }
        dims[k] = [N, M];
        zoneMeta[k] = { N, M, e0, emin };
        wear[k] = arr.map(r => r.map(v => {
          const n = num(v);
          if (n === null) return null;
          return tipo === 'espessura_residual_mm' ? e0 - n : n;
        }));
      });
      const label = String(sn.rotulo ?? `Dados ${si + 1}`);
      const match = label.match(/-?\d+(?:[.,]\d+)?/);
      const corrida = num(sn.x) ?? (match ? parseFloat(match[0].replace(',', '.')) : null);
      snaps.push({ rotulo: label, corrida, wear });
    });
    if (!Object.keys(dims).length) throw new Error(`Nenhuma zona reconhecida. Use: ${WEAR_ZONES.join(', ')}.`);
    // zonas ausentes numa corrida ficam sem dado (cinza)
    snaps.forEach(sn => Object.keys(dims).forEach(k => {
      if (!sn.wear[k]) sn.wear[k] = Array.from({ length: dims[k][0] }, () => Array(dims[k][1]).fill(null));
    }));
  }

  if (!snaps.length) throw new Error('Nenhuma corrida de desgaste encontrada.');

  if (!(e0 > 0)) {
    const vals = Object.values(zoneMeta).map(z => z.e0).filter(v => v > 0);
    if (vals.length) e0 = Math.max(...vals);
  }
  if (!(emin > 0)) {
    const vals = Object.values(zoneMeta).map(z => z.emin).filter(v => v != null && v >= 0);
    if (vals.length) emin = Math.min(...vals);
  }
  if (tipo === 'espessura_residual_mm' && !(e0 > 0)) {
    throw new Error('Com espessura_residual_mm é preciso informar espessura_inicial_mm.');
  }

  let maxWear = 0;
  snaps.forEach(sn => Object.values(sn.wear).forEach(a => a.forEach(r => r.forEach(v => {
    if (v !== null && v > maxWear) maxWear = v;
  }))));

  let escala = num(raw.escala_max) ?? num(raw.limite_mm) ?? ((e0 > 0 && emin > 0) ? e0 - emin : null);
  if (!(escala > 0)) escala = tipo === 'indice' ? 1.5 : niceCeil(maxWear);

  return {
    titulo: raw.titulo || '',
    origem: raw.origem || (options.synthetic ? 'sintético' : 'carregado'),
    aviso: raw.aviso || '',
    tipo,
    e0,
    unit: tipo === 'indice' ? '' : ' mm',
    escalaMax: escala,
    dims,
    zoneMeta,
    snaps,
    warns,
    synthetic: options.synthetic ?? String(raw.origem || '').toLowerCase().startsWith('sint'),
    source
  };
}

/** Interpreta texto colado: JSON (objeto/array) ou CSV. */
export function parseWearText(text, options = {}) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Cole os dados ou escolha um arquivo.');
  const raw = t[0] === '{' || t[0] === '[' ? JSON.parse(t) : parseWearCsv(t);
  return normalizeWearDataset(Array.isArray(raw) ? { snapshots: raw } : raw, options);
}

/** Estatísticas para os painéis: pior célula, zona crítica, contagem de células. */
export function wearStats(ds, snapIdx = ds.snaps.length - 1) {
  const snap = ds.snaps[clamp(snapIdx, 0, ds.snaps.length - 1)];
  let worst = { value: -Infinity, zone: null, row: null, col: null };
  let cells = 0;
  let sum = 0;
  let count = 0;
  Object.entries(snap.wear).forEach(([zone, arr]) => {
    arr.forEach((row, i) => row.forEach((v, j) => {
      cells++;
      if (v === null) return;
      sum += v;
      count++;
      if (v > worst.value) worst = { value: v, zone, row: i + 1, col: j + 1 };
    }));
  });
  return {
    zone: snap.rotulo,
    corrida: snap.corrida,
    worst,
    meanWear: count ? sum / count : null,
    cells,
    withData: count,
    fractionOfLimit: worst.value > 0 ? worst.value / ds.escalaMax : 0
  };
}

/**
 * Estimativa linear simples de corridas restantes até o limite, a partir do
 * máximo de desgaste de cada snapshot. Ilustrativa: não substitui a calibração
 * com histórico real de medição (`docs/ESCOPO_ETAPA2.md`).
 */
export function remainingRuns(ds) {
  const points = ds.snaps
    .map((sn, i) => ({ x: sn.corrida ?? i, y: Math.max(0, ...Object.values(sn.wear).flatMap(a => a.flatMap(r => r.map(v => v ?? -Infinity)))) }))
    .filter(p => Number.isFinite(p.y));
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (!den) return null;
  const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den;
  if (!(slope > 0)) return null;
  const last = points[points.length - 1];
  const runs = (ds.escalaMax - last.y) / slope;
  return { runs: Math.max(0, runs), wearPerRun: slope, from: last.x };
}

export const DEFAULT_REFRACTORY = Object.freeze({
  initialMm: GEOMETRY.refractoryInitialMm,
  minMm: GEOMETRY.refractoryMinMm
});

/** CSV de exemplo (duas zonas, uma corrida) para o painel de dados. */
export function sampleWearCsv() {
  const L = ['# tipo=desgaste_mm', '# espessura_inicial_mm=450', '# limite_mm=300', 'zona,fiada,setor,valor,corrida'];
  for (let i = 1; i <= 3; i++) {
    for (let j = 1; j <= 8; j++) {
      L.push(`ventaneiras,${i},${j},${Math.round(80 + 40 * i + 60 * Math.cos(((j - 0.5) / 8) * Math.PI * 2 * 4) ** 2)},Corrida 1`);
    }
  }
  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 8; j++) {
      L.push(`cadinho_parede,${i},${j},${Math.round(60 + 30 * i + 40 * Math.cos(((j - 1) / 8) * 2 * Math.PI))},Corrida 1`);
    }
  }
  return L.join('\n');
}

/** JSON de exemplo no formato do módulo 3D (matrizes por zona). */
export function sampleWearJson() {
  const mk = (N, M, f) => Array.from({ length: N }, (_, i) => Array.from({ length: M }, (_, j) => Math.round(f(i, j))));
  return JSON.stringify({
    titulo: 'Reator Oxy-Red — exemplo',
    tipo: 'desgaste_mm',
    espessura_inicial_mm: 450,
    limite_mm: 300,
    snapshots: [{
      rotulo: 'Corrida 1',
      valores: {
        ventaneiras: mk(3, 8, (i, j) => 80 + 40 * (i + 1) + 60 * Math.cos(((j + 0.5) / 8) * Math.PI * 2 * 4) ** 2),
        cadinho_parede: mk(4, 8, (i, j) => 60 + 30 * (i + 1) + 40 * Math.cos((j / 8) * 2 * Math.PI))
      }
    }]
  }, null, 1);
}

/**
 * Dataset sintético de emergência, usado quando o arquivo de dados não pode ser
 * carregado (ex.: abrir o index.html direto do disco). Mesma forma do arquivo
 * real; valores puramente ilustrativos.
 */
export function demoWearDataset() {
  const TUY = 8;
  const TAU = Math.PI * 2;
  const gauss = (x, c, w) => Math.exp(-((x - c) ** 2) / (2 * w * w));
  const hash = (a, b, c) => {
    const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const def = { cuba_superior: [14, 36], cuba_inferior: [12, 36], ventaneiras: [6, 32], cadinho_parede: [10, 36], soleira: [5, 36] };
  const prog = [0.35, 0.68, 1.0];
  const labs = ['Corrida 150', 'Corrida 450', 'Corrida 900'];
  const ad = (a, b) => {
    let d = Math.abs(a - b) % TAU;
    return d > Math.PI ? TAU - d : d;
  };
  const tuy = th => Math.max(...Array.from({ length: TUY }, (_, k) => gauss(ad(th, ((k + 0.5) / TUY) * TAU), 0, 0.13)));

  function W(zk, i, j, N, M) {
    const y = (i + 0.5) / N;
    const th = ((j + 0.5) / M) * TAU;
    if (zk === 'cadinho_parede') return 55 + 150 * gauss(y, 0.6, 0.11) + 170 * gauss(ad(th, 0), 0, 0.3) * gauss(y, 0.17, 0.18) + 45 * gauss(y, 0.03, 0.08);
    if (zk === 'ventaneiras') return 70 + 190 * tuy(th) * gauss(y, 0.45, 0.24) + 35 * gauss(y, 0.95, 0.18);
    if (zk === 'cuba_inferior') return 45 + 70 * gauss(y, 0.04, 0.2) + 20 * (0.5 + 0.5 * Math.cos(th - 1.2));
    if (zk === 'cuba_superior') return 30 + 75 * gauss(y, 0.655, 0.07) + 15 * gauss(y, 0.97, 0.1);
    return 40 + 85 * gauss(y, 0.92, 0.14) + 30 * gauss(y, 0, 0.35) + 45 * gauss(ad(th, 0), 0, 0.5) * gauss(y, 0.9, 0.22);
  }

  const raw = {
    origem: 'sintético',
    titulo: 'Exemplo sintético (embutido)',
    tipo: 'desgaste_mm',
    espessura_inicial_mm: 450,
    limite_mm: 300,
    snapshots: prog.map((p, si) => ({
      rotulo: labs[si],
      valores: Object.fromEntries(Object.entries(def).map(([zk, [N, M]]) => [zk,
        Array.from({ length: N }, (_, i) => Array.from({ length: M }, (_, j) => Math.round(p * W(zk, i, j, N, M) * (0.92 + 0.16 * hash(i, j, N + si)) * 10) / 10))
      ]))
    }))
  };
  return normalizeWearDataset(raw, { synthetic: true });
}
