# Mon régime

Appli web personnelle (PWA) de suivi de régime : Apple Santé via un raccourci iPhone, menus Jow, recettes proposées par Claude.
Le cahier des charges est dans `CLAUDE.md`.

## Organisation

| Dossier | Contenu |
|---|---|
| `app/` | L'appli, en HTML/CSS/JS sans étape de build. C'est ce dossier qui est publié. |
| `app/config.js` | L'URL Supabase et la clé publique « anon ». Laisser vide pour le mode local. |
| `supabase/migrations/` | Schéma SQL et règles RLS. |
| `supabase/functions/import-sante` | Reçoit les données du raccourci iPhone (jeton `X-Jeton`). |
| `supabase/functions/recette` | Propose une recette via l'API Claude (la clé reste côté serveur). |
| `tools/serve.ps1` | Serveur local de test : `http://localhost:5173/`. |
| `tools/make-icons.ps1` | Régénère les icônes. |
| `prototype/` | L'ancien prototype, pour référence. |

## Tester en local

```powershell
powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 5173
```

Tant que `config.js` est vide, l'appli tourne en **mode local** : les données restent dans le navigateur.

## Mise en route de Supabase (offre gratuite)

1. Crée un projet sur supabase.com, région Europe (Paris ou Francfort).
2. Ouvre **SQL Editor**, colle le contenu de `supabase/migrations/20261125000000_schema.sql` et clique sur **Run**.
3. Dans **Authentication → Sign In / Providers**, garde **Email** activé.
4. Dans **Authentication → Emails → Magic Link**, ajoute le code dans le modèle, par exemple
   `<p>Ton code : <b>{{ .Token }}</b></p>`, à côté du lien. Sur iPhone, l'appli installée ne partage pas sa session avec Safari : il faut donc pouvoir se connecter avec le code.
5. Dans **Authentication → URL Configuration**, mets l'adresse de l'appli (par ex. `https://<ton-compte>.github.io/mon-regime/`) en *Site URL* et dans *Redirect URLs*. Ajoute aussi `http://localhost:5173/` pour les tests.
6. Dans **Project Settings → API**, copie *Project URL* et la clé *anon / publishable* dans `app/config.js`. **Jamais la clé service_role.**
7. Connecte-toi une première fois dans l'appli. Ensuite, désactive les inscriptions (**Authentication → Sign In / Providers → Allow new users to sign up**) : personne d'autre ne pourra créer de compte, et donc personne d'autre ne pourra appeler l'API Claude à tes frais.

### Edge Functions

Avec la CLI Supabase (`npm i -g supabase`, ou `scoop install supabase`) :

```powershell
supabase login
supabase link --project-ref <ref-du-projet>
supabase secrets set ANTHROPIC_API_KEY=<ta-clé> APP_ORIGIN=https://<ton-compte>.github.io
supabase functions deploy import-sante --no-verify-jwt
supabase functions deploy recette
```

`CLAUDE_MODEL` est un secret facultatif : `claude-haiku-5-5` par défaut (environ 0,002 $ par recette). Mets `claude-opus-5-5` pour des recettes plus fines (environ 0,05 $).
On peut aussi créer les fonctions sans CLI, depuis le tableau de bord (Edge Functions → Deploy a new function) : il faut alors y coller aussi `_shared/parse.js`.

## Déploiement sur GitHub Pages (gratuit, HTTPS)

1. Crée un dépôt GitHub (privé ou public), par ex. `mon-regime`, et pousse ce dossier dessus.
2. Dans **Settings → Pages → Source**, choisis **GitHub Actions**. Le workflow `.github/workflows/pages.yml` publie `app/` à chaque push sur `main`.
3. Remarque : avec un compte gratuit, Pages n'est disponible que pour un dépôt **public**. Aucun secret n'y figure (`config.js` ne contient que des valeurs publiques), mais le code sera visible. Pour un dépôt privé, Netlify ou Cloudflare Pages (gratuits) savent publier le dossier `app/`.

## Mises à jour de l'appli

Le service worker va chercher chaque fichier sur le réseau d'abord (la page et les scripts restent de la même version) et se sert de son cache hors-ligne ou si le réseau met plus de 4 s à répondre. Quand un fichier est ajouté ou retiré, mets à jour la liste `SHELL` et la constante `VERSION` dans `app/sw.js`.

## Police

Archivo (OFL, licence dans `app/fonts/OFL.txt`) est hébergée avec l'appli, sous-ensemble latin, plutôt que chargée depuis Google Fonts, pour éviter tout pistage.
