// Mini-graphiques en SVG (aucune dépendance, fonctionne hors-ligne).
export function lineChart(points, opts = {}) {
  const { color = "#E23B3B", height = 150, fmt = v => Math.round(v) } = opts;
  const pts = points.filter(p => p.value != null && !isNaN(p.value));
  if (pts.length < 2) return `<div class="chartempty">Pas assez de données (≥ 2 séances).</div>`;
  const W = 320, H = height, pad = { l: 36, r: 10, t: 12, b: 16 };
  const vals = pts.map(p => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const x = i => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const base = H - pad.b;
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${color}"/>`).join("");
  const gid = "grad" + Math.abs(Math.round(min * 31 + max * 17 + pts.length));
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${base}" class="axl"/>
    <line x1="${pad.l}" y1="${base}" x2="${W - pad.r}" y2="${base}" class="axl"/>
    <text x="2" y="${(y(max) + 4).toFixed(1)}" class="axt">${fmt(max)}</text>
    <text x="2" y="${(y(min) + 4).toFixed(1)}" class="axt">${fmt(min)}</text>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;
}
