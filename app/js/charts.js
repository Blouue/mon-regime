// Graphiques SVG dessinés à la main (aucune bibliothèque).
const fr = new Intl.NumberFormat('fr-FR');
const fr1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/**
 * Courbe de poids : les pesées en petits points, la tendance (moyenne sur 7 jours) en trait plein.
 * @param pts [{v: pesée|null, t: tendance|null, l: étiquette}]
 */
export function lineChart(s, pts, goal) {
  const W = s.clientWidth, H = s.clientHeight; if (!W) return;
  const L = 40, R = 10, Tp = 12, B = 24;
  const vals = pts.filter((p) => p.v != null), tend = pts.filter((p) => p.t != null);
  if (vals.length < 2) { s.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${css('--mute')}" font-size="14">Pas assez de pesées sur cette période</text>`; return; }
  const tous = [...vals.map((p) => p.v), ...tend.map((p) => p.t)];
  let mn = Math.min(...tous), mx = Math.max(...tous);
  if (goal && goal > mn - 1.5) mn = Math.min(mn, goal);
  mn = Math.floor(mn - 0.3); mx = Math.ceil(mx + 0.3);
  const x = (i) => L + i * (W - L - R) / Math.max(1, pts.length - 1), y = (v) => Tp + (mx - v) * (H - Tp - B) / (mx - mn);
  let g = ''; const step = Math.max(1, Math.ceil((mx - mn) / 6));
  for (let v = mn; v <= mx; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${css('--line')}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="${css('--mute')}">${v}</text>`;
  if (goal && goal >= mn) g += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="${css('--herb')}" stroke-dasharray="5 4" stroke-width="2"/><text x="${W - R}" y="${y(goal) - 5}" text-anchor="end" font-size="12" fill="${css('--herb')}">Objectif ${esc(fr1.format(goal))}</text>`;
  const sky = css('--sky');
  // Tendance : trait continu avec une aire dégradée dessous
  const pt = pts.map((p, i) => (p.t != null ? [x(i), y(p.t)] : null)).filter(Boolean);
  if (pt.length > 1) {
    const ligne = pt.map((p) => p.join(',')).join('L');
    g += `<defs><linearGradient id="aire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}" stop-opacity=".25"/><stop offset="1" stop-color="${sky}" stop-opacity="0"/></linearGradient></defs>`;
    g += `<path d="M${pt[0][0]},${H - B}L${ligne}L${pt.at(-1)[0]},${H - B}Z" fill="url(#aire)"/>`;
  }
  // Pesées : petits points discrets (plus petits quand la période est longue)
  const r = pts.length > 120 ? 1.6 : pts.length > 45 ? 2.2 : 3;
  pts.forEach((p, i) => { if (p.v != null) g += `<circle cx="${x(i)}" cy="${y(p.v)}" r="${r}" fill="${sky}" fill-opacity=".45"/>`; });
  if (pt.length > 1) {
    g += `<path d="M${pt.map((p) => p.join(',')).join('L')}" fill="none" stroke="${sky}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pt.at(-1); g += `<circle cx="${last[0]}" cy="${last[1]}" r="6" fill="${css('--card')}" stroke="${sky}" stroke-width="3"/>`;
  }
  // Étiquettes de dates : environ 4 sur mobile, 7 sur grand écran, la dernière toujours affichée
  const nb = W < 520 ? 4 : 7, ev = Math.max(1, Math.round((pts.length - 1) / (nb - 1)));
  pts.forEach((p, i) => { if ((pts.length - 1 - i) % ev === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === pts.length - 1 ? 'end' : 'middle'}" font-size="12" fill="${css('--mute')}">${esc(p.l)}</text>`; });
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
    const v = p.v || 0, h = H - B - y(v); const c = kind === 'kcal' ? (v > goal ? css('--tom') : css('--herb')) : (v >= goal ? css('--herb') : css('--sky'));
    g += `<rect x="${L + i * bw + bw * 0.2}" y="${p.v == null ? H - B - 4 : y(v)}" width="${bw * 0.6}" height="${p.v == null ? 4 : Math.max(4, h)}" rx="${Math.min(8, bw * 0.3)}" fill="${p.v == null ? css('--line') : c}"/>`;
    g += `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="${css('--mute')}">${esc(p.l)}</text>`;
  });
  g += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="${css('--mute')}" stroke-dasharray="4 5" stroke-width="1.5" stroke-linecap="round"/>`;
  s.innerHTML = g;
}
