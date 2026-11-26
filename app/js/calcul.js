// Calcul des objectifs à partir du profil.
// Métabolisme de base : formule de Mifflin-St Jeor (1990), la plus utilisée par les diététiciens.
// Dépense du jour = métabolisme × facteur d'activité. 1 kg de graisse ≈ 7 700 kcal.
// C'est une estimation, pas un avis médical : l'appli l'affiche comme telle.

export const ACTIVITES = [
  { v: 1.2, e: '🛋️', nom: 'Sédentaire', aide: 'Travail assis, peu de marche (moins de 5 000 pas)' },
  { v: 1.375, e: '🚶', nom: 'Peu actif', aide: '5 000 à 7 500 pas, ou sport 1 à 2 fois par semaine' },
  { v: 1.55, e: '🚴', nom: 'Actif', aide: '7 500 à 10 000 pas, ou sport 3 à 4 fois par semaine' },
  { v: 1.725, e: '🏃', nom: 'Très actif', aide: 'Plus de 10 000 pas, ou sport presque tous les jours' },
];

export const RYTHMES = [
  { v: 0.25, e: '🐢', nom: 'Doux', aide: '−0,25 kg par semaine' },
  { v: 0.5, e: '🚶', nom: 'Conseillé', aide: '−0,5 kg par semaine' },
  { v: 0.75, e: '🐇', nom: 'Rapide', aide: '−0,75 kg par semaine' },
];

/** Niveau d'activité suggéré d'après la moyenne de pas. */
export function activiteDepuisPas(moyenne) {
  if (moyenne == null) return null;
  return moyenne < 5000 ? 1.2 : moyenne < 7500 ? 1.375 : moyenne < 10000 ? 1.55 : 1.725;
}

/** Profil complet ? */
export const profilComplet = (p) => Boolean(p && (p.sexe === 'h' || p.sexe === 'f') && p.naissance && p.taille && p.poids && p.poidsCible && p.activite && p.rythme != null);

/**
 * @param {{sexe:'h'|'f', naissance:number, taille:number, poids:number, poidsCible:number, activite:number, rythme:number}} p
 * @param {Date} aujourdhui
 * @param {{ok:boolean, valeur:number, poids:number}} [mesure] dépense réelle mesurée (voir suivi.js) : quand elle est
 *   disponible, elle remplace en partie la formule, selon la confiance qu'on peut lui accorder.
 */
export function calculer(p, aujourdhui = new Date(), mesure = null) {
  const age = aujourdhui.getFullYear() - p.naissance;
  const bmr = 10 * p.poids + 6.25 * p.taille - 5 * age + (p.sexe === 'h' ? 5 : -161);
  const tdeeFormule = bmr * p.activite;
  const tdee = mesure?.ok ? mesure.poids * mesure.valeur + (1 - mesure.poids) * tdeeFormule : tdeeFormule;
  const aPerdre = Math.max(0, p.poids - p.poidsCible);

  // Déficit visé, plafonné à 25 % de la dépense et à 1 000 kcal par jour.
  let deficit = aPerdre > 0 ? (p.rythme * 7700) / 7 : 0;
  deficit = Math.min(deficit, tdee * 0.25, 1000);
  // Plancher de sécurité : on ne descend jamais sous ces apports.
  const plancher = p.sexe === 'h' ? 1500 : 1200;
  let kcal = tdee - deficit, limite = false;
  if (kcal < plancher) { kcal = plancher; limite = true; }
  kcal = Math.round(kcal / 10) * 10;

  const kgSemaine = Math.max(0, ((tdee - kcal) * 7) / 7700);
  const semaines = aPerdre > 0 && kgSemaine > 0.05 ? aPerdre / kgSemaine : null;
  const fin = semaines != null ? new Date(aujourdhui.getTime() + semaines * 7 * 864e5) : null;

  // Macros : protéines 1,8 g par kg de poids visé (préserve les muscles pendant la perte),
  // lipides 28 % des calories, le reste en glucides.
  const prot = Math.round(p.poidsCible * 1.8);
  const lip = Math.round((kcal * 0.28) / 9);
  const gluc = Math.max(50, Math.round((kcal - prot * 4 - lip * 9) / 4));

  const imcCible = p.poidsCible / (p.taille / 100) ** 2;
  return {
    age, bmr: Math.round(bmr), tdee: Math.round(tdee), tdeeFormule: Math.round(tdeeFormule), mesure: mesure?.ok ? mesure : null, kcal, prot, gluc, lip,
    kgSemaine, semaines, fin, limite, aPerdre,
    imcCibleBas: imcCible < 18.5, imcCible,
  };
}
