// Lecture tolérante des valeurs envoyées par le raccourci iPhone ou collées à la main.
// Ce fichier est dupliqué dans supabase/functions/_shared/parse.js : garder les deux identiques.

const pad = (n) => String(n).padStart(2, '0');

/** Date du jour à Paris, au format AAAA-MM-JJ. */
export function todayParis(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** « 78,4 kg » → 78.4 ; « 6 240 pas » → 6240 ; 1385 → 1385. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? +m[0] : null;
}

const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

/** Reconnaît 2026-11-25, 25/11/2026, 25.11.26, « 25 nov. 2026 à 21:30 », « mercredi 25 novembre 2026 ». */
export function parseDate(v, fallback = todayParis()) {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  m = s.toLowerCase().match(/(\d{1,2})(?:er)?\s+([a-zéûè]+)\.?\s+(\d{4})/);
  if (m) {
    const i = MOIS.findIndex((x) => m[2].startsWith(x.slice(0, 3)));
    if (i >= 0) return `${m[3]}-${pad(i + 1)}-${pad(m[1])}`;
  }
  return fallback;
}

const CHAMPS = ['poids', 'pas', 'kcal', 'prot', 'gluc', 'lip'];
const ALIAS = {
  weight: 'poids', steps: 'pas', energie: 'kcal', énergie: 'kcal', calories: 'kcal',
  proteines: 'prot', protéines: 'prot', glucides: 'gluc', lipides: 'lip', fat: 'lip', carbs: 'gluc', protein: 'prot',
};
const BORNES = { poids: [20, 400], pas: [0, 200000], kcal: [0, 20000], prot: [0, 2000], gluc: [0, 3000], lip: [0, 2000] };

/** Normalise un objet {date, poids, pas, …} : valeurs arrondies, hors bornes ignorées. */
export function normalize(obj, fallbackDate) {
  const out = { date: parseDate(obj.date, fallbackDate) };
  for (const [k0, v] of Object.entries(obj)) {
    const k = ALIAS[k0.trim().toLowerCase()] || k0.trim().toLowerCase();
    if (!CHAMPS.includes(k)) continue;
    let n = num(v);
    if (n == null) continue;
    n = k === 'poids' ? Math.round(n * 10) / 10 : Math.round(n);
    const [lo, hi] = BORNES[k];
    if (n < lo || n > hi) continue;
    // Apple Santé renvoie 0 quand rien n'est saisi : on ne l'enregistre pas pour le poids.
    if (k === 'poids' && n === 0) continue;
    out[k] = n;
  }
  return out;
}

/** Texte « SANTE;date=…;poids=… » → objet normalisé, ou null si le format n'est pas reconnu. */
export function parseSanteText(t, fallbackDate) {
  if (!/SANTE/i.test(t || '')) return null;
  const o = {};
  String(t).split(/[;\n]/).forEach((p) => {
    const [k, ...v] = p.split('=');
    if (k && v.length) o[k.trim().toLowerCase()] = v.join('=');
  });
  return normalize(o, fallbackDate);
}
