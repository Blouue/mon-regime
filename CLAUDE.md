# Mon régime — cahier des charges

Appli web personnelle de suivi de régime, en français. Elle regroupe Apple Santé (poids, pas, et les calories/macros que Yazio y écrit), le menu Jow saisi à la main, et des propositions de recettes. (Le relevé de disponibilité au E.Leclerc Drive de Saint-Berthevin a été abandonné : voir plus bas.)

Un prototype fonctionnel existe : `prototype/index.html`, publié comme artifact Claude (https://claude.ai/artifact/Rs55sPYTi2v3K7P5ypfc7H). Il valide le contenu et le design. Ce projet en fait une vraie appli.

## Pourquoi on quitte le prototype
- Ce n'est pas une vraie PWA : pas de service worker, pas d'installation propre dans Chrome/Edge, et elle dépend de la session Claude.
- Le raccourci iPhone ne peut pas envoyer de données à la page. Aujourd'hui l'utilisateur doit coller les données à la main chaque soir.
- Le relevé Leclerc passait par une tâche programmée de Claude, qui exigeait que le PC soit allumé et l'appli Claude ouverte.

## Cible
- **PWA installable** : manifest, service worker (hors-ligne pour l'interface et les dernières données), icônes 192/512 et apple-touch-icon. Installable sur iPhone (Safari → Sur l'écran d'accueil) et sur PC (Chrome/Edge).
- **Hébergement gratuit** en HTTPS : GitHub Pages (choisi). Pas d'étape de build : le dossier `app/` est publié tel quel.
- **Synchronisation iPhone ↔ PC** : Supabase (offre gratuite). Tables : `jours`, `repas`, `menus`, `notes`, `objectifs`, `placard`, `ingredients`, `jetons_import` (empreinte du jeton du raccourci). `dispo_leclerc` existe encore dans la base mais n'est plus utilisée. Connexion par lien magique par e-mail, avec RLS pour que chacun ne voie que ses données.
- **Import automatique depuis Apple Santé** : un endpoint (Supabase Edge Function) reçoit un POST JSON du raccourci iPhone, avec un jeton secret personnel en en-tête. Le raccourci (action « Obtenir le contenu de l'URL », méthode POST) envoie chaque soir : date, poids, pas, kcal, protéines, glucides, lipides. Les virgules décimales et les unités (« 78,4 kg ») doivent être acceptées. Garder l'import par copier-coller (`SANTE;date=…;poids=…`) en secours.
- **Propositions de recettes** : bouton « Proposer une recette » qui appelle l'API Claude depuis une Edge Function. La clé API reste côté serveur, jamais dans le navigateur. Entrées : reste du jour (kcal et macros), garde-manger, ingrédients courants, envie. Sortie JSON : nom, portions, temps, kcal, prot, gluc, lip, ingredients[{nom, qte}], etapes[], courses[]. Modèle par défaut : `claude-haiku-5-5` (le moins cher), réglable par le secret `CLAUDE_MODEL`. Bouton « Ajouter au menu ».
- ~~**Relevé Leclerc Drive hebdomadaire**~~ (abandonné le 25/11/2026) : script Playwright lancé par le Planificateur de tâches Windows le dimanche vers 10 h, qui écrit dans `dispo_leclerc`. URL de recherche : `https://fd14-courses.leclercdrive.fr/magasin-025302-025302-Saint-Berthevin/recherche.aspx?TexteRecherche=<terme>`. Sélecteurs testés le 25/11/2026 : cartes `li[class*="WCRS310_Product"]`, disponibilité dans `data-vignette="disponible"`, nom dans `.pWCRS310_Desc a`, prix dans `.pWCRS310_PrixUnitairePartieEntiere` + `.pWCRS310_PrixUnitairePartieDecimale`, prix au kilo dans `.pWCRS310_PrixUniteMesure`. Les produits sont rendus côté client : attendre leur chargement. Pas de compte, pas de panier, un rythme lent (quelques secondes entre les requêtes). Remonter un message clair si la structure du site change.
  - **Constat du 25/11/2026** : le site est protégé par DataDome. Un navigateur automatisé (Playwright, Chromium sans interface) reçoit un 403 et un CAPTCHA au lieu des produits. On ne contourne pas cette protection : le relevé automatique tel que décrit ci-dessus n'est pas réalisable. **Décision : on s'en passe.** Le cadre « Dispo Leclerc » a été retiré de l'appli, et les recettes s'appuient sur les ingrédients courants.

## Écrans (repris du prototype)
1. **Aujourd'hui** : calories restantes (grand chiffre), poids et écart sur 7 jours, pas et barre d'objectif, macros (protéines, glucides, lipides) en barres, recette du soir (lien Jow ou recette générée), journal des repas (moment, nom, kcal), import Santé et saisie manuelle.
2. **Évolution** : courbe de poids sur 30 jours avec la ligne d'objectif, barres de calories et de pas sur 7 jours, bilan de la semaine (calories moyennes, jours dans l'objectif, pas moyens, variation de poids, reste jusqu'au poids visé).
3. **Repas Jow** : menu de la semaine (nom + lien Jow par jour, navigation entre semaines), proposition de recette, ingrédients courants, garde-manger, notes.
4. **Connexion** : objectifs (kcal, protéines, glucides, lipides, pas, poids visé), réglages Yazio → Apple Santé, création du raccourci iPhone pas à pas (avec l'URL de l'endpoint et le jeton), état de la synchro, et l'installation de l'appli.

## Design
Garder celui du prototype : esprit « étiquette Valeurs nutritionnelles », filets noirs épais, police Archivo, papier blanc chaud `#fffdf8`, encre `#161616`, accent tomate `#d8401f`, vert herbe `#2e7d4f`, thème sombre. Mobile d'abord, barre d'onglets en bas, prise en compte des zones sûres iPhone.

## Données d'exemple
Afficher un jeu d'exemple tant que l'utilisateur n'a rien saisi (voir `demoData()` dans le prototype), avec un bandeau qui le signale.

## Contraintes
- Tout en français, nombres au format fr-FR.
- Aucun secret dans le code client ni dans le dépôt (`.env`, secrets Supabase/Vercel).
- Ce sont des données de santé personnelles : RLS stricte, HTTPS, pas de tracking.
- Jow n'a pas d'API : la saisie reste manuelle.
- Ne jamais valider de commande Leclerc.

## Ordre de travail proposé
1. Projet en JS vanilla sans build (Node n'était pas installé au départ) qui reprend l'interface du prototype, avec manifest et service worker.
2. Supabase : schéma, RLS, authentification, branchement de l'interface.
3. Déploiement (GitHub + Vercel ou Pages) et test d'installation sur iPhone et PC.
4. Edge Function d'import Santé et guide du raccourci iPhone.
5. Edge Function des recettes (API Claude).
6. ~~Script Playwright Leclerc et tâche planifiée Windows~~ : abandonné (DataDome).
