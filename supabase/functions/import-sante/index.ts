// Reçoit chaque soir les données Apple Santé envoyées par le raccourci iPhone.
// POST JSON {date, poids, pas, kcal, prot, gluc, lip} (ou texte « SANTE;date=…;poids=… »)
// avec l'en-tête X-Jeton: <jeton personnel>. Déployer avec --no-verify-jwt (le jeton remplace la connexion).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalize, parseSanteText, todayParis } from '../_shared/parse.js';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const reply = (status: number, message: string) =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'Utilise la méthode POST.');

  const jeton = (req.headers.get('x-jeton') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '').trim();
  if (jeton.length < 20) return reply(401, 'Jeton manquant : ajoute l’en-tête X-Jeton dans le raccourci.');
  const { data: owner, error: e1 } = await admin.from('jetons_import').select('user_id').eq('jeton_hash', await sha256(jeton)).maybeSingle();
  if (e1) return reply(500, 'Erreur serveur, réessaie plus tard.');
  if (!owner) return reply(401, 'Jeton inconnu : crée-en un nouveau dans l’onglet Connexion de l’appli.');

  const raw = await req.text();
  if (raw.length > 10_000) return reply(413, 'Requête trop grande.');
  let vals: Record<string, unknown> | null = null;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && !Array.isArray(j)) vals = normalize(j, todayParis());
  } catch {
    vals = parseSanteText(raw, todayParis());
  }
  if (!vals) return reply(400, 'Format non reconnu : envoie un JSON {date, poids, pas, kcal, prot, gluc, lip}.');

  const { date, ...mesures } = vals as { date: string } & Record<string, number>;
  if (!Object.keys(mesures).length) return reply(400, 'Aucune valeur reconnue dans l’envoi.');

  const { error: e2 } = await admin.from('jours').upsert(
    { user_id: owner.user_id, date, source: 'raccourci', ...mesures },
    { onConflict: 'user_id,date' },
  );
  if (e2) return reply(500, 'Enregistrement impossible : ' + e2.message);
  await admin.from('jetons_import').update({ dernier_usage: new Date().toISOString() }).eq('user_id', owner.user_id);

  const [y, m, d] = date.split('-');
  const resume = [
    mesures.poids != null && `${String(mesures.poids).replace('.', ',')} kg`,
    mesures.pas != null && `${mesures.pas.toLocaleString('fr-FR')} pas`,
    mesures.kcal != null && `${mesures.kcal.toLocaleString('fr-FR')} kcal`,
  ].filter(Boolean).join(' · ');
  return reply(200, `Données du ${d}/${m}/${y} enregistrées${resume ? ' : ' + resume : ''}.`);
});
