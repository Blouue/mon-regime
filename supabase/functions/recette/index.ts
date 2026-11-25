// Propose une recette calée sur le reste du jour, le garde-manger et les ingrédients courants.
// Appelée par l'appli avec la session de l'utilisateur (JWT vérifié par Supabase).
// La clé API Claude reste ici, en secret Supabase : ANTHROPIC_API_KEY.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGIN = Deno.env.get('APP_ORIGIN') || '*';
// Haiku 5.5 : environ 0,002 $ par recette. Pour des recettes plus fines (environ 0,05 $),
// mettre le secret CLAUDE_MODEL à claude-opus-5-5 ou claude-sonnet-5-5.
const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-5-5';
// Le repli automatique en cas de refus n'existe que sur Opus, Sonnet 5.5 et Fable.
const FALLBACK = /^claude-(opus|sonnet-5-5|fable)/.test(MODEL);
const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

const DEF_OBJ = { kcal: 1800, prot: 110, gluc: 180, lip: 60 };
const MOMENTS = ['Matin', 'Midi', 'Goûter', 'Soir'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nom', 'portions', 'temps', 'kcal', 'prot', 'gluc', 'lip', 'ingredients', 'etapes', 'courses'],
  properties: {
    nom: { type: 'string' },
    portions: { type: 'integer' },
    temps: { type: 'string' },
    kcal: { type: 'integer' },
    prot: { type: 'integer' },
    gluc: { type: 'integer' },
    lip: { type: 'integer' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nom', 'qte'],
        properties: { nom: { type: 'string' }, qte: { type: 'string' } },
      },
    },
    etapes: { type: 'array', items: { type: 'string' } },
    courses: { type: 'array', items: { type: 'string' } },
  },
};

const anthropic = new Anthropic(); // lit ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json(405, { message: 'Méthode non autorisée' });

  const auth = req.headers.get('Authorization') || '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!u?.user) return json(401, { message: 'Connexion requise' });

  let body: { moment?: string; envie?: string; date?: string } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const moment = MOMENTS.includes(body.moment || '') ? body.moment! : 'Soir';
  const envie = String(body.envie || '').slice(0, 200);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date! : new Date().toISOString().slice(0, 10);

  // Lecture sous RLS : seules les données de l'utilisateur sont visibles.
  const [obj, jour, placard, ingr] = await Promise.all([
    db.from('objectifs').select('kcal,prot,gluc,lip').maybeSingle(),
    db.from('jours').select('kcal,prot,gluc,lip').eq('date', date).maybeSingle(),
    db.from('placard').select('texte').maybeSingle(),
    db.from('ingredients').select('liste').maybeSingle(),
  ]);
  const o = { ...DEF_OBJ, ...Object.fromEntries(Object.entries(obj.data || {}).filter(([, v]) => v != null)) } as typeof DEF_OBJ;
  const j = jour.data || {} as Record<string, number | null>;
  const rest = {
    kcal: o.kcal - (j.kcal || 0), prot: o.prot - (j.prot || 0), gluc: o.gluc - (j.gluc || 0), lip: o.lip - (j.lip || 0),
  };
  const courants = (ingr.data?.liste || []) as string[];

  const prompt = `Propose UNE recette en français pour le repas « ${moment} », pour 1 personne qui suit un régime de perte de poids équilibré.
Budget restant aujourd'hui : ${Math.max(250, rest.kcal)} kcal, protéines ${Math.max(0, rest.prot)} g, glucides ${Math.max(0, rest.gluc)} g, lipides ${Math.max(0, rest.lip)} g. Vise environ ${Math.max(300, Math.min(rest.kcal, 800))} kcal pour ce repas, riche en protéines.
Envie : ${envie || 'aucune'}.
Déjà à la maison : ${placard.data?.texte?.slice(0, 2000) || 'non précisé'}.
Ingrédients que j'achète d'habitude : ${courants.join(', ') || 'non précisé'}.
Privilégie ce qui est à la maison, puis mes ingrédients habituels, avec des produits faciles à trouver en supermarché. Recette simple, 30 min maximum.
Valeurs nutritionnelles par portion, entières. « courses » liste ce qu'il faut acheter.`;

  try {
    const params = {
      model: MODEL,
      max_tokens: 16000,
      system: 'Tu es un cuisinier-diététicien. Tu réponds uniquement avec la recette demandée, au format imposé.',
      output_config: { effort: 'medium' as const, format: { type: 'json_schema' as const, schema: SCHEMA } },
      messages: [{ role: 'user' as const, content: prompt }],
    };
    const r = FALLBACK
      ? await anthropic.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await anthropic.messages.create(params);
    if (r.stop_reason === 'refusal') return json(422, { message: 'La demande a été refusée, reformule ton envie.' });
    const text = r.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json(502, { message: 'Réponse vide' });
    return json(200, JSON.parse(text.text));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json(429, { message: 'Trop de demandes' });
    if (e instanceof Anthropic.AuthenticationError) return json(500, { message: 'Clé API Claude absente ou invalide côté serveur' });
    if (e instanceof Anthropic.APIError) {
      // deno-lint-ignore no-explicit-any
      const detail = String((e as any).error?.error?.message || e.message || '');
      console.error('API Claude', e.status, detail);
      if (/credit balance/i.test(detail)) return json(402, { message: 'Crédit API Claude épuisé : ajoute du crédit dans la Console Claude (Facturation).' });
      return json(502, { message: `Service de recettes indisponible (${e.status}) : ${detail.slice(0, 200)}` });
    }
    if (e instanceof SyntaxError) return json(502, { message: 'Réponse illisible' });
    throw e;
  }
});
