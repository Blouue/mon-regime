// Calculs de suivi : tendance du poids, séries, badges, bilan de la semaine. Fonctions pures, sans DOM.
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/*
 * Poids lissé par moyenne exponentielle (méthode des applis de suivi du poids) : chaque pesée ne déplace
 * la tendance que de 15 % de l'écart. Contrairement à une moyenne glissante sur 7 jours, la courbe reste
 * régulière que l'on se pèse tous les jours ou un jour sur deux.
 */
const LISSAGE = 0.15;
const memo = new WeakMap();
function courbeTendance(days) {
  let c = memo.get(days); if (c) return c;
  c = []; let t = null;
  for (const k of Object.keys(days).filter((d) => days[d].poids).sort()) { const w = days[k].poids; t = t == null ? w : t + LISSAGE * (w - t); c.push([k, t]); }
  memo.set(days, c); return c;
}
/** Tendance du poids à une date (dernière valeur connue à cette date), ou null avant la première pesée. */
export function tendanceAu(days, date) {
  const c = courbeTendance(days); let lo = 0, hi = c.length - 1, r = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m][0] <= date) { r = c[m][1]; lo = m + 1; } else hi = m - 1; }
  return r;
}

/** Pente de la tendance en kg par jour, par régression linéaire sur les pesées des `n` derniers jours. */
export function pente(days, T, n = 28) {
  const pts = [];
  for (let i = n - 1; i >= 0; i--) { const d = iso(addD(fromIso(T), -i)); if (days[d]?.poids) pts.push([n - 1 - i, tendanceAu(days, d)]); }
  if (pts.length < 6 || pts.at(-1)[0] - pts[0][0] < 10) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const num = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0), den = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return den ? num / den : null;
}

/** Projection : date à laquelle la tendance atteindrait le poids visé, au rythme actuel. */
export function projection(days, T, cible) {
  const p = pente(days, T), t = tendanceAu(days, T) ?? derniereTendance(days, T);
  if (p == null || t == null || !cible) return { pente: p, date: null };
  if (t <= cible) return { pente: p, date: null, atteint: true };
  if (p > -0.005) return { pente: p, date: null };
  const jours = (t - cible) / -p;
  return { pente: p, date: jours < 3 * 365 ? addD(fromIso(T), Math.round(jours)) : null };
}
function derniereTendance(days, T) {
  const ks = Object.keys(days).filter((k) => k <= T && days[k].poids).sort();
  return ks.length ? tendanceAu(days, ks.at(-1)) : null;
}

const CONDITIONS = {
  kcal: (x, o) => x?.kcal != null && x.kcal <= o.kcal,
  pas: (x, o) => x?.pas != null && x.pas >= o.pas,
};

/** Série en cours : jours consécutifs jusqu'à aujourd'hui (ou hier si aujourd'hui n'est pas encore rempli). */
export function serie(days, o, T, type) {
  const ok = (d) => CONDITIONS[type](days[d], o);
  let d = fromIso(T); if (!ok(iso(d))) d = addD(d, -1);
  let n = 0; while (ok(iso(d)) && n < 3650) { n++; d = addD(d, -1); }
  return n;
}
/** Plus longue série sur toutes les données. */
function meilleureSerie(days, o, type) {
  const ks = Object.keys(days).sort(); let best = 0, cur = 0, prev = null;
  for (const k of ks) {
    const suite = prev && iso(addD(fromIso(prev), 1)) === k;
    if (CONDITIONS[type](days[k], o)) { cur = suite ? cur + 1 : 1; best = Math.max(best, cur); } else cur = 0;
    prev = k;
  }
  return best;
}

/** Badges : gagnés ou à débloquer, avec une indication pour y arriver. */
export function badges(days, o) {
  const vals = Object.values(days);
  const pesees = Object.keys(days).filter((k) => days[k].poids).sort();
  const perdu = pesees.length > 1 ? tendanceAu(days, pesees[0]) - tendanceAu(days, pesees.at(-1)) : 0;
  const suivis = vals.filter((x) => x.kcal != null || x.pas != null || x.poids != null).length;
  const sk = meilleureSerie(days, o, 'kcal');
  return [
    { e: '🎯', nom: '1er jour dans l\'objectif', ok: vals.some((x) => CONDITIONS.kcal(x, o)) },
    { e: '🔥', nom: '3 jours d\'affilée', ok: sk >= 3 },
    { e: '🏆', nom: '7 jours d\'affilée', ok: sk >= 7 },
    { e: '👟', nom: '10 000 pas en un jour', ok: vals.some((x) => (x.pas || 0) >= 10000) },
    { e: '🌱', nom: '−1 kg', ok: perdu >= 1 },
    { e: '🥈', nom: '−3 kg', ok: perdu >= 3 },
    { e: '🥇', nom: '−5 kg', ok: perdu >= 5 },
    { e: '🌟', nom: '−10 kg', ok: perdu >= 10 },
    { e: '📅', nom: '30 jours de suivi', ok: suivis >= 30 },
  ];
}

/** Bilan de la semaine précédente (lundi → dimanche), en quelques phrases. */
export function semaineDerniere(days, o, T) {
  const t = fromIso(T), lundi = addD(t, -((t.getDay() + 6) % 7) - 7), dimanche = addD(lundi, 6);
  const jours = []; for (let i = 0; i < 7; i++) jours.push(days[iso(addD(lundi, i))] || {});
  const k = jours.filter((x) => x.kcal != null), s = jours.filter((x) => x.pas != null);
  const titre = `Du ${lundi.getDate()} au ${dimanche.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  if (!k.length && !s.length) return { titre, phrases: [], vide: true };
  const fr = new Intl.NumberFormat('fr-FR'), fr1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const phrases = [];
  const n = k.filter((x) => x.kcal <= o.kcal).length;
  if (k.length) phrases.push(`🔥 Objectif tenu ${n} jour${n > 1 ? 's' : ''} sur ${k.length}${n >= 5 ? ' : superbe semaine !' : n >= 3 ? ', pas mal du tout.' : '.'}`);
  const moyPas = s.length ? Math.round(s.reduce((a, x) => a + x.pas, 0) / s.length) : null;
  if (moyPas != null) phrases.push(`👟 ${fr.format(moyPas)} pas par jour en moyenne${moyPas >= o.pas ? ', objectif dépassé 🎉' : ` (objectif ${fr.format(o.pas)}).`}`);
  const t0 = tendanceAu(days, iso(addD(lundi, -1))), t1 = tendanceAu(days, iso(dimanche));
  if (t0 != null && t1 != null) {
    const dlt = t1 - t0;
    phrases.push(dlt <= -0.1 ? `⚖️ Ta tendance a baissé de ${fr1.format(-dlt)} kg.` : dlt < 0.1 ? '⚖️ Ton poids est stable.' : `⚖️ Ta tendance a un peu remonté (+${fr1.format(dlt)} kg) : rien d'inquiétant sur une semaine.`);
  }
  const conseil = moyPas != null && moyPas < o.pas * 0.8 ? '💡 Défi de la semaine : 15 minutes de marche après le dîner.'
    : k.length && n < k.length / 2 ? "💡 Défi de la semaine : prévois tes dîners à l'avance, dès le dimanche."
    : '💡 Continue sur cette lancée, tu es sur la bonne voie 🌱';
  phrases.push(conseil);
  return { titre, phrases, lundi: iso(lundi) };
}

/*
 * Dépense réelle mesurée (même principe que les applis « adaptatives ») :
 * sur les 3 dernières semaines complètes (jusqu'au dimanche précédent, pour rester stable toute la semaine),
 * dépense ≈ apport moyen − variation de la tendance du poids × 7 700 kcal/kg.
 * Les journées sous 800 kcal sont écartées : ce sont presque toujours des journées mal ou pas notées.
 */
const KCAL_PAR_KG = 7700;
export function depenseMesuree(days, T, n = 21) {
  const t = fromIso(T), fin = addD(t, -((t.getDay() + 6) % 7) - 1), debut = addD(fin, -(n - 1));
  const apports = [], pts = [];
  for (let i = 0; i < n; i++) {
    const k = iso(addD(debut, i)), x = days[k];
    if (x?.kcal >= 800) apports.push(x.kcal);
    if (x?.poids) pts.push([i, tendanceAu(days, k)]);
  }
  const base = { debut: iso(debut), fin: iso(fin), jours: apports.length, pesees: pts.length, joursRequis: 10, peseesRequises: 4 };
  if (apports.length < 10 || pts.length < 4 || pts.at(-1)[0] - pts[0][0] < 10) return { ok: false, ...base };
  const apport = apports.reduce((a, b) => a + b, 0) / apports.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const pnt = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const valeur = apport - pnt * KCAL_PAR_KG;
  if (!Number.isFinite(valeur) || valeur < 1200 || valeur > 5000) return { ok: false, incoherent: true, ...base };
  // Confiance selon la quantité de données : elle règle la part de la mesure face à la formule théorique.
  const confiance = apports.length >= 18 && pts.length >= 8 ? 'bonne' : apports.length >= 14 && pts.length >= 6 ? 'moyenne' : 'faible';
  const poids = { bonne: 0.8, moyenne: 0.6, faible: 0.4 }[confiance];
  return { ok: true, ...base, valeur: Math.round(valeur / 10) * 10, apport: Math.round(apport), pente: pnt, confiance, poids };
}

/*
 * Résumé partagé avec les amis (« Ensemble ») : uniquement des indicateurs, jamais le poids exact
 * ni les calories du jour. Les kilos perdus ne sont inclus que si l'utilisateur l'autorise.
 */
export function resumePartage(days, o, T, montrerKg = false) {
  const pesees = Object.keys(days).filter((k) => k <= T && days[k].poids).sort();
  const t0 = pesees.length ? tendanceAu(days, pesees[0]) : null, t1 = tendanceAu(days, T);
  const perdu = t0 != null && t1 != null ? Math.round((t0 - t1) * 10) / 10 : null;
  const pct = t0 != null && t1 != null && o.poidsCible && t0 > o.poidsCible
    ? Math.max(0, Math.min(100, Math.round(((t0 - t1) / (t0 - o.poidsCible)) * 100))) : null;
  const t = fromIso(T), lundi = addD(t, -((t.getDay() + 6) % 7));
  let notes = 0, ok = 0;
  for (let d = new Date(lundi); iso(d) <= T; d = addD(d, 1)) { const x = days[iso(d)]; if (x?.kcal != null) { notes++; if (x.kcal <= o.kcal) ok++; } }
  const pas = []; for (let i = 0; i < 7; i++) { const x = days[iso(addD(t, -i))]; if (x?.pas != null) pas.push(x.pas); }
  const derniers = Object.keys(days).filter((k) => k <= T && (days[k].kcal != null || days[k].pas != null || days[k].poids)).sort();
  return {
    pct, ...(montrerKg && perdu != null ? { perdu } : {}), montrerKg,
    semaine: { lundi: iso(lundi), ok, notes },
    pas7: pas.length ? Math.round(pas.reduce((a, b) => a + b, 0) / pas.length) : null,
    serieKcal: serie(days, o, T, 'kcal'), seriePas: serie(days, o, T, 'pas'),
    badges: badges(days, o).filter((b) => b.ok).length,
    dernier: derniers.at(-1) || null,
  };
}
