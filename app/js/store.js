// Couche de données : Supabase quand il est configuré et que l'on est connecté, sinon stockage local.
// Les deux exposent la même interface ; l'interface ne connaît que `store`.
import { configured, currentUser, rest } from './supabase.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

export const empty = () => ({ days: {}, notes: null, obj: null, jeton: null });
/** Champs d'une journée enregistrés en base. */
export const CHAMPS = ['poids', 'pas', 'kcal', 'prot', 'gluc', 'lip', 'eau', 'faim', 'energie', 'humeur'];

/* ---------------- Mode local ---------------- */
const LKEY = 'mr-local';
const local = {
  kind: 'local',
  read() { try { return { ...empty(), ...JSON.parse(localStorage.getItem(LKEY) || '{}') }; } catch { return empty(); } },
  write(r) { const { jeton, ...keep } = r; localStorage.setItem(LKEY, JSON.stringify(keep)); },
  async load() { return this.read(); },
  async mutate(fn) { const r = this.read(); fn(r); this.write(r); },
  saveDay(date, vals, source = 'manuel') { return this.mutate((r) => { const a = r.days[date] || {}; r.days[date] = { repas: [], ...a, ...vals, ...(source ? { _maj: new Date().toISOString(), _src: source } : {}) }; }); },
  saveDays(rows, source = 'export') { return this.mutate((r) => { for (const { date, ...v } of rows) r.days[date] = { repas: [], ...r.days[date], ...v, _maj: new Date().toISOString(), _src: source }; }); },
  async exportAll() { const { jeton, ...r } = this.read(); return r; },
  addMeal(date, meal) {
    return this.mutate((r) => { const d = (r.days[date] ||= { repas: [] }); (d.repas ||= []).push({ id: crypto.randomUUID(), ...meal }); });
  },
  deleteMeal(date, id) { return this.mutate((r) => { const d = r.days[date]; if (d) d.repas = (d.repas || []).filter((m) => m.id !== id); }); },
  saveText(table, texte) { return this.mutate((r) => { r[table] = texte; }); },
  saveObj(obj) { return this.mutate((r) => { r.obj = obj; }); },
  async newJeton() { throw new Error('Connecte-toi à ton compte pour créer un jeton.'); },
};

/* ---------------- Supabase ---------------- */
const uid = () => currentUser()?.id;
const remote = {
  kind: 'remote',
  async load() {
    const [obj, jours, repas, notes, jeton] = await Promise.all([
      rest.get('objectifs?select=*'),
      rest.get(`jours?select=*&date=gte.${ago(400)}&order=date`),
      rest.get(`repas?select=id,date,moment,nom,kcal&date=gte.${ago(14)}&order=created_at`),
      rest.get('notes?select=texte'),
      rest.get('jetons_import?select=cree_le,dernier_usage'),
    ]);
    const r = empty();
    for (const j of jours) {
      const { user_id, date, source, updated_at, ...v } = j;
      for (const k of Object.keys(v)) if (v[k] == null) delete v[k]; else v[k] = +v[k];
      r.days[date] = { ...v, repas: [], _maj: updated_at, _src: source };
    }
    for (const m of repas) (r.days[m.date] ||= { repas: [] }).repas.push({ id: m.id, m: m.moment, nom: m.nom, kcal: m.kcal });
    r.notes = notes[0]?.texte ?? null;
    if (obj[0]) {
      const o = obj[0];
      r.obj = Object.fromEntries(Object.entries({ kcal: o.kcal, prot: o.prot, gluc: o.gluc, lip: o.lip, pas: o.pas, poidsCible: o.poids_cible, naissance: o.naissance, taille: o.taille, activite: o.activite, rythme: o.rythme })
        .filter(([, v]) => v != null).map(([k, v]) => [k, +v]));
      if (o.sexe) r.obj.sexe = o.sexe;
      r.obj.mode = o.mode || 'manuel';
    }
    r.jeton = jeton[0] || null;
    return r;
  },
  saveDay(date, vals, source = 'manuel') {
    // source null : on ne touche pas à la source du jour (ex. l'eau ne doit pas masquer l'envoi du raccourci).
    const row = { user_id: uid(), date, ...(source ? { source } : {}) };
    for (const k of CHAMPS) if (vals[k] != null) row[k] = vals[k];
    return rest.upsert('jours', row, 'user_id,date');
  },
  /** Enregistre beaucoup de journées d'un coup (import de l'historique). N'écrase que les champs fournis. */
  async saveDays(rows, source = 'export', progres) {
    // PostgREST exige les mêmes colonnes dans un lot : on groupe les journées par ensemble de champs.
    const groupes = new Map();
    for (const { date, ...v } of rows) {
      const ks = CHAMPS.filter((k) => v[k] != null); if (!ks.length) continue;
      const cle = ks.join(','), ligne = { user_id: uid(), date, source };
      for (const k of ks) ligne[k] = v[k];
      (groupes.get(cle) || groupes.set(cle, []).get(cle)).push(ligne);
    }
    let fait = 0; const total = [...groupes.values()].reduce((t, g) => t + g.length, 0);
    for (const g of groupes.values()) {
      for (let i = 0; i < g.length; i += 400) {
        await rest.upsert('jours', g.slice(i, i + 400), 'user_id,date');
        fait += Math.min(400, g.length - i); progres?.(fait, total);
      }
    }
    return total;
  },
  /** Toutes les données du compte, pour la sauvegarde. */
  async exportAll() {
    const tout = async (table, ordre) => { const res = []; for (let o = 0; ; o += 1000) { const p = await rest.get(`${table}?select=*&order=${ordre}&offset=${o}&limit=1000`); res.push(...p); if (p.length < 1000) return res; } };
    const [jours, repas, obj, notes] = await Promise.all([tout('jours', 'date'), tout('repas', 'date'), rest.get('objectifs?select=*'), rest.get('notes?select=texte')]);
    const nettoie = (l) => l.map(({ user_id, ...x }) => x);
    return { jours: nettoie(jours), repas: nettoie(repas), objectifs: nettoie(obj)[0] || null, notes: notes[0]?.texte ?? '' };
  },
  addMeal(date, meal) { return rest.insert('repas', { user_id: uid(), date, moment: meal.m, nom: meal.nom, kcal: meal.kcal }); },
  deleteMeal(date, id) { return rest.del('repas?id=eq.' + encodeURIComponent(id)); },
  saveText(table, texte) { return rest.upsert(table, { user_id: uid(), texte }, 'user_id'); },
  saveObj(o) {
    return rest.upsert('objectifs', {
      user_id: uid(), kcal: o.kcal, prot: o.prot, gluc: o.gluc, lip: o.lip, pas: o.pas, poids_cible: o.poidsCible,
      mode: o.mode || 'manuel', sexe: o.sexe ?? null, naissance: o.naissance ?? null, taille: o.taille ?? null, activite: o.activite ?? null, rythme: o.rythme ?? null,
    }, 'user_id');
  },
  /** Crée un nouveau jeton pour le raccourci. Seule son empreinte est stockée : il ne s'affiche qu'une fois. */
  async newJeton() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    const jeton = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton));
    const hex = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
    await rest.del('jetons_import?user_id=eq.' + uid());
    await rest.insert('jetons_import', { user_id: uid(), jeton_hash: hex });
    return jeton;
  },
};

/* ---------------- Sélection et cache hors-ligne ---------------- */
export const store = {
  get backend() { return configured && currentUser() ? remote : local; },
  get mode() { return !configured ? 'local' : currentUser() ? 'remote' : 'signed-out'; },
  cacheKey() { return 'mr-cache-' + (uid() || 'local'); },
  cached() { try { return JSON.parse(localStorage.getItem(this.cacheKey()) || 'null'); } catch { return null; } },
  async load() {
    const r = await this.backend.load();
    if (this.backend === remote) localStorage.setItem(this.cacheKey(), JSON.stringify(r));
    return r;
  },
  clearCache() { Object.keys(localStorage).filter((k) => k.startsWith('mr-cache-')).forEach((k) => localStorage.removeItem(k)); },
};
for (const m of ['saveDay', 'saveDays', 'addMeal', 'deleteMeal', 'saveText', 'saveObj', 'newJeton', 'exportAll']) {
  store[m] = (...a) => store.backend[m](...a);
}
