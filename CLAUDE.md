# Mon régime — cahier des charges

Appli web personnelle de suivi de régime, en français. Elle regroupe Apple Santé (poids, pas, et les calories/macros que Yazio y écrit), des objectifs calculés automatiquement. Les menus et recettes se font directement dans l'appli Jow (décision du 25/11/2026) ; le relevé Leclerc Drive a été abandonné (voir plus bas).

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
- ~~**Propositions de recettes**~~ (retirées le 25/11/2026 : l'utilisateur passe par l'appli Jow ; la fonction `recette` a été supprimée de Supabase avec ses secrets, son code reste dans l'historique Git ; les tables `menus`, `placard`, `ingredients` ne sont plus utilisées) : bouton « Proposer une recette » qui appelle l'API Claude depuis une Edge Function. La clé API reste côté serveur, jamais dans le navigateur. Entrées : reste du jour (kcal et macros), garde-manger, ingrédients courants, envie. Sortie JSON : nom, portions, temps, kcal, prot, gluc, lip, ingredients[{nom, qte}], etapes[], courses[]. Modèle par défaut : `claude-haiku-5-5` (le moins cher), réglable par le secret `CLAUDE_MODEL`. Bouton « Ajouter au menu ».
- ~~**Relevé Leclerc Drive hebdomadaire**~~ (abandonné le 25/11/2026) : script Playwright lancé par le Planificateur de tâches Windows le dimanche vers 10 h, qui écrit dans `dispo_leclerc`. URL de recherche : `https://fd14-courses.leclercdrive.fr/magasin-025302-025302-Saint-Berthevin/recherche.aspx?TexteRecherche=<terme>`. Sélecteurs testés le 25/11/2026 : cartes `li[class*="WCRS310_Product"]`, disponibilité dans `data-vignette="disponible"`, nom dans `.pWCRS310_Desc a`, prix dans `.pWCRS310_PrixUnitairePartieEntiere` + `.pWCRS310_PrixUnitairePartieDecimale`, prix au kilo dans `.pWCRS310_PrixUniteMesure`. Les produits sont rendus côté client : attendre leur chargement. Pas de compte, pas de panier, un rythme lent (quelques secondes entre les requêtes). Remonter un message clair si la structure du site change.
  - **Constat du 25/11/2026** : le site est protégé par DataDome. Un navigateur automatisé (Playwright, Chromium sans interface) reçoit un 403 et un CAPTCHA au lieu des produits. On ne contourne pas cette protection : le relevé automatique tel que décrit ci-dessus n'est pas réalisable. **Décision : on s'en passe.** Le cadre « Dispo Leclerc » a été retiré de l'appli, et les recettes s'appuient sur les ingrédients courants.

## Écrans (repris du prototype)
1. **Aujourd'hui** : calories restantes (grand chiffre), poids et écart sur 7 jours, pas et barre d'objectif, macros (protéines, glucides, lipides) en barres, alerte quand le raccourci n'a rien envoyé (avec lancement du raccourci via `shortcuts://run-shortcut`), bilan de la semaine le lundi, (le journal des repas, puis l'eau et le ressenti ont été retirés les 25 et 26/11 : jugés inutiles par l'utilisateur ; les colonnes eau, faim, energie, humeur restent en base et dans l'export CSV), saisie manuelle et collage Santé repliés, notes.
2. **Évolution** : courbe de poids sur 30 jours, 3 mois ou 1 an : pesées en points et **tendance lissée** (moyenne exponentielle à 15 %, `app/js/suivi.js`), avec rythme actuel et date projetée du poids visé ; séries et badges ; bilan de la semaine passée ; ligne d'objectif, barres de calories et de pas sur 7 jours, bilan de la semaine (calories moyennes, jours dans l'objectif, pas moyens, variation de poids, reste jusqu'au poids visé).
3. ~~**Repas Jow**~~ : onglet retiré le 25/11/2026, puis le bouton « Ouvrir Jow » le 26/11 (l'utilisateur ouvre Jow directement). Les notes sont en bas d'Aujourd'hui.
4. **Connexion** : **import de l'historique** depuis l'export Apple Santé (`app/js/export-sante.js` : export.zip lu en flux dans le navigateur, totaux par jour ; pas dédoublonnés heure par heure entre sources ; rien n'est envoyé ailleurs que dans les totaux), **sauvegarde** JSON et CSV, objectifs (kcal, protéines, glucides, lipides, pas, poids visé), soit **calculés automatiquement** (`app/js/calcul.js` : Mifflin-St Jeor × facteur d'activité, déficit selon le rythme choisi plafonné à 25 % et 1 000 kcal, plancher 1 500 kcal homme / 1 200 kcal femme, protéines 1,8 g/kg de poids visé, lipides 28 %, alerte si l'IMC visé < 18,5 ; recalcul à chaque nouvelle pesée), soit saisis à la main, réglages Yazio → Apple Santé, création du raccourci iPhone pas à pas (avec l'URL de l'endpoint et le jeton), état de la synchro, et l'installation de l'appli.

## Design
Depuis le 25/11/2026, à la demande de l'utilisateur : un style **chaleureux et coloré**, inspiré des applis grand public (Yazio, Lifesum), qui remplace l'esprit « étiquette nutritionnelle » du prototype, jugé trop sobre et trop chargé en chiffres. Cartes blanches arrondies sur fond crème, ombres douces, couleurs pastel par thème (tomate calories, vert pas, bleu poids, soleil, raisin, rose), **emojis** dans les titres et les repas, anneau de progression pour les calories, messages d'encouragement jamais culpabilisants, salutation selon l'heure, barre d'onglets flottante. Police Archivo (hébergée localement), thème sombre, mobile d'abord, zones sûres iPhone, deux colonnes sur grand écran. Moins de tableaux de chiffres : préférer des tuiles et des phrases.

## Données d'exemple
Afficher un jeu d'exemple tant que l'utilisateur n'a rien saisi (voir `demoData()` dans le prototype), avec un bandeau qui le signale.

## Contraintes
- Tout en français, nombres au format fr-FR.
- Aucun secret dans le code client ni dans le dépôt (`.env`, secrets Supabase/Vercel).
- Ce sont des données de santé personnelles : RLS stricte, HTTPS, pas de tracking.
- Ne jamais valider de commande Leclerc.

## Ordre de travail proposé
1. Projet en JS vanilla sans build (Node n'était pas installé au départ) qui reprend l'interface du prototype, avec manifest et service worker.
2. Supabase : schéma, RLS, authentification, branchement de l'interface.
3. Déploiement (GitHub + Vercel ou Pages) et test d'installation sur iPhone et PC.
4. Edge Function d'import Santé et guide du raccourci iPhone.
5. ~~Edge Function des recettes (API Claude)~~ : retirée de l'appli.
6. ~~Script Playwright Leclerc et tâche planifiée Windows~~ : abandonné (DataDome).
