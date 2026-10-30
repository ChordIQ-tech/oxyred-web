/** Formatação pt-BR usada nos painéis e nos rótulos. */

const nf = (digits = 0) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const int = v => nf(0).format(v ?? 0);
export const dec1 = v => nf(1).format(v ?? 0);
export const dec2 = v => nf(2).format(v ?? 0);
export const pct = v => `${nf(0).format(v ?? 0)}%`;
export const pct1 = v => `${nf(1).format(v ?? 0)}%`;
export const mm = v => `${nf(0).format(v ?? 0)} mm`;
export const tempC = v => `${nf(0).format(v ?? 0)} °C`;
export const nm3h = v => `${nf(0).format(v ?? 0)} Nm³/h`;

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

/**
 * Mini-gráfico em SVG (polyline) a partir de uma série de números.
 * Sem dependências: devolve a string do `points` para um viewBox 0..100 × 0..28.
 */
export function sparklinePoints(values, width = 100, height = 28) {
  const vals = values.filter(v => Number.isFinite(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
