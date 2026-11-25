// Graphiques SVG dessinés à la main (aucune bibliothèque).
const fr = new Intl.NumberFormat('fr-FR');
const fr1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function lineChart(s, pts, goal) {
  const W = s.clientWidth, H = s.clientHeight; if (!W) return;
  const L = 40, R = 10, Tp = 12, B = 24;
  const vals = pts.filter((p) => p.v != null);
  if (vals.length < 2) { s.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${css('--mute')}" font-size="14">Pas assez de pesées</text>`; return; }
  let mn = Math.min(...vals.map((p) => p.v)), mx = Math.max(...vals.map((p) => p.v));
  if (goal && goal > mn - 1.5) mn = Math.min(mn, goal);
  mn = Math.floor(mn - 0.3); mx = Math.ceil(mx + 0.3);
  const x = (i) => L + i * (W - L - R) / (pts.length - 1), y = (v) => Tp + (mx - v) * (H - Tp - B) / (mx - mn);
  let g = ''; const step = (mx - mn) > 6 ? 2 : 1;
  for (let v = mn; v <= mx; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--soft')}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="${css('--mute')}">${v}</text>`;
  if (goal && goal >= mn) g += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="${css('--herb')}" stroke-dasharray="5 4" stroke-width="2"/><text x="${W - R}" y="${y(goal) - 5}" text-anchor="end" font-size="12" fill="${css('--herb')}">Objectif ${esc(fr1.format(goal))}</text>`;
  const pv = pts.map((p, i) => (p.v != null ? [x(i), y(p.v)] : null)).filter(Boolean);
  g += `<path d="M${pv.map((p) => p.join(',')).join('L')}" fill="none" stroke="${css('--ink')}" stroke-width="2.5" stroke-linejoin="round"/>`;
  const last = pv.at(-1); g += `<circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${css('--tom')}"/>`;
  const ev = W < 520 ? 10 : 5;
  pts.forEach((p, i) => { if ((pts.length - 1 - i) % ev === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="12" fill="${css('--mute')}">${esc(p.l)}</text>`; });
  s.innerHTML = g;
}

export function barChart(s, pts, goal, kind) {
  const W = s.clientWidth, H = s.clientHeight; if (!W) return;
  const L = 44, R = 6, Tp = 18, B = 24;
  const mx = Math.max(goal * 1.2, ...pts.map((p) => p.v || 0)); const bw = (W - L - R) / pts.length;
  const y = (v) => Tp + (1 - v / mx) * (H - Tp - B);
  let g = '';
  [0, 0.5, 1].forEach((f) => { const v = Math.round(mx * f / 100) * 100; g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="${css('--mute')}">${W < 420 && v >= 1000 ? Math.round(v / 1000) + 'k' : fr.format(v)}</text>`; });
  pts.forEach((p, i) => {
    const v = p.v || 0, h = H - B - y(v); const c = kind === 'kcal' && v > goal ? css('--tom') : css('--herb');
    g += `<rect x="${L + i * bw + bw * 0.18}" y="${y(v)}" width="${bw * 0.64}" height="${Math.max(0, h)}" fill="${p.v == null ? css('--soft') : c}"/>`;
    g += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="${css('--mute')}">${esc(p.l)}</text>`;
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="${css('--ink')}" stroke-dasharray="5 4" stroke-width="1.5"/>`;
  s.innerHTML = g;
}
