import { store, empty } from './store.js';
import { configured, currentUser, onAuth, handleRedirect, sendMagicLink, verifyCode, signOut, functionUrl } from './supabase.js';
import { num, parseSanteText, normalize } from './parse.js';
import { lineChart, barChart } from './charts.js';

const VERSION = '1.1.1';
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
const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
let TODAY = new Date(); let T = iso(TODAY);
const DEF_OBJ = { kcal: 1800, prot: 110, gluc: 180, lip: 60, pas: 8000, poidsCible: 74 };
const DEF_INGR = ['filet de poulet', 'escalope de dinde', 'cabillaud', 'pavé de saumon', 'oeufs', 'skyr', 'fromage blanc 0%', 'lentilles', 'pois chiches', 'riz basmati', 'pâtes complètes', "flocons d'avoine", 'brocoli', 'courgette', 'haricots verts surgelés', 'épinards surgelés', 'carotte', 'tomate', 'pomme', 'banane'];
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '');
const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); };

/* ---------- Données d'exemple ---------- */
function demoData() {
  const days = {}; let w = 81.6;
  for (let i = 29; i >= 0; i--) {
    const d = iso(addD(TODAY, -i)); const r = Math.sin(i * 1.7) * 0.5 + 0.5;
    w -= 0.09 + Math.sin(i * 2.3) * 0.18;
    days[d] = { poids: +w.toFixed(1), pas: Math.round(5200 + r * 6200), kcal: Math.round(1580 + Math.cos(i * 1.3) * 260), prot: Math.round(95 + r * 25), gluc: Math.round(160 + Math.cos(i) * 30), lip: Math.round(55 + Math.sin(i) * 10), repas: [] };
  }
  days[T] = { poids: days[T].poids, pas: 6240, kcal: 1385, prot: 88, gluc: 142, lip: 47, repas: [
    { id: 'd1', m: 'Matin', nom: "Skyr, flocons d'avoine, myrtilles", kcal: 340 }, { id: 'd2', m: 'Midi', nom: 'Salade lentilles, feta, concombre', kcal: 560 },
    { id: 'd3', m: 'Goûter', nom: "Pomme et 15 g d'amandes", kcal: 175 }, { id: 'd4', m: 'Soir', nom: '(prévu) recette Jow', kcal: null }] };
  const wk = iso(monday(TODAY));
  const menu = { [wk]: { 0: { nom: 'Poulet curry coco & riz', lien: 'https://jow.fr/' }, 1: { nom: 'Saumon, haricots verts, citron', lien: 'https://jow.fr/' }, 2: { nom: 'Chili sin carne', lien: 'https://jow.fr/' }, 3: { nom: 'Pâtes complètes pesto courgettes', lien: 'https://jow.fr/' }, 4: { nom: 'Bowl dinde teriyaki', lien: 'https://jow.fr/' }, 5: { nom: 'Pizza maison légère', lien: 'https://jow.fr/' }, 6: { nom: 'Soupe potimarron & tartines', lien: 'https://jow.fr/' } } };
  return { days, menu, notes: 'Acheter : potimarron, skyr, lentilles corail.\nRefaire le chili, en doublant les haricots.', obj: { ...DEF_OBJ } };
}

/* ---------- État ---------- */
let real = empty();
let S = demoData();
let demo = true;
let lastSync = null;

function applyReal() {
  const has = Object.keys(real.days).length || Object.keys(real.menu).length || (real.notes != null && real.notes !== '');
  if (has) { S = { days: real.days, menu: real.menu, notes: real.notes || '', obj: { ...DEF_OBJ, ...(real.obj || {}) } }; demo = false; }
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
      $('st').textContent = 'Hors ligne : affichage des dernières données reçues.';
    } else if (e.code !== 'not_signed_in') {
      $('st').textContent = 'Synchronisation impossible : ' + e.message;
    }
  }
  applyReal(); renderAccount();
}

function setStatus() {
  const m = store.mode;
  $('st').textContent = m === 'local' ? 'Mode local : tes données restent sur cet appareil.'
    : m === 'signed-out' ? "Connecte-toi dans l'onglet Connexion pour enregistrer et synchroniser. En attendant, voici l'exemple."
    : 'Synchronisé à ' + lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.';
}

/* ---------- Rendu : Aujourd'hui ---------- */
function lastWeight(beforeOrOn) { const ks = Object.keys(S.days).filter((k) => k <= beforeOrOn && S.days[k].poids).sort(); return ks.length ? { d: ks.at(-1), v: S.days[ks.at(-1)].poids } : null; }
function renderToday() {
  $('today').textContent = TODAY.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const d = S.days[T] || {}, o = S.obj, k = d.kcal || 0, left = o.kcal - k;
  $('left').textContent = d.kcal == null ? '–' : fr.format(left);
  $('left').style.color = left < 0 && d.kcal != null ? 'var(--tom)' : '';
  $('kcalLine').textContent = d.kcal == null ? "Pas encore de données aujourd'hui" : `${fr.format(k)} mangées sur ${fr.format(o.kcal)} kcal`;
  $('kcalBar').style.width = Math.min(100, k / o.kcal * 100) + '%'; $('kcalBar').className = k > o.kcal ? 'over' : '';
  $('kcalPct').textContent = d.kcal == null ? '' : Math.round(k / o.kcal * 100) + " % de l'objectif";
  const lw = lastWeight(T);
  $('wt').innerHTML = lw ? esc(fr1.format(lw.v)) + ' <span class="unit">kg</span>' : '–';
  const prev = lw && lastWeight(iso(addD(fromIso(lw.d), -7)));
  $('wtD').textContent = lw ? (prev ? `${lw.v - prev.v <= 0 ? '' : '+'}${fr1.format(lw.v - prev.v)} kg en 7 jours` : '') + (lw.d !== T ? ' · pesée du ' + frDate(lw.d, { day: 'numeric', month: 'short' }) : '') : '';
  $('steps').textContent = d.pas == null ? '–' : fr.format(d.pas);
  $('stepBar').style.width = Math.min(100, (d.pas || 0) / o.pas * 100) + '%'; $('stepGoal').textContent = 'Objectif ' + fr.format(o.pas);
  const M = [['Protéines', 'prot', o.prot], ['Glucides', 'gluc', o.gluc], ['Lipides', 'lip', o.lip]];
  $('macros').innerHTML = M.map(([n, f, g]) => { const v = d[f] || 0; return `<div class="macro"><span>${n}</span><div class="meter"><i class="${v > g * 1.1 ? 'over' : ''}" style="width:${Math.min(100, v / g * 100)}%"></i></div><b>${esc(fr.format(v))} / ${fr.format(g)} g</b></div>`; }).join('');
  const di = (TODAY.getDay() + 6) % 7, r = (S.menu[iso(monday(TODAY))] || {})[di];
  $('tonight').innerHTML = r && r.nom
    ? `<div><div class="n">${esc(r.nom)}</div><div class="small">${JOURS[di]} soir</div>${r.recette ? `<details><summary>Voir la recette</summary>${recHtml(r.recette)}</details>` : ''}</div>${safeUrl(r.lien) ? `<a class="btn tom" href="${esc(safeUrl(r.lien))}" target="_blank" rel="noopener noreferrer">Ouvrir dans Jow</a>` : ''}`
    : `<div><div class="n">Rien de prévu</div><div class="small">Ajoute ta recette dans l'onglet Repas Jow.</div></div><a class="btn ghost" href="#repas">Planifier</a>`;
  const rep = d.repas || [];
  $('meals').innerHTML = rep.length
    ? rep.map((m) => `<div class="meal"><span class="tag">${esc(m.m)}</span><span>${esc(m.nom)}</span><span class="k">${m.kcal != null && m.kcal !== '' ? esc(fr.format(m.kcal)) + ' kcal' : ''}</span><button class="x" data-del="${esc(m.id)}" aria-label="Supprimer ${esc(m.nom)}">×</button></div>`).join('')
    : "<p class=\"small\">Aucun repas noté aujourd'hui.</p>";
}

/* ---------- Rendu : Évolution ---------- */
function renderEvo() {
  const o = S.obj, p30 = [], p7k = [], p7s = [];
  for (let i = 29; i >= 0; i--) { const d = addD(TODAY, -i), x = S.days[iso(d)] || {}; p30.push({ v: x.poids ?? null, l: d.getDate() + '/' + (d.getMonth() + 1) }); }
  for (let i = 6; i >= 0; i--) { const d = addD(TODAY, -i), x = S.days[iso(d)] || {}, l = JOURS[(d.getDay() + 6) % 7]; p7k.push({ v: x.kcal ?? null, l }); p7s.push({ v: x.pas ?? null, l }); }
  lineChart($('cW'), p30, o.poidsCible); barChart($('cK'), p7k, o.kcal, 'kcal'); barChart($('cS'), p7s, o.pas, 'pas');
  const ws = p30.filter((p) => p.v != null);
  $('wtSum').textContent = ws.length > 1 ? `${fr1.format(ws[0].v)} → ${fr1.format(ws.at(-1).v)} kg, soit ${ws.at(-1).v - ws[0].v <= 0 ? '' : '+'}${fr1.format(ws.at(-1).v - ws[0].v)} kg sur la période.` : '';
  const k = p7k.filter((p) => p.v != null), s = p7s.filter((p) => p.v != null);
  const avg = (a) => (a.length ? Math.round(a.reduce((t, p) => t + p.v, 0) / a.length) : null);
  const inGoal = k.filter((p) => p.v <= o.kcal).length, stepOk = s.filter((p) => p.v >= o.pas).length;
  const lw = lastWeight(T), pw = lw && lastWeight(iso(addD(TODAY, -7)));
  const rows = [
    ['Calories moyennes', avg(k) != null ? fr.format(avg(k)) + ' kcal' : '–'],
    ["Jours dans l'objectif calories", k.length ? `${inGoal} / ${k.length}` : '–'],
    ['Pas moyens', avg(s) != null ? fr.format(avg(s)) : '–'],
    ['Jours à ' + fr.format(o.pas) + ' pas ou plus', s.length ? `${stepOk} / ${s.length}` : '–'],
    ['Poids sur 7 jours', lw && pw ? `${lw.v - pw.v <= 0 ? '' : '+'}${fr1.format(lw.v - pw.v)} kg` : '–'],
  ];
  if (lw && o.poidsCible) rows.push(["Reste jusqu'au poids visé", lw.v - o.poidsCible > 0 ? fr1.format(lw.v - o.poidsCible) + ' kg' : 'Atteint']);
  $('bilan').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${esc(b)}</b></div>`).join('');
}

/* ---------- Rendu : Repas ---------- */
let wOff = 0, menuKeyShown = null;
const weekKey = () => iso(addD(monday(TODAY), wOff * 7));
function renderMenu() {
  const m = addD(monday(TODAY), wOff * 7), key = iso(m), wk = S.menu[key] || {};
  $('wLbl').textContent = wOff === 0 ? 'Cette semaine' : 'Semaine du ' + m.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  // Ne pas réécrire les champs pendant la saisie.
  if (!($('menu').contains(document.activeElement) && menuKeyShown === key)) {
    $('menu').innerHTML = JOURS.map((j, i) => { const d = addD(m, i), r = wk[i] || {}; return `<div class="day${iso(d) === T ? ' today' : ''}"><div class="d">${j} <span class="small">${d.getDate()}</span></div><div class="f"><input data-i="${i}" data-f="nom" value="${esc(r.nom)}" placeholder="Recette Jow" aria-label="Recette ${j}" maxlength="300"><input data-i="${i}" data-f="lien" value="${esc(r.lien)}" placeholder="https://jow.fr/…" inputmode="url" aria-label="Lien ${j}"></div></div>`; }).join('');
    menuKeyShown = key;
  }
  if (document.activeElement !== $('notes')) $('notes').value = S.notes || '';
}

function recHtml(r) {
  const n = (x) => (x != null && x !== '' ? esc(fr.format(Math.round(+x) || 0)) : '–');
  return `<div class="rec"><h3>${esc(r.nom)}</h3><div class="chips"><span>${n(r.kcal)} kcal / portion</span><span>P ${n(r.prot)} g</span><span>G ${n(r.gluc)} g</span><span>L ${n(r.lip)} g</span>${r.temps ? `<span>${esc(r.temps)}</span>` : ''}${r.portions ? `<span>${esc(r.portions)} pers.</span>` : ''}</div>
  <b>Ingrédients</b><ul class="ing">${(r.ingredients || []).map((i) => `<li>${esc(i.qte)} ${esc(i.nom)}</li>`).join('')}</ul>
  <b>Étapes</b><ol class="steps">${(r.etapes || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ol>
  ${(r.courses || []).length ? `<b>À acheter</b><ul class="ing">${r.courses.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</div>`;
}

const ingrList = () => real.ingr || DEF_INGR;
function renderShop() {
  if (document.activeElement !== $('ingr')) $('ingr').value = ingrList().join('\n');
  if (document.activeElement !== $('placard')) $('placard').value = real.placard || '';
}

function renderObj() {
  const o = S.obj;
  [['oK', 'kcal'], ['oP', 'prot'], ['oG', 'gluc'], ['oL', 'lip'], ['oS', 'pas'], ['oW', 'poidsCible']].forEach(([id, f]) => {
    if (document.activeElement !== $(id)) $(id).value = o[f] != null ? String(o[f]).replace('.', ',') : '';
  });
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
  }
}

function render() { renderToday(); renderEvo(); renderMenu(); renderShop(); renderObj(); renderAccount(); }

/* ---------- Navigation ---------- */
const TITLES = { aujourdhui: "Aujourd'hui", evolution: 'Évolution', repas: 'Repas Jow', connexion: 'Connexion' };
function route() {
  const v = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : 'aujourdhui';
  document.querySelectorAll('section[data-v]').forEach((s) => s.classList.toggle('on', s.dataset.v === v));
  document.querySelectorAll('nav.tabs a').forEach((a) => { a.classList.toggle('on', a.dataset.t === v); a.toggleAttribute('aria-current', a.dataset.t === v); });
  $('ttl').textContent = TITLES[v]; document.title = TITLES[v] + ' · Mon régime';
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

  // Repas du jour
  $('mealForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const nom = $('mN').value.trim(); if (!nom) return;
    const kcal = num($('mK').value);
    if (await act(() => store.addMeal(T, { m: $('mM').value, nom, kcal: kcal == null ? null : Math.round(kcal) }))) { $('mN').value = ''; $('mK').value = ''; }
  });
  $('meals').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (demo) { toast('Exemple : ajoute ton premier repas pour commencer'); return; }
    await act(() => store.deleteMeal(T, b.dataset.del));
  });

  // Menu
  $('wPrev').addEventListener('click', () => { wOff--; renderMenu(); });
  $('wNext').addEventListener('click', () => { wOff++; renderMenu(); });
  let mt; let menuBusy = false;
  async function saveMenu() {
    clearTimeout(mt);
    if (menuBusy) { mt = setTimeout(saveMenu, 400); return; }
    const key = weekKey(), jours = {};
    $('menu').querySelectorAll('input').forEach((i) => { const n = i.dataset.i; jours[n] ||= { nom: '', lien: '' }; jours[n][i.dataset.f] = i.value.trim(); });
    const old = real.menu[key] || {};
    for (const n of Object.keys(jours)) {
      if (jours[n].lien && !safeUrl(jours[n].lien)) { toast('Le lien doit commencer par https://'); return; }
      if (old[n]?.recette && jours[n].nom === old[n].nom) jours[n].recette = old[n].recette;
    }
    const cur = Object.fromEntries(Object.entries(jours).filter(([, r]) => r.nom || r.lien || r.recette));
    if (JSON.stringify(cur) === JSON.stringify(old)) return;
    if (store.mode === 'signed-out') { toast("Connecte-toi (onglet Connexion) pour enregistrer"); return; }
    menuBusy = true;
    try { await store.saveMenuWeek(key, cur); real.menu[key] = cur; if (demo) applyReal(); else S.menu = real.menu; }
    catch (e) { toast('Échec : ' + e.message); }
    menuBusy = false;
  }
  $('menu').addEventListener('input', () => { clearTimeout(mt); mt = setTimeout(saveMenu, 800); });
  $('menu').addEventListener('change', saveMenu);

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
  autosave('placard', 'placSt', async (v) => { await store.saveText('placard', v); real.placard = v; }, () => real.placard || '');
  autosave('ingr', 'ingrSt', async (v) => { const l = v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 80); await store.saveIngr(l); real.ingr = l; }, () => ingrList().join('\n'));

  // Objectifs
  $('objForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const o = {};
    [['oK', 'kcal'], ['oP', 'prot'], ['oG', 'gluc'], ['oL', 'lip'], ['oS', 'pas'], ['oW', 'poidsCible']].forEach(([id, f]) => { const n = num($(id).value); if (n != null && n > 0) o[f] = f === 'poidsCible' ? Math.round(n * 10) / 10 : Math.round(n); });
    await act(() => store.saveObj({ ...DEF_OBJ, ...real.obj, ...o }), 'Objectifs enregistrés');
  });

  // Recette
  let lastRec = null;
  $('propForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (store.mode !== 'remote') { $('pOut').innerHTML = '<p class="small">La proposition de recettes passe par ton compte : connecte-toi dans l\'onglet Connexion.</p>'; return; }
    $('pBtn').disabled = true; $('pOut').innerHTML = '<p class="small">Recherche d\'une recette…</p>';
    try {
      const r = await store.proposeRecipe({ moment: $('pMom').value, envie: $('pEnv').value.trim(), date: T });
      if (!r || !r.nom) throw new Error('réponse vide');
      lastRec = r;
      $('pOut').innerHTML = recHtml(r) + `<form class="form f-prop" id="addRec"><select id="aDay" aria-label="Jour">${JOURS.map((j, i) => `<option value="${i}"${i === (TODAY.getDay() + 6) % 7 ? ' selected' : ''}>${j}</option>`).join('')}</select><button>Ajouter au menu</button><button type="button" class="ghost" id="again">Autre idée</button></form>`;
      $('again').onclick = () => $('propForm').requestSubmit();
      $('addRec').onsubmit = async (ev) => {
        ev.preventDefault(); const key = weekKey(), i = $('aDay').value;
        const jours = structuredClone(real.menu[key] || {});
        jours[i] = { nom: lastRec.nom, lien: jours[i]?.lien || '', recette: lastRec };
        await act(() => store.saveMenuWeek(key, jours), 'Ajoutée au menu de ' + JOURS[i]);
      };
    } catch (err) {
      $('pOut').innerHTML = '<p class="small">' + esc(err.status === 429 ? 'Trop de demandes, réessaie dans un moment.' : err.code === 'offline' ? 'Hors ligne : réessaie une fois connecté.' : 'Pas de recette cette fois : ' + err.message) + '</p>';
    }
    $('pBtn').disabled = false;
  });

  // Compte
  let mail = '';
  $('mailForm').addEventListener('submit', async (e) => {
    e.preventDefault(); mail = $('email').value.trim(); const b = e.submitter; b.disabled = true;
    try { await sendMagicLink(mail); toast('E-mail envoyé à ' + mail); $('codeForm').hidden = false; $('code').focus(); }
    catch (err) { toast(err.status === 429 ? 'Trop de demandes : attends une minute' : 'Envoi impossible : ' + err.message); }
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

/* ---------- Installation (PWA) ---------- */
function pwa() {
  $('ver').textContent = 'Version ' + VERSION;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('installDone').hidden = !standalone;
  let prompt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => { if (!prompt) return; prompt.prompt(); await prompt.userChoice; prompt = null; $('installBtn').hidden = true; });
  addEventListener('appinstalled', () => { $('installDone').hidden = false; $('installBtn').hidden = true; });
  if ('serviceWorker' in navigator) {
    const had = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Nouvelle version installée : elle sera active au prochain lancement'); });
  }
}

/* ---------- Démarrage ---------- */
(async () => {
  bind(); route(); pwa();
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
