// Petit client Supabase sans dépendance : authentification par e-mail (lien ou code) et API REST.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const BASE = SUPABASE_URL.replace(/\/+$/, '');
const KEY = 'mr-session';

let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const listeners = new Set();

function setSession(s) {
  session = s;
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
  listeners.forEach((f) => f(s));
}
export const onAuth = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const currentUser = () => session?.user || null;

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const h = { apikey: SUPABASE_ANON_KEY, ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) {
    const t = await accessToken();
    if (!t) throw new ApiError('Non connecté', 401, 'not_signed_in');
    h.Authorization = 'Bearer ' + t;
  } else {
    h.Authorization = 'Bearer ' + SUPABASE_ANON_KEY;
  }
  let r;
  try {
    r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Pas de connexion réseau', 0, 'offline');
  }
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) {
    if (r.status === 401 && auth) setSession(null);
    const msg = data?.msg || data?.message || data?.error_description || data?.error || 'Erreur ' + r.status;
    throw new ApiError(msg, r.status, data?.code || data?.error_code);
  }
  return data;
}

function fromTokenResponse(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: +d.expires_at || Math.floor(Date.now() / 1000) + (+d.expires_in || 3600),
    user: d.user ? { id: d.user.id, email: d.user.email } : null,
  };
}

let refreshing = null;
async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  if (!refreshing) {
    refreshing = call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false })
      .then((d) => { setSession(fromTokenResponse(d)); return session.access_token; })
      .catch((e) => { if (e.code !== 'offline') setSession(null); return e.code === 'offline' ? session?.access_token : null; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** À appeler au démarrage : récupère la session si l'on revient d'un lien magique. */
export async function handleRedirect() {
  if (!configured) return null;
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#connexion');
  if (p.get('error_description')) return { error: p.get('error_description').replace(/\+/g, ' ') };
  const s = fromTokenResponse(Object.fromEntries(p));
  session = s; // nécessaire pour l'appel suivant
  try {
    const u = await call('/auth/v1/user');
    setSession({ ...s, user: { id: u.id, email: u.email } });
    return { ok: true };
  } catch (e) {
    setSession(null);
    return { error: e.message };
  }
}

export function sendMagicLink(email) {
  const redirect = location.origin + location.pathname;
  return call('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
    method: 'POST', auth: false, body: { email, create_user: true },
  });
}

/** Code à 6 chiffres reçu par e-mail : indispensable sur iPhone, où l'appli installée ne partage pas la session de Safari. */
export async function verifyCode(email, token) {
  const d = await call('/auth/v1/verify', { method: 'POST', auth: false, body: { type: 'email', email, token } });
  setSession(fromTokenResponse(d));
}

export async function signOut() {
  try { await call('/auth/v1/logout', { method: 'POST' }); } catch { /* on déconnecte quand même */ }
  setSession(null);
}

/** Appels PostgREST. `path` commence par le nom de la table, ex. "jours?select=*". */
export const rest = {
  get: (path) => call('/rest/v1/' + path),
  upsert: (table, rows, onConflict) => call(`/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  }),
  insert: (table, rows, ret = false) => call('/rest/v1/' + table, {
    method: 'POST', body: rows, headers: { Prefer: ret ? 'return=representation' : 'return=minimal' },
  }),
  del: (path) => call('/rest/v1/' + path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
};

export const functionUrl = (name) => `${BASE}/functions/v1/${name}`;
export const invoke = (name, body) => call('/functions/v1/' + name, { method: 'POST', body });
