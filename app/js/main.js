import { store, empty } from './store.js';
import { configured, currentUser, onAuth, handleRedirect, sendMagicLink, verifyCode, signOut, functionUrl } from './supabase.js';
import { num, parseSanteText, normalize } from './parse.js';
import { lineChart, barChart } from './charts.js';
import { ACTIVITES, RYTHMES, activiteDepuisPas, profilComplet, calculer } from './calcul.js';
import { tendanceAu, projection, serie, badges, semaineDerniere } from './suivi.js';
import { lireExportSante } from './export-sante.js';

const VERSION = '1.7.2';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fr = new Intl.NumberFormat('fr-FR');
const fr1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const frDate = (s, o = { day: 'numeric', month: 'long' }) => fromIso(s).toLocaleDateString('fr-FR', o);
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
let TODAY = new Date(); let T = iso(TODAY);
const DEF_OBJ = { kcal: 1800, prot: 110, gluc: 180, lip: 60, pas: 8000, poidsCible: 74 };
const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); };

/* ---------- Données d'exemple ---------- */
function demoData() {
  const days = {}; let w = 81.6;
  for (let i = 29; i >= 0; i--) {
    const d = iso(addD(TODAY, -i)); const r = Math.sin(i * 1.7) * 0.5 + 0.5;
    w -= 0.09 + Math.sin(i * 2.3) * 0.18;
    days[d] = { poids: +w.toFixed(1), pas: Math.round(5200 + r * 6200), kcal: Math.round(1580 + Math.cos(i * 1.3) * 260), prot: Math.round(95 + r * 25), gluc: Math.round(160 + Math.cos(i) * 30), lip: Math.round(55 + Math.sin(i) * 10), repas: [] };
  }
  days[T] = { poids: days[T].poids, pas: 6240, kcal: 1385, prot: 88, gluc: 142, lip: 47, eau: 5, faim: 2, energie: 4, humeur: 4, repas: [] };
  return { days, notes: 'Acheter : potimarron, skyr, lentilles corail.\nRefaire le chili, en doublant les haricots.', obj: { ...DEF_OBJ } };
}

/* ---------- État ---------- */
let real = empty();
let S = demoData();
let demo = true;
let lastSync = null;

function applyReal() {
  const has = Object.keys(real.days).length || (real.notes != null && real.notes !== '');
  if (has) { S = { days: real.days, notes: real.notes || '', obj: { ...DEF_OBJ, ...(real.obj || {}) } }; demo = false; }
  else { S = demoData(); if (real.obj) S.obj = { ...DEF_OBJ, ...real.obj }; demo = true; }
  $('demo').hidden = !demo;
  render();
}

/** Exécute une écriture. Renvoie true si elle a réussi. */
async function act(fn, ok) {
  if (store.mode === 'signed-out') { toast("Connecte-toi (onglet Connexion) pour enregistrer"); return false; }
  try { await fn(); if (ok) toast(ok); await refresh(); return true; }
  catch (e) { toast(e.code === 'offline' ? 'Hors ligne : réessaie une fois connecté' : 'Échec : ' + e.message); return false; }
}

async function refresh() {
  TODAY = new Date(); T = iso(TODAY);
  try {
    real = await store.load();
    lastSync = new Date();
    setStatus();
  } catch (e) {
    if (e.code === 'offline') {
      const c = store.cached(); if (c) real = c;
      showStatus('Hors ligne : affichage des dernières données reçues.');
    } else if (e.code !== 'not_signed_in') {
      showStatus('Synchronisation impossible : ' + e.message);
    }
  }
  applyReal(); renderAccount();
  await recalcAuto();
}

/** La ligne d'état ne s'affiche que lorsqu'il y a quelque chose à signaler. */
function showStatus(t) { $('st').textContent = t || ''; $('st').hidden = !t; }
function setStatus() {
  const m = store.mode;
  showStatus(m === 'local' ? 'Mode local : tes données restent sur cet appareil.'
    : m === 'signed-out' ? "Connecte-toi dans l'onglet Connexion pour enregistrer et synchroniser. En attendant, voici l'exemple."
    : '');
  $('syncBtn').hidden = m !== 'remote';
}

/** « Dernier envoi aujourd'hui à 21:31 · raccourci iPhone » sous le bilan du jour. */
function renderFresh() {
  const el = $('fresh');
  const du = !demo && store.mode === 'remote' && real.jeton?.dernier_usage;
  if (du) {
    const t = new Date(du), ti = iso(t);
    const quand = ti === T ? "aujourd'hui" : ti === iso(addD(TODAY, -1)) ? 'hier' : 'le ' + t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    el.textContent = `📲 Raccourci : dernier envoi ${quand} à ${t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    el.classList.toggle('old', Date.now() - t > 30 * 3600e3);
    return;
  }
  const ks = demo ? [] : Object.keys(S.days).filter((k) => S.days[k]._maj).sort((a, b) => (S.days[a]._maj < S.days[b]._maj ? -1 : 1));
  if (!ks.length) { el.textContent = ''; return; }
  const x = S.days[ks.at(-1)], t = new Date(x._maj), ti = iso(t);
  const quand = ti === T ? "aujourd'hui" : ti === iso(addD(TODAY, -1)) ? 'hier' : 'le ' + t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const src = { raccourci: 'raccourci iPhone', manuel: 'saisie à la main', collage: 'texte collé' }[x._src];
  el.textContent = `Dernier envoi ${quand} à ${t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` + (src ? ' · ' + src : '');
  el.classList.toggle('old', Date.now() - t > 36 * 3600e3);
}

/* ---------- Rendu : Aujourd'hui ---------- */
function lastWeight(beforeOrOn) { const ks = Object.keys(S.days).filter((k) => k <= beforeOrOn && S.days[k].poids).sort(); return ks.length ? { d: ks.at(-1), v: S.days[ks.at(-1)].poids } : null; }
function renderToday() {
  $('today').textContent = TODAY.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const d = S.days[T] || {}, o = S.obj, k = d.kcal || 0, left = o.kcal - k, has = d.kcal != null;
  // Anneau : vert, puis jaune à l'approche de l'objectif, tomate au-delà.
  const pct = k / o.kcal, C = 326.73;
  $('ringVal').setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, has ? pct : 0))));
  $('ringVal').classList.toggle('near', pct > 0.9 && pct <= 1);
  $('ringVal').classList.toggle('over', pct > 1);
  $('left').textContent = has ? fr.format(Math.abs(left)) : '–';
  $('leftLbl').textContent = has && left < 0 ? 'kcal en trop' : 'kcal restantes';
  $('eaten').textContent = has ? fr.format(k) : '–';
  $('goal').textContent = fr.format(o.kcal);
  const lw = lastWeight(T);
  $('wt').innerHTML = lw ? esc(fr1.format(lw.v)) + ' <span class="unit">kg</span>' : '–';
  // Variation sur 7 jours calculée sur la tendance lissée, moins sensible aux variations d'un jour à l'autre
  const t0 = tendanceAu(S.days, iso(addD(TODAY, -7))), t1 = tendanceAu(S.days, T);
  const dw = lw && t0 != null && t1 != null ? t1 - t0 : null;
  $('wtD').innerHTML = lw ? (dw != null ? `<span class="${dw <= 0 ? 'good' : 'bad'}">${dw <= 0 ? '↓' : '↑'} ${esc(fr1.format(Math.abs(dw)))} kg</span> en 7 jours` : '') + (lw.d !== T ? (dw != null ? '<br>' : '') + 'pesée du ' + esc(frDate(lw.d, { day: 'numeric', month: 'short' })) : '') : 'Pas encore de pesée';
  $('steps').textContent = d.pas == null ? '–' : fr.format(d.pas);
  $('stepBar').style.width = Math.min(100, (d.pas || 0) / o.pas * 100) + '%';
  $('stepGoal').textContent = (d.pas || 0) >= o.pas ? 'Objectif atteint 🎉' : 'Objectif ' + fr.format(o.pas);
  renderCheer(d, o, dw);
  renderFresh();
  // Macros : masquées tant qu'aucune n'a été reçue ces 14 derniers jours (le raccourci peut ne pas les envoyer).
  const depuis = iso(addD(TODAY, -14));
  $('macroBox').hidden = !demo && !Object.keys(S.days).some((k) => k >= depuis && ['prot', 'gluc', 'lip'].some((f) => S.days[k][f] != null));
  const M = [['🥩 Protéines', 'prot', o.prot], ['🍞 Glucides', 'gluc', o.gluc], ['🥑 Lipides', 'lip', o.lip]];
  $('macros').innerHTML = M.map(([n, f, g]) => { const v = d[f] || 0; return `<div class="macro ${f}"><span>${n}</span><div class="meter"><i style="width:${Math.min(100, v / g * 100)}%"></i></div><b>${esc(fr.format(v))} / ${fr.format(g)} g</b></div>`; }).join('');
  renderEau(d); renderRessenti(d); renderManque(); renderLundi();
}

/* ---------- Eau : 8 verres de 25 cl ---------- */
function renderEau(d) {
  const n = d.eau || 0;
  $('verres').innerHTML = Array.from({ length: 8 }, (_, i) => `<button type="button" class="${i < n ? 'on' : ''}" data-verre="${i + 1}" aria-label="${i + 1} verre${i ? 's' : ''}" aria-pressed="${i < n}">💧</button>`).join('');
  $('eauTxt').textContent = n ? `${String(n * 0.25).replace('.', ',')} L${n >= 8 ? ' · bravo 🎉' : ''}` : '';
}

/* ---------- Ressenti du jour : faim, énergie, humeur (1 à 5) ---------- */
const ECHELLES = [
  ['faim', 'Faim', ['😌', '🙂', '😋', '😬', '😫'], ['Rassasié', 'Un peu', 'Normale', 'Faim', 'Très faim']],
  ['energie', 'Énergie', ['🪫', '😴', '😐', '🙂', '⚡'], ['À plat', 'Fatigué', 'Moyenne', 'En forme', 'Au top']],
  ['humeur', 'Humeur', ['😞', '😕', '😐', '🙂', '😄'], ['Pas top', 'Bof', 'Neutre', 'Bien', 'Super']],
];
function renderRessenti(d) {
  $('ressenti').innerHTML = ECHELLES.map(([k, nom, em, lib]) => `<div class="echelle" role="group" aria-label="${nom}"><span>${nom}</span>${em.map((e, i) => `<button type="button" class="${d[k] === i + 1 ? 'on' : ''}" data-res="${k}" data-val="${i + 1}" aria-label="${nom} : ${lib[i]}" aria-pressed="${d[k] === i + 1}" title="${lib[i]}">${e}</button>`).join('')}</div>`).join('');
}

/* ---------- Alerte quand le raccourci n'a rien envoyé ---------- */
function renderManque() {
  const box = $('manque');
  if (demo || store.mode !== 'remote' || !real.jeton) { box.hidden = true; return; }
  const du = real.jeton.dernier_usage ? new Date(real.jeton.dernier_usage) : null;
  const dh = S.days[iso(addD(TODAY, -1))];
  // Envoi trop ancien (raccourci pas lancé, ou iPhone verrouillé à 21 h 30) et journée d'hier incomplète
  const vieux = !du || Date.now() - du > 30 * 3600e3, hierVide = !dh || (dh.kcal == null && dh.pas == null);
  box.hidden = !(vieux && hierVide);
  if (box.hidden) return;
  const depuis = du ? 'depuis le ' + du.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'pour le moment';
  $('manqueTxt').textContent = `Le raccourci n'a rien envoyé ${depuis}. Souvent, l'iPhone était verrouillé à 21 h 30 et iOS a bloqué la lecture de Santé. Lance-le maintenant pour envoyer les chiffres du jour, et saisis hier à la main si besoin.`;
  $('manqueRun').hidden = !/iPhone|iPad/.test(navigator.userAgent);
}

/* ---------- Bilan de la semaine : le lundi sur l'écran du jour, toujours dans Évolution ---------- */
function htmlSemaine(b) {
  if (b.vide) return '<p class="small">Pas assez de données la semaine dernière. Ça viendra !</p>';
  return `<p class="small">${esc(b.titre)}</p><ul class="phrases">${b.phrases.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}
function renderLundi() {
  const b = semaineDerniere(S.days, S.obj, T);
  const masque = localStorage.getItem('mr-lundi') === b.lundi;
  $('lundi').hidden = demo || TODAY.getDay() !== 1 || masque || b.vide;
  if (!$('lundi').hidden) $('lundiTxt').innerHTML = htmlSemaine(b);
}

/** Un petit mot d'encouragement, jamais culpabilisant. */
function renderCheer(d, o, dw) {
  const el = $('cheer'), h = new Date().getHours(), k = d.kcal;
  let t = '', cls = '';
  if (k == null) {
    t = h < 21 ? '🌅 Nouvelle journée ! Tes chiffres arriveront ce soir avec le raccourci.' : '📲 Le raccourci du soir ne devrait plus tarder.';
    cls = 'soft';
  } else if (k > o.kcal) {
    t = '🫶 Un peu au-dessus aujourd\'hui, pas de souci : demain est un autre jour.'; cls = 'warm';
  } else if (k >= o.kcal * 0.85) {
    t = '🎯 Pile dans ton objectif, bravo !';
  } else {
    t = `💪 Encore ${fr.format(o.kcal - k)} kcal à savourer aujourd'hui.`;
  }
  if ((d.pas || 0) >= o.pas) t += ' 👟 Et ton objectif de pas est atteint !';
  else if (dw != null && dw < 0) t += ` 🌱 −${fr1.format(-dw)} kg en 7 jours, continue comme ça !`;
  el.textContent = t; el.className = 'cheer ' + cls;
}

/* ---------- Rendu : Évolution ---------- */
function renderEvo() {
  const o = S.obj, p30 = [], p7k = [], p7s = [], per = +(choisi('per') || 30);
  const mois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  for (let i = per - 1; i >= 0; i--) {
    const d = addD(TODAY, -i), k = iso(d), x = S.days[k] || {};
    p30.push({ v: x.poids ?? null, t: x.poids ? tendanceAu(S.days, k) : null, l: per > 120 ? mois[d.getMonth()] : d.getDate() + '/' + (d.getMonth() + 1) });
  }
  for (let i = 6; i >= 0; i--) { const d = addD(TODAY, -i), x = S.days[iso(d)] || {}, l = JOURS[(d.getDay() + 6) % 7]; p7k.push({ v: x.kcal ?? null, l }); p7s.push({ v: x.pas ?? null, l }); }
  lineChart($('cW'), p30, o.poidsCible); barChart($('cK'), p7k, o.kcal, 'kcal'); barChart($('cS'), p7s, o.pas, 'pas');
  // Résumé : variation de la tendance sur la période, rythme actuel et projection
  const ts = p30.filter((p) => p.t != null);
  let resume = ts.length > 1 ? `Tendance : ${fr1.format(ts[0].t)} → ${fr1.format(ts.at(-1).t)} kg (${ts.at(-1).t - ts[0].t <= 0 ? '−' : '+'}${fr1.format(Math.abs(ts.at(-1).t - ts[0].t))} kg).` : '';
  const pr = projection(S.days, T, o.poidsCible);
  if (pr.pente != null) resume += ` Rythme : ${pr.pente <= 0 ? '−' : '+'}${fr1.format(Math.abs(pr.pente * 7))} kg par semaine.`;
  if (pr.atteint) resume += ' 🎉 Poids visé atteint !';
  else if (pr.date) resume += ` À ce rythme, ton objectif est atteint vers ${pr.date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} 🎯`;
  $('wtSum').textContent = resume;
  const k = p7k.filter((p) => p.v != null), s = p7s.filter((p) => p.v != null);
  const avg = (a) => (a.length ? Math.round(a.reduce((t, p) => t + p.v, 0) / a.length) : null);
  const inGoal = k.filter((p) => p.v <= o.kcal).length;
  const lw = lastWeight(T), tw0 = tendanceAu(S.days, iso(addD(TODAY, -7))), tw1 = tendanceAu(S.days, T);
  // Le bilan de la semaine en quatre tuiles, du plus parlant au plus détaillé.
  const reste = lw && o.poidsCible ? lw.v - o.poidsCible : null;
  const tiles = [
    ['sky', '⚖️', 'Cette semaine', tw0 != null && tw1 != null ? `${tw1 - tw0 <= 0 ? '−' : '+'}${fr1.format(Math.abs(tw1 - tw0))} kg` : '–'],
    ['grape', '🏁', 'Avant ton objectif', reste == null ? '–' : reste > 0 ? fr1.format(reste) + ' kg' : 'Atteint 🎉'],
    ['tom', '🔥', 'Jours dans l\'objectif', k.length ? `${inGoal} / ${k.length}` : '–'],
    ['herb', '👟', 'Pas par jour', avg(s) != null ? fr.format(avg(s)) : '–'],
  ];
  $('bilan').innerHTML = tiles.map(([c, e, l, v]) => `<div class="tile ${c}"><div class="t-h"><span class="e" aria-hidden="true">${e}</span> ${l}</div><div class="v">${esc(v)}</div></div>`).join('');
  renderReussites();
  $('semaine').innerHTML = htmlSemaine(semaineDerniere(S.days, o, T));
}

/* ---------- Séries et badges ---------- */
function renderReussites() {
  const o = S.obj, sr = [
    ['🔥', serie(S.days, o, T, 'kcal'), 'dans ton objectif calories'],
    ['👟', serie(S.days, o, T, 'pas'), `à ${fr.format(o.pas)} pas ou plus`],
    ['💧', serie(S.days, o, T, 'eau'), "à 2 litres d'eau"],
  ];
  $('series').innerHTML = sr.map(([e, n, l]) => `<div class="serie"><span class="e" aria-hidden="true">${e}</span><span>${n ? `<b>${n} jour${n > 1 ? 's' : ''}</b> d'affilée ${l}` : `Lance une série : un jour ${l}`}</span></div>`).join('');
  $('badges').innerHTML = badges(S.days, o).map((x) => `<div class="badge${x.ok ? '' : ' lock'}" title="${x.ok ? 'Gagné' : 'À débloquer'}"><span class="e" aria-hidden="true">${x.e}</span>${esc(x.nom)}</div>`).join('');
}

function renderNotes() { if (document.activeElement !== $('notes')) $('notes').value = S.notes || ''; }

/* ---------- Objectifs : à la main ou calcul automatique ---------- */
const virgule = (v) => (v != null ? String(v).replace('.', ',') : '');
const coche = (name, value) => { const r = document.querySelector(`input[name=${name}][value="${value}"]`); if (r) r.checked = true; };
const choisi = (name) => document.querySelector(`input[name=${name}]:checked`)?.value;
let objRempli = '';

/** Moyenne de pas des 7 derniers jours (données réelles uniquement). */
function moyennePas() {
  if (demo) return null;
  const v = []; for (let i = 0; i < 7; i++) { const x = S.days[iso(addD(TODAY, -i))]; if (x?.pas != null) v.push(x.pas); }
  return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function renderObj() {
  // Tant qu'aucun profil n'est rempli, on propose d'abord le calcul automatique.
  const o = S.obj, mode = o.mode === 'auto' || !o.sexe ? 'auto' : 'manuel';
  // On ne remplit le formulaire que si les données ont changé, pour ne pas effacer une saisie en cours.
  const lw = lastWeight(T), cle = JSON.stringify([o, lw]);
  if (cle !== objRempli) {
    objRempli = cle;
    coche('omode', mode);
    [['oK', 'kcal'], ['oP', 'prot'], ['oG', 'gluc'], ['oL', 'lip'], ['oS', 'pas'], ['oW', 'poidsCible'], ['aS', 'pas'], ['pN', 'naissance'], ['pT', 'taille'], ['pC', 'poidsCible']]
      .forEach(([id, f]) => { if (document.activeElement !== $(id)) $(id).value = virgule(o[f]); });
    if (o.sexe) coche('sexe', o.sexe);
    const sugg = activiteDepuisPas(moyennePas());
    document.querySelectorAll('[data-sugg]').forEach((s) => { s.hidden = +s.dataset.sugg !== sugg; });
    coche('act', o.activite || sugg || 1.375);
    coche('ryt', o.rythme ?? 0.5);
    if (document.activeElement !== $('pP')) $('pP').value = lw ? virgule(lw.v) : '';
    $('pPnote').textContent = lw && !demo ? `Poids actuel d'après ta pesée ${lw.d === T ? "d'aujourd'hui" : 'du ' + frDate(lw.d, { day: 'numeric', month: 'long' })}. Ton objectif se recalcule à chaque nouvelle pesée.` : '';
  }
  montrerMode();
}
function montrerMode() {
  const auto = choisi('omode') === 'auto';
  $('calcForm').hidden = !auto; $('objForm').hidden = auto;
  if (auto) renderCalc();
}

function lireProfil() {
  const entier = (id) => { const n = num($(id).value); return n ? Math.round(n) : null; };
  const r = choisi('ryt');
  return { sexe: choisi('sexe'), naissance: entier('pN'), taille: entier('pT'), poids: num($('pP').value), poidsCible: num($('pC').value), activite: +choisi('act') || null, rythme: r != null ? +r : null };
}
/** Message d'erreur si une valeur est hors des bornes raisonnables, sinon ''. */
function verifierProfil(p) {
  const an = new Date().getFullYear();
  if (p.naissance && (p.naissance < 1900 || p.naissance > an - 14)) return "L'année de naissance semble incorrecte.";
  if (p.taille && (p.taille < 120 || p.taille > 230)) return 'La taille se donne en centimètres, par exemple 175.';
  if (p.poids && (p.poids < 30 || p.poids > 300)) return 'Le poids actuel semble incorrect.';
  if (p.poidsCible && (p.poidsCible < 30 || p.poidsCible > 300)) return 'Le poids visé semble incorrect.';
  return '';
}

function renderCalc() {
  const p = lireProfil(), err = verifierProfil(p);
  if (err) { $('calcOut').innerHTML = `<p class="alerte">✋ ${esc(err)}</p>`; return; }
  if (!profilComplet(p)) { $('calcOut').innerHTML = '<p class="empty"><span class="e" aria-hidden="true">✨</span>Remplis tout pour découvrir ton objectif.</p>'; return; }
  const r = calculer(p);
  const quand = r.fin ? 'vers ' + r.fin.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : r.aPerdre > 0 ? '–' : 'Déjà atteint 🎉';
  let h = `<div class="tiles">
    <div class="tile tom"><div class="t-h"><span class="e" aria-hidden="true">🔥</span> Par jour</div><div class="v">${fr.format(r.kcal)} <span class="unit">kcal</span></div></div>
    <div class="tile grape"><div class="t-h"><span class="e" aria-hidden="true">📅</span> Poids visé</div><div class="v" style="font-size:20px">${esc(quand)}</div><div class="small">${r.semaines ? '≈ ' + Math.round(r.semaines) + ' semaines' : ''}</div></div>
  </div>
  <div class="chips"><span>🥩 ${r.prot} g protéines</span><span>🍞 ${r.gluc} g glucides</span><span>🥑 ${r.lip} g lipides</span></div>`;
  if (r.limite) h += `<p class="alerte">⚠️ Pour rester en forme, on ne descend pas sous ${fr.format(p.sexe === 'h' ? 1500 : 1200)} kcal par jour : tu perdras plutôt ${fr1.format(r.kgSemaine)} kg par semaine.</p>`;
  if (r.imcCibleBas) h += `<p class="alerte">⚠️ Ce poids visé correspond à un IMC de ${fr1.format(r.imcCible)}, sous le seuil de 18,5. Mieux vaut en parler à un médecin.</p>`;
  h += `<p class="small">Tu dépenses environ ${fr.format(r.tdee)} kcal par jour (dont ${fr.format(r.bmr)} au repos). ${r.aPerdre > 0 ? `Rythme prévu : −${fr1.format(r.kgSemaine)} kg par semaine.` : "C'est un objectif d'entretien."} Estimation selon la formule de Mifflin-St Jeor, pas un avis médical.</p>`;
  $('calcOut').innerHTML = h;
}

/** En mode automatique, réajuste l'objectif quand le poids change (les besoins baissent avec le poids). */
async function recalcAuto() {
  const o = real.obj;
  if (demo || store.mode === 'signed-out' || o?.mode !== 'auto' || recalcAuto.enCours) return;
  const lw = lastWeight(T);
  if (!lw || !profilComplet({ ...o, poids: lw.v })) return;
  const r = calculer({ ...o, poids: lw.v });
  if (Math.abs(r.kcal - (o.kcal || 0)) < 20 && Math.abs(r.prot - (o.prot || 0)) < 5) return;
  recalcAuto.enCours = true;
  try {
    const n = { ...DEF_OBJ, ...o, kcal: r.kcal, prot: r.prot, gluc: r.gluc, lip: r.lip };
    await store.saveObj(n);
    real.obj = n; S.obj = { ...DEF_OBJ, ...n }; render();
    toast(`🎯 Objectif ajusté à ta pesée : ${fr.format(r.kcal)} kcal par jour`);
  } catch { /* on réessaiera à la prochaine synchronisation */ }
  recalcAuto.enCours = false;
}

function renderAccount() {
  const m = store.mode, u = currentUser();
  $('accLocal').hidden = m !== 'local'; $('accOut').hidden = m !== 'signed-out'; $('accIn').hidden = m !== 'remote';
  if (u) { $('accMail').textContent = u.email || ''; $('syncSt').textContent = lastSync ? lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '–'; }
  $('scOff').hidden = m === 'remote'; $('scOn').hidden = m !== 'remote';
  if (m === 'local') $('scOff').innerHTML = '<p class="small">Le raccourci automatique a besoin de la synchronisation Supabase. En mode local, utilise le collage <code>SANTE;…</code>.</p>';
  if (m === 'remote') {
    $('scUrl').textContent = functionUrl('import-sante');
    const j = real.jeton;
    $('jetonSt').textContent = j ? `Jeton créé le ${frDate(j.cree_le.slice(0, 10))}` + (j.dernier_usage ? ` · dernier envoi le ${new Date(j.dernier_usage).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : ' · pas encore utilisé') : 'Aucun jeton pour le moment.';
    $('jetonBtn').textContent = j ? 'Créer un nouveau jeton' : 'Créer un jeton';
    // Guide du raccourci déplié tant qu'aucun jeton n'existe ; ensuite on laisse l'utilisateur choisir.
    if (!renderAccount.plie && lastSync) { $('shortcutBox').open = !j; renderAccount.plie = true; }
  }
}

function render() { renderToday(); renderEvo(); renderNotes(); renderObj(); renderAccount(); }

/* ---------- Navigation ---------- */
const TITLES = { aujourdhui: "Aujourd'hui", evolution: 'Évolution', connexion: 'Connexion' };
/** Sur l'onglet du jour, le titre devient une salutation selon l'heure. */
const salut = () => { const h = new Date().getHours(); return h < 5 ? 'Bonne nuit 🌙' : h < 12 ? 'Bonjour ☀️' : h < 18 ? 'Bon après-midi 👋' : 'Bonsoir 🌙'; };
function route() {
  const v = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : 'aujourdhui';
  document.querySelectorAll('section[data-v]').forEach((s) => s.classList.toggle('on', s.dataset.v === v));
  document.querySelectorAll('nav.tabs a').forEach((a) => { a.classList.toggle('on', a.dataset.t === v); a.toggleAttribute('aria-current', a.dataset.t === v); });
  $('ttl').textContent = v === 'aujourdhui' ? salut() : TITLES[v]; document.title = TITLES[v] + ' · Mon régime';
  if (v === 'evolution') requestAnimationFrame(renderEvo);
  window.scrollTo(0, 0);
}

/* ---------- Événements ---------- */
function bind() {
  addEventListener('hashchange', route);
  new ResizeObserver(() => renderEvo()).observe($('cW'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderEvo);

  // Import Santé (collage)
  let pending = null;
  $('imp').addEventListener('input', () => {
    pending = parseSanteText($('imp').value, T);
    $('impPrev').textContent = pending
      ? [frDate(pending.date, { day: 'numeric', month: 'long', year: 'numeric' }), pending.poids != null && fr1.format(pending.poids) + ' kg', pending.pas != null && fr.format(pending.pas) + ' pas', pending.kcal != null && fr.format(pending.kcal) + ' kcal'].filter(Boolean).join(' · ')
      : ($('imp').value ? 'Format non reconnu : le texte doit commencer par SANTE;' : '');
  });
  $('impBtn').addEventListener('click', async () => {
    if (!pending) { toast("Colle d'abord le texte du raccourci"); return; }
    const { date, ...vals } = pending;
    if (!Object.keys(vals).length) { toast('Aucune valeur reconnue'); return; }
    if (await act(() => store.saveDay(date, vals, 'collage'), 'Données du ' + frDate(date) + ' enregistrées')) { $('imp').value = ''; $('impPrev').textContent = ''; pending = null; }
  });
  $('fD').value = T;
  $('manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = { date: $('fD').value || T, poids: $('fW').value, pas: $('fS').value, kcal: $('fK').value, prot: $('fP').value, gluc: $('fG').value, lip: $('fL').value };
    const { date, ...vals } = normalize(raw, T);
    if (!Object.keys(vals).length) { toast('Remplis au moins un champ'); return; }
    if (await act(() => store.saveDay(date, vals, 'manuel'), 'Données du ' + frDate(date) + ' enregistrées')) e.target.querySelectorAll('input:not([type=date])').forEach((i) => { i.value = ''; });
  });

  // Eau et ressenti : enregistrés aussitôt, l'écran se met à jour sans attendre
  const majJour = async (vals) => {
    if (store.mode === 'signed-out') { toast("Connecte-toi (onglet Connexion) pour enregistrer"); return; }
    if (demo) { real.days[T] = { repas: [], ...real.days[T] }; }
    const avant = { ...(real.days[T] || {}) };
    real.days[T] = { repas: [], ...avant, ...vals }; applyReal();
    try { await store.saveDay(T, vals, null); }
    catch (e) { real.days[T] = avant; applyReal(); toast(e.code === 'offline' ? 'Hors ligne : réessaie une fois connecté' : 'Échec : ' + e.message); }
  };
  $('verres').addEventListener('click', (e) => {
    const b = e.target.closest('[data-verre]'); if (!b) return;
    const n = +b.dataset.verre, cur = S.days[T]?.eau || 0;
    majJour({ eau: n === cur ? n - 1 : n });
  });
  $('ressenti').addEventListener('click', (e) => {
    const b = e.target.closest('[data-res]'); if (!b) return;
    majJour({ [b.dataset.res]: +b.dataset.val });
  });

  // Alerte « il manque des données » : saisie à la main de la veille
  $('manqueSaisie').addEventListener('click', () => {
    $('importBox').open = true; $('fD').value = iso(addD(TODAY, -1));
    $('importBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // Bilan du lundi : masqué jusqu'à la semaine suivante
  $('lundiX').addEventListener('click', () => { localStorage.setItem('mr-lundi', semaineDerniere(S.days, S.obj, T).lundi); $('lundi').hidden = true; });
  // Période du graphique de poids
  document.querySelectorAll('input[name=per]').forEach((i) => i.addEventListener('change', renderEvo));

  // Import de l'historique Apple Santé
  $('histBtn').addEventListener('click', () => {
    if (store.mode === 'signed-out') { toast("Connecte-toi (onglet Connexion) pour enregistrer"); return; }
    $('histFile').click();
  });
  $('histFile').addEventListener('change', async () => {
    const file = $('histFile').files[0]; $('histFile').value = '';
    if (!file) return;
    const jours = +$('histPer').value, depuis = jours ? iso(addD(TODAY, -jours)) : '0000-00-00';
    const st = $('histSt'), barre = $('histBarre'), prog = $('histProg'), btn = $('histBtn');
    btn.disabled = true; barre.hidden = false; prog.style.width = '0%';
    try {
      st.textContent = '📖 Lecture du fichier… (ça peut prendre une minute pour un gros export)';
      const r = await lireExportSante(file, { depuis, avant: T, progres: (x) => { prog.style.width = Math.round(x * 70) + '%'; } });
      if (!r.lignes.length) { st.textContent = '🤔 Aucune donnée de poids, de pas ou de calories trouvée sur cette période.'; return; }
      st.textContent = `💾 Enregistrement de ${fr.format(r.lignes.length)} jours…`;
      await store.saveDays(r.lignes, 'export', (fait, total) => { prog.style.width = Math.round(70 + (fait / total) * 30) + '%'; });
      prog.style.width = '100%';
      const premier = frDate(r.lignes[0].date, { day: 'numeric', month: 'long', year: 'numeric' });
      st.textContent = `🎉 ${fr.format(r.lignes.length)} jours importés, depuis le ${premier}. Va voir l'onglet Évolution !`;
      await refresh();
    } catch (e) {
      st.textContent = '😕 Import impossible : ' + (e.message || e);
    } finally { btn.disabled = false; setTimeout(() => { barre.hidden = true; }, 1500); }
  });

  // Sauvegarde de mes données
  const telecharger = (nom, contenu, type) => {
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = document.createElement('a'); a.href = url; a.download = nom; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const donnees = async () => {
    if (store.mode === 'signed-out') { toast("Connecte-toi (onglet Connexion) pour exporter tes données"); return null; }
    try { return await store.exportAll(); } catch (e) { toast('Export impossible : ' + e.message); return null; }
  };
  $('expJson').addEventListener('click', async () => {
    const d = await donnees(); if (!d) return;
    telecharger(`mon-regime-${T}.json`, JSON.stringify({ exporte_le: new Date().toISOString(), ...d }, null, 2), 'application/json');
  });
  $('expCsv').addEventListener('click', async () => {
    const d = await donnees(); if (!d) return;
    // Format Excel français : point-virgule et virgule décimale, encodage UTF-8 avec BOM
    const cols = ['date', 'poids', 'pas', 'kcal', 'prot', 'gluc', 'lip', 'eau', 'faim', 'energie', 'humeur'];
    const lignes = d.jours || Object.entries(d.days || {}).map(([date, x]) => ({ date, ...x }));
    const csv = [cols.join(';'), ...lignes.sort((a, b) => (a.date < b.date ? -1 : 1)).map((l) => cols.map((c) => (l[c] == null ? '' : String(l[c]).replace('.', ','))).join(';'))].join('\r\n');
    telecharger(`mon-regime-${T}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  });

  // Synchronisation manuelle (bouton ↻ de l'en-tête)
  $('syncBtn').addEventListener('click', async () => {
    const b = $('syncBtn'); if (b.classList.contains('spin')) return;
    b.classList.add('spin');
    await refresh();
    b.classList.remove('spin');
    if ($('st').hidden) toast('Synchronisé');
  });

  // Textes enregistrés automatiquement
  const autosave = (id, stId, save, current) => {
    let t;
    $(id).addEventListener('input', () => {
      $(stId).textContent = '…'; clearTimeout(t);
      t = setTimeout(async () => {
        const v = $(id).value; if (v === current()) { $(stId).textContent = ''; return; }
        if (store.mode === 'signed-out') { $(stId).textContent = 'Connecte-toi pour enregistrer'; return; }
        try { await save(v); $(stId).textContent = 'Enregistré'; } catch (e) { $(stId).textContent = "Échec de l'enregistrement : " + e.message; }
      }, 900);
    });
  };
  autosave('notes', 'notesSt', async (v) => { await store.saveText('notes', v); real.notes = v; if (demo) applyReal(); }, () => real.notes || '');


  // Objectifs
  $('objForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const o = {};
    [['oK', 'kcal'], ['oP', 'prot'], ['oG', 'gluc'], ['oL', 'lip'], ['oS', 'pas'], ['oW', 'poidsCible']].forEach(([id, f]) => { const n = num($(id).value); if (n != null && n > 0) o[f] = f === 'poidsCible' ? Math.round(n * 10) / 10 : Math.round(n); });
    await act(() => store.saveObj({ ...DEF_OBJ, ...real.obj, ...o, mode: 'manuel' }), '🎯 Objectifs enregistrés');
  });

  // Calcul automatique : listes de choix, aperçu en direct, enregistrement
  $('actList').innerHTML = ACTIVITES.map((a) => `<label><input type="radio" name="act" value="${a.v}"><span class="e" aria-hidden="true">${a.e}</span><b>${a.nom}<span class="sugg" data-sugg="${a.v}" hidden>d'après tes pas</span></b><span class="small">${a.aide}</span></label>`).join('');
  $('rytList').innerHTML = RYTHMES.map((r) => `<label><input type="radio" name="ryt" value="${r.v}"><span class="e" aria-hidden="true">${r.e}</span>${r.nom}<span class="small">${r.aide}</span></label>`).join('');
  document.querySelectorAll('input[name=omode]').forEach((i) => i.addEventListener('change', montrerMode));
  $('calcForm').addEventListener('input', renderCalc);
  $('calcForm').addEventListener('change', renderCalc);
  $('calcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = lireProfil(), err = verifierProfil(p);
    if (err) { toast(err); return; }
    if (!profilComplet(p)) { toast('Il manque une information pour faire le calcul'); return; }
    const r = calculer(p), pas = Math.round(num($('aS').value) || real.obj?.pas || DEF_OBJ.pas);
    const o = { ...DEF_OBJ, ...real.obj, mode: 'auto', sexe: p.sexe, naissance: p.naissance, taille: p.taille, activite: p.activite, rythme: p.rythme,
      poidsCible: Math.round(p.poidsCible * 10) / 10, kcal: r.kcal, prot: r.prot, gluc: r.gluc, lip: r.lip, pas };
    const lw = lastWeight(T), poids = Math.round(p.poids * 10) / 10;
    // Un poids actuel saisi ici, différent de la dernière pesée, devient la pesée du jour.
    const pesee = (!lw || demo || Math.abs(lw.v - poids) >= 0.1) && !(S.days[T]?.poids === poids);
    await act(async () => { await store.saveObj(o); if (pesee) await store.saveDay(T, { poids }, 'manuel'); },
      `🎯 C'est parti : ${fr.format(r.kcal)} kcal par jour`);
  });

  // Compte
  let mail = '';
  $('mailForm').addEventListener('submit', async (e) => {
    e.preventDefault(); mail = $('email').value.trim(); const b = e.submitter; b.disabled = true;
    try { await sendMagicLink(mail); toast('E-mail envoyé à ' + mail); $('codeForm').hidden = false; $('code').focus(); }
    catch (err) { toast(err.status === 429 ? 'Trop de demandes : attends 1 à 2 minutes avant de redemander un e-mail' : 'Envoi impossible : ' + err.message); }
    b.disabled = false;
  });
  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = e.submitter; b.disabled = true;
    try { await verifyCode(mail || $('email').value.trim(), $('code').value.trim()); toast('Connecté'); $('codeForm').hidden = true; $('code').value = ''; }
    catch (err) { toast('Code refusé : ' + err.message); }
    b.disabled = false;
  });
  $('logout').addEventListener('click', async () => { await signOut(); store.clearCache(); });
  onAuth(() => { real = empty(); lastSync = null; refresh(); });

  $('jetonBtn').addEventListener('click', async () => {
    if (real.jeton && !confirm("Créer un nouveau jeton ? L'ancien ne fonctionnera plus : il faudra mettre à jour le raccourci.")) return;
    try { const j = await store.newJeton(); $('jetonVal').textContent = j; $('jetonBox').hidden = false; toast('Jeton créé : copie-le dans le raccourci'); real.jeton = { cree_le: new Date().toISOString() }; renderAccount(); }
    catch (err) { toast('Échec : ' + err.message); }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); toast('Copié'); } catch { toast('Copie impossible : sélectionne le texte à la main'); }
  });

  // Synchro au retour sur l'appli
  let lastVis = Date.now();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastVis > 30000) { lastVis = Date.now(); refresh(); } });
  addEventListener('online', refresh);
}

/* ---------- Thème clair / sombre ---------- */
const THEMES = { auto: { ico: '🌗', nom: 'automatique' }, light: { ico: '☀️', nom: 'clair' }, dark: { ico: '🌙', nom: 'sombre' } };
const THEME_BG = { light: '#fff6ee', dark: '#16131b' };
function themeActuel() { const t = localStorage.getItem('mr-theme'); return THEMES[t] ? t : 'auto'; }
function appliquerTheme(t, annonce) {
  const root = document.documentElement;
  if (t === 'auto') { root.removeAttribute('data-theme'); localStorage.removeItem('mr-theme'); }
  else { root.setAttribute('data-theme', t); localStorage.setItem('mr-theme', t); }
  // Couleur de la barre d'état (iPhone) et de la barre de titre (PC installé)
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => { m.content = t === 'auto' ? m.dataset.def : THEME_BG[t]; });
  $('themeIco').textContent = THEMES[t].ico;
  $('themeBtn').setAttribute('aria-label', `Thème ${THEMES[t].nom} : toucher pour changer`);
  const r = document.querySelector(`input[name=theme][value="${t}"]`); if (r) r.checked = true;
  requestAnimationFrame(renderEvo); // les graphiques lisent les couleurs du thème
  if (annonce) toast(`Thème ${THEMES[t].nom}`);
}
function theme() {
  appliquerTheme(themeActuel(), false);
  const ordre = ['auto', 'light', 'dark'];
  $('themeBtn').addEventListener('click', () => appliquerTheme(ordre[(ordre.indexOf(themeActuel()) + 1) % 3], true));
  document.querySelectorAll('input[name=theme]').forEach((i) => i.addEventListener('change', () => appliquerTheme(i.value, false)));
}

/* ---------- Installation (PWA) ---------- */
function pwa() {
  $('ver').textContent = 'Version ' + VERSION;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  // Une fois l'appli installée, le cadre d'installation n'a plus d'utilité sur cet appareil.
  $('installBox').hidden = Boolean(standalone);
  let prompt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => { if (!prompt) return; prompt.prompt(); await prompt.userChoice; prompt = null; $('installBtn').hidden = true; });
  addEventListener('appinstalled', () => { $('installBox').hidden = true; toast('Appli installée'); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- Démarrage ---------- */
(async () => {
  bind(); route(); pwa(); theme();
  if (!configured) $('st').textContent = 'Mode local : tes données restent sur cet appareil.';
  const back = await handleRedirect();
  // Un lien déjà utilisé n'est pas une erreur si l'on est connecté par ailleurs.
  if (back?.error && !currentUser()) toast('Ce lien de connexion a expiré ou a déjà servi : redemande-en un.');
  else if (back?.ok) toast('Connecté');
  route();
  const c = store.mode === 'remote' && store.cached();
  if (c) { real = c; applyReal(); }
  await refresh();
})();
