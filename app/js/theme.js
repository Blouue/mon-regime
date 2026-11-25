// Applique le thème choisi (clair, sombre ou auto) avant le premier affichage, pour éviter un flash.
// Chargé en script classique dans le <head> ; la politique de sécurité interdit le script en ligne.
(function () {
  var t = null;
  try { t = localStorage.getItem('mr-theme'); } catch (e) { /* stockage indisponible */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
