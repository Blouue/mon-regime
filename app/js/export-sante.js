// Lecture de l'export Apple Santé (Santé → photo de profil → « Exporter toutes les données de santé »).
// Le fichier export.zip contient apple_health_export/export.xml, souvent volumineux (des centaines de Mo) :
// on le décompresse et on le lit en flux, morceau par morceau, sans bibliothèque externe.
// Tout se passe dans le navigateur : le fichier n'est envoyé nulle part, seuls les totaux par jour sont enregistrés.

const TYPES = {
  HKQuantityTypeIdentifierBodyMass: 'poids',
  HKQuantityTypeIdentifierStepCount: 'pas',
  HKQuantityTypeIdentifierDietaryEnergyConsumed: 'kcal',
  HKQuantityTypeIdentifierDietaryProtein: 'prot',
  HKQuantityTypeIdentifierDietaryCarbohydrates: 'gluc',
  HKQuantityTypeIdentifierDietaryFatTotal: 'lip',
};
const FILTRE = /HKQuantityTypeIdentifier(BodyMass|StepCount|DietaryEnergyConsumed|DietaryProtein|DietaryCarbohydrates|DietaryFatTotal)"/;
const attr = (rec, nom) => { const m = rec.match(new RegExp(' ' + nom + '="([^"]*)"')); return m ? m[1] : null; };

/* ---------- Lecture du zip (format décrit par PKWARE, avec prise en charge du zip64) ---------- */
async function entreeExportXml(file) {
  const fin = Math.max(0, file.size - 70000);
  const queue = new DataView(await file.slice(fin).arrayBuffer());
  let eocd = -1;
  for (let i = queue.byteLength - 22; i >= 0; i--) if (queue.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un zip lisible.");
  let cdTaille = queue.getUint32(eocd + 12, true), cdDebut = queue.getUint32(eocd + 16, true);
  if (cdDebut === 0xffffffff || cdTaille === 0xffffffff) {
    // Zip64 : le localisateur est juste avant la fin du répertoire central classique.
    const loc = eocd - 20;
    if (loc < 0 || queue.getUint32(loc, true) !== 0x07064b50) throw new Error('Zip64 illisible.');
    const off64 = Number(queue.getBigUint64(loc + 8, true));
    const z = new DataView(await file.slice(off64, off64 + 56).arrayBuffer());
    cdTaille = Number(z.getBigUint64(40, true)); cdDebut = Number(z.getBigUint64(48, true));
  }
  const cd = new DataView(await file.slice(cdDebut, cdDebut + cdTaille).arrayBuffer());
  const dec = new TextDecoder();
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
    const methode = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true), local = cd.getUint32(p + 42, true);
    const nl = cd.getUint16(p + 28, true), el = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    const nom = dec.decode(new Uint8Array(cd.buffer, p + 46, nl));
    // Champ supplémentaire zip64 : tailles et position sur 8 octets quand elles dépassent 4 Go.
    for (let e = p + 46 + nl; e < p + 46 + nl + el;) {
      const id = cd.getUint16(e, true), t = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (cd.getUint32(p + 24, true) === 0xffffffff) q += 8;
        if (comp === 0xffffffff) { comp = Number(cd.getBigUint64(q, true)); q += 8; }
        if (local === 0xffffffff) local = Number(cd.getBigUint64(q, true));
      }
      e += 4 + t;
    }
    if (/(^|[/\\])export\.xml$/.test(nom)) {
      const lh = new DataView(await file.slice(local, local + 30).arrayBuffer());
      const debut = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      return { debut, taille: comp, methode };
    }
    p += 46 + nl + el + cl;
  }
  throw new Error("Pas de fichier export.xml dans ce zip. Choisis bien le fichier « export.zip » produit par Santé.");
}

/** Flux de texte du XML, avec suivi de la progression en octets lus. */
async function fluxTexte(file, progres) {
  let flux, total;
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
    if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur est trop ancien pour lire un zip. Mets à jour iOS ou utilise Chrome sur PC.');
    const e = await entreeExportXml(file);
    total = e.taille;
    flux = file.slice(e.debut, e.debut + e.taille).stream();
    flux = flux.pipeThrough(compteur(total, progres));
    if (e.methode === 8) flux = flux.pipeThrough(new DecompressionStream('deflate-raw'));
    else if (e.methode !== 0) throw new Error('Méthode de compression inconnue dans ce zip.');
  } else {
    total = file.size;
    flux = file.stream().pipeThrough(compteur(total, progres));
  }
  return flux.pipeThrough(new TextDecoderStream());
}
function compteur(total, progres) {
  let lu = 0, dernier = 0;
  return new TransformStream({ transform(morceau, ctl) {
    lu += morceau.byteLength;
    const now = Date.now(); if (progres && now - dernier > 150) { dernier = now; progres(lu / total); }
    ctl.enqueue(morceau);
  } });
}

/**
 * Lit l'export et renvoie un total par jour : [{date, poids?, pas?, kcal?, prot?, gluc?, lip?}].
 * Quand plusieurs sources (iPhone, montre, tapis…) comptent la même chose, on évite le double comptage :
 * pour les pas, heure par heure on garde la source la plus élevée puis on additionne les heures
 * (deux sources au même moment ne comptent qu'une fois, deux séances à des heures différentes s'additionnent) ;
 * pour la nutrition, on garde la source au total du jour le plus élevé (en pratique Yazio seul).
 * @param {File} file
 * @param {{depuis?: string, avant?: string, progres?: (f:number)=>void}} opts dates AAAA-MM-JJ
 */
export async function lireExportSante(file, { depuis = '0000-00-00', avant = '9999-99-99', progres } = {}) {
  const parSource = new Map(); // "date|champ" -> Map(source -> somme)
  const poids = new Map();     // date -> {t, v}
  let nb = 0, reste = '';
  const traiter = (rec) => {
    if (!FILTRE.test(rec)) return;
    const champ = TYPES[attr(rec, 'type')]; if (!champ) return;
    const debut = attr(rec, 'startDate') || '', date = debut.slice(0, 10);
    if (date < depuis || date >= avant) return;
    let v = parseFloat(attr(rec, 'value')); if (!Number.isFinite(v)) return;
    const unite = attr(rec, 'unit') || '';
    if (champ === 'poids') {
      if (unite === 'lb') v *= 0.45359237; else if (unite === 'g') v /= 1000;
      const p = poids.get(date); if (!p || debut > p.t) poids.set(date, { t: debut, v });
    } else {
      if (champ === 'kcal' && unite === 'kJ') v /= 4.184;
      if (champ !== 'pas' && champ !== 'kcal' && unite === 'mg') v /= 1000;
      const cle = date + '|' + champ + (champ === 'pas' ? '|' + debut.slice(11, 13) : ''), src = attr(rec, 'sourceName') || '?';
      const m = parSource.get(cle) || parSource.set(cle, new Map()).get(cle);
      m.set(src, (m.get(src) || 0) + v);
    }
    nb++;
  };
  const lecteur = (await fluxTexte(file, progres)).getReader();
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    const texte = reste + value;
    const fin = texte.lastIndexOf('>');
    const traite = fin >= 0 ? texte.slice(0, fin + 1) : '';
    reste = fin >= 0 ? texte.slice(fin + 1) : texte;
    for (const m of traite.matchAll(/<Record\b[^>]*>/g)) traiter(m[0]);
    if (reste.length > 1e6) reste = reste.slice(-1e5); // garde-fou si le fichier est mal formé
  }
  progres?.(1);

  const jours = new Map();
  const jour = (d) => jours.get(d) || jours.set(d, { date: d }).get(d);
  for (const [d, p] of poids) jour(d).poids = Math.round(p.v * 10) / 10;
  for (const [cle, m] of parSource) {
    const [d, champ] = cle.split('|'), j = jour(d);
    j[champ] = (j[champ] || 0) + Math.max(...m.values()); // pour les pas : somme des heures
  }
  for (const j of jours.values()) for (const k of ['pas', 'kcal', 'prot', 'gluc', 'lip']) if (j[k] != null) j[k] = Math.round(j[k]);
  const lignes = [...jours.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Valeurs hors bornes (erreurs de saisie dans Santé) écartées, comme pour le raccourci.
  const B = { poids: [20, 400], pas: [0, 200000], kcal: [0, 20000], prot: [0, 2000], gluc: [0, 3000], lip: [0, 2000] };
  for (const l of lignes) for (const k of Object.keys(B)) if (l[k] != null && (l[k] < B[k][0] || l[k] > B[k][1])) delete l[k];
  return { lignes: lignes.filter((l) => Object.keys(l).length > 1), enregistrements: nb };
}
