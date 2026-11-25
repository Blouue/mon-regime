// Couche de données : Supabase quand il est configuré et que l'on est connecté, sinon stockage local.
// Les deux exposent la même interface ; l'interface ne connaît que `store`.
import { configured, currentUser, rest, invoke } from './supabase.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

export const empty = () => ({ days: {}, menu: {}, notes: null, obj: null, placard: '', ingr: null, jeton: null });

/* ---------------- Mode local ---------------- */
const LKEY = 'mr-local';
const local = {
  kind: 'local',
  read() { try { return { ...empty(), ...JSON.parse(localStorage.getItem(LKEY) || '{}') }; } catch { return empty(); } },
  write(r) { const { jeton, ...keep } = r; localStorage.setItem(LKEY, JSON.stringify(keep)); },
  async load() { return this.read(); },
  async mutate(fn) { const r = this.read(); fn(r); this.write(r); },
  saveDay(date, vals) { return this.mutate((r) => { r.days[date] = { repas: [], ...r.days[date], ...vals }; }); },
  addMeal(date, meal) {
    return this.mutate((r) => { const d = (r.days[date] ||= { repas: [] }); (d.repas ||= []).push({ id: crypto.randomUUID(), ...meal }); });
  },
  deleteMeal(date, id) { return this.mutate((r) => { const d = r.days[date]; if (d) d.repas = (d.repas || []).filter((m) => m.id !== id); }); },
  saveMenuWeek(semaine, jours) { return this.mutate((r) => { r.menu[semaine] = jours; }); },
  saveText(table, texte) { return this.mutate((r) => { r[table] = texte; }); },
  saveIngr(liste) { return this.mutate((r) => { r.ingr = liste; }); },
  saveObj(obj) { return this.mutate((r) => { r.obj = obj; }); },
  async newJeton() { throw new Error('Connecte-toi à ton compte pour créer un jeton.'); },
  async proposeRecipe() { throw new Error('La proposition de recettes demande un compte connecté.'); },
};

/* ---------------- Supabase ---------------- */
const uid = () => currentUser()?.id;
const remote = {
  kind: 'remote',
  async load() {
    const [obj, jours, repas, menus, notes, placard, ingr, jeton] = await Promise.all([
      rest.get('objectifs?select=*'),
      rest.get(`jours?select=*&date=gte.${ago(120)}`),
      rest.get(`repas?select=id,date,moment,nom,kcal&date=gte.${ago(14)}&order=created_at`),
      rest.get(`menus?select=*&semaine=gte.${ago(70)}`),
      rest.get('notes?select=texte'),
      rest.get('placard?select=texte'),
      rest.get('ingredients?select=liste'),
      rest.get('jetons_import?select=cree_le,dernier_usage'),
    ]);
    const r = empty();
    for (const j of jours) {
      const { user_id, date, source, updated_at, ...v } = j;
      for (const k of Object.keys(v)) if (v[k] == null) delete v[k]; else v[k] = +v[k];
      r.days[date] = { ...v, repas: [] };
    }
    for (const m of repas) (r.days[m.date] ||= { repas: [] }).repas.push({ id: m.id, m: m.moment, nom: m.nom, kcal: m.kcal });
    for (const m of menus) (r.menu[m.semaine] ||= {})[m.jour] = { nom: m.nom, lien: m.lien, ...(m.recette ? { recette: m.recette } : {}) };
    r.notes = notes[0]?.texte ?? null;
    r.placard = placard[0]?.texte ?? '';
    r.ingr = ingr[0]?.liste ?? null;
    if (obj[0]) {
      const o = obj[0];
      r.obj = Object.fromEntries(Object.entries({ kcal: o.kcal, prot: o.prot, gluc: o.gluc, lip: o.lip, pas: o.pas, poidsCible: o.poids_cible })
        .filter(([, v]) => v != null).map(([k, v]) => [k, +v]));
    }
    r.jeton = jeton[0] || null;
    return r;
  },
  saveDay(date, vals, source = 'manuel') {
    const row = { user_id: uid(), date, source };
    for (const k of ['poids', 'pas', 'kcal', 'prot', 'gluc', 'lip']) if (vals[k] != null) row[k] = vals[k];
    return rest.upsert('jours', row, 'user_id,date');
  },
  addMeal(date, meal) { return rest.insert('repas', { user_id: uid(), date, moment: meal.m, nom: meal.nom, kcal: meal.kcal }); },
  deleteMeal(date, id) { return rest.del('repas?id=eq.' + encodeURIComponent(id)); },
  async saveMenuWeek(semaine, jours) {
    const rows = [], vides = [];
    for (let i = 0; i < 7; i++) {
      const j = jours[i];
      if (j && (j.nom || j.lien || j.recette)) rows.push({ user_id: uid(), semaine, jour: i, nom: j.nom || '', lien: j.lien || '', recette: j.recette || null });
      else vides.push(i);
    }
    if (rows.length) await rest.upsert('menus', rows, 'user_id,semaine,jour');
    if (vides.length) await rest.del(`menus?semaine=eq.${semaine}&jour=in.(${vides.join(',')})`);
  },
  saveText(table, texte) { return rest.upsert(table, { user_id: uid(), texte }, 'user_id'); },
  saveIngr(liste) { return rest.upsert('ingredients', { user_id: uid(), liste }, 'user_id'); },
  saveObj(o) {
    return rest.upsert('objectifs', { user_id: uid(), kcal: o.kcal, prot: o.prot, gluc: o.gluc, lip: o.lip, pas: o.pas, poids_cible: o.poidsCible }, 'user_id');
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
  proposeRecipe(params) { return invoke('recette', params); },
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
for (const m of ['saveDay', 'addMeal', 'deleteMeal', 'saveMenuWeek', 'saveText', 'saveIngr', 'saveObj', 'newJeton', 'proposeRecipe']) {
  store[m] = (...a) => store.backend[m](...a);
}
