/**
 * Planification de tournée — logique PURE (aucun import DOM/store/map ;
 * core/geo.js, dont ce module importe deux utilitaires, est lui-même pur).
 *
 * Algorithme : plus proche voisin glouton PONDÉRÉ PAR LA DIRECTION, avec
 * passe d'amélioration 2-opt. Le coût naïf est O(N²) — sur 10 000 points
 * non visités cela représentait ~100M de calculs haversine au clic sur
 * "Tournée optimisée", soit plusieurs secondes de blocage du thread
 * principal sur un téléphone d'entrée de gamme.
 *
 * Stratégie : on plafonne la tournée aux MAX_TOUR_STOPS points les plus
 * proches du point de départ (pré-sélection O(N)), puis on fait le glouton
 * sur ce sous-ensemble (150² = 22 500 opérations, imperceptible). Une
 * tournée journalière réelle dépasse rarement quelques dizaines d'arrêts ;
 * l'agent relance simplement la tournée une fois celle-ci terminée.
 *
 * BUG CORRIGÉ (audit terrain, capture d'écran à l'appui) : le glouton pur
 * (plus proche à vol d'oiseau, sans plus) ne "comprend" pas qu'il est déjà
 * engagé sur un axe de progression — un point légèrement plus proche mais
 * situé sur une autre branche/direction pouvait passer devant plusieurs
 * points alignés sur le trajet en cours, provoquant un détour puis un
 * retour en arrière au lieu de "ramasser" ces points au passage. Ce module
 * reste délibérément SANS accès réseau (voir routing.js: findNearestByRoad
 * pour l'équivalent conscient du réseau ROUTIER réel, utilisé pour le seul
 * "point le plus proche" — un aller-retour OSRM par point à CHAQUE étape
 * du glouton, jusqu'à 150 fois par tournée générée, serait à la fois trop
 * lent et non disponible hors-ligne, voir le commentaire de
 * generateOptimizedTour ci-dessous). La correction reste donc purement
 * géométrique : à chaque étape, un point candidat n'est plus classé sur sa
 * seule distance, mais sur distance + pénalité d'écart angulaire par
 * rapport au cap de progression déjà établi (direction du dernier segment
 * parcouru) — un point "droit devant" ne subit aucune pénalité, un point
 * qui obligerait à faire demi-tour est fortement désavantagé même s'il est
 * un peu plus proche. Cette heuristique ("nearest neighbor with directional
 * bias") approxime bien "rester sur cet axe" sans connaître le réseau
 * routier réel : des points géographiquement alignés sur une même rue sont
 * presque toujours aussi alignés en cap depuis la position courante.
 */

import { haversineKm, bearingDeg, angleDiffDeg } from "./geo.js";

export const MAX_TOUR_STOPS = 150;

// Pénalité (mètres-équivalent) par degré d'écart entre le cap du candidat
// et le cap de progression établi. 180° (demi-tour complet) = 360m de
// pénalité — comparable à un détour modéré, mais pas absolu : un point
// nettement plus proche en faisant demi-tour peut encore l'emporter sur un
// point lointain qui continue tout droit (cf. rien n'empêche un vrai
// changement de rue quand ça vaut clairement le coup).
const DIRECTION_PENALTY_PER_DEGREE_M = 2;

/**
 * Filtre les points utilisables (non visités, coordonnées valides) et
 * plafonne aux `maxStops` plus proches du départ à vol d'oiseau (tri
 * partiel O(N log N)) — partagé par generateOptimizedTour() ci-dessous et
 * par le planificateur route-aware (routeAwarePlanner.js), qui opère sur
 * le même bassin de candidats avant d'y superposer sa propre logique de
 * corridor/progression.
 *
 * @param {object[]} points
 * @param {{lat:number, lng:number}} startPos
 * @param {number} maxStops
 * @returns {object[]}
 */
export function preselectNearestStops(points, startPos, maxStops) {
  if (!Array.isArray(points) || !startPos) return [];

  const usable = points.filter(p =>
    !p.visited &&
    Number.isFinite(p.lat) && Number.isFinite(p.lon)
  );
  if (usable.length === 0) return [];
  if (usable.length <= maxStops) return usable;

  return usable
    .map(p => ({ p, d0: haversineKm(startPos.lat, startPos.lng, p.lat, p.lon) }))
    .sort((a, b) => a.d0 - b.d0)
    .slice(0, maxStops)
    .map(e => e.p);
}

/**
 * @param {object[]} points - points normalisés (lat/lon numériques)
 * @param {{lat:number, lng:number, heading?:number}} startPos - position de
 *   départ ; `heading` (cap GPS live, API Geolocation) optionnel — s'il est
 *   fourni et fini, sert de cap de progression déjà établi pour le TOUT
 *   PREMIER arrêt (sinon ce premier choix reste un plus-proche-voisin pur,
 *   faute de direction connue avant tout déplacement).
 * @param {number} [maxStops=MAX_TOUR_STOPS]
 * @returns {object[]} tournée ordonnée, chaque point porte distanceFromPrev (km)
 */
export function generateOptimizedTour(points, startPos, maxStops = MAX_TOUR_STOPS) {
  if (!Array.isArray(points) || !startPos) return [];

  const candidates = preselectNearestStops(points, startPos, maxStops);
  if (candidates.length === 0) return [];

  const tour = [];
  let current = { lat: startPos.lat, lng: startPos.lng };
  let heading = Number.isFinite(startPos.heading) ? startPos.heading : null;
  const remaining = [...candidates];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;
    let bestDistKm = 0;

    for (let i = 0; i < remaining.length; i++) {
      const distKm = haversineKm(current.lat, current.lng, remaining[i].lat, remaining[i].lon);
      let score = distKm * 1000;

      if (heading != null) {
        const candidateBearing = bearingDeg(current.lat, current.lng, remaining[i].lat, remaining[i].lon);
        score += angleDiffDeg(heading, candidateBearing) * DIRECTION_PENALTY_PER_DEGREE_M;
      }

      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
        bestDistKm = distKm;
      }
    }

    const next = remaining.splice(bestIdx, 1)[0];
    tour.push({ ...next, distanceFromPrev: bestDistKm });
    // Cap établi par CE segment (courant -> next), utilisé pour juger la
    // pénalité directionnelle du prochain choix — la progression "se
    // souvient" ainsi de la direction dans laquelle elle est déjà engagée.
    heading = bearingDeg(current.lat, current.lng, next.lat, next.lon);
    current = { lat: next.lat, lng: next.lon };
  }

  return _twoOptImprove(tour, startPos);
}

/**
 * Passe d'amélioration locale sur la tournée glouton (plus-proche-voisin) :
 * le glouton est rapide mais myope — il choisit le plus proche à chaque
 * étape sans jamais revenir en arrière, ce qui produit régulièrement des
 * croisements évitables (deux segments du trajet qui se coupent). Cette
 * passe élimine ces croisements en permutant deux arrêts consécutifs de la
 * tournée tant que ça raccourcit le coût total.
 *
 * Chemin OUVERT (départ fixe, pas de retour au point de départ) : le noeud
 * de départ (index 0 virtuel) n'est jamais permuté.
 *
 * RESTREINT AUX PERMUTATIONS DE 2 ARRÊTS ADJACENTS (audit — pas un 2-opt
 * généraliste à tronçon de longueur arbitraire) : un vrai 2-opt général
 * inverse un tronçon [i+1..j] de longueur quelconque. Sans connaître la
 * pénalité directionnelle du glouton ci-dessus, un tel swap pouvait
 * raccourcir la distance totale de quelques dizaines de mètres tout en
 * réintroduisant EXACTEMENT le détour que le glouton venait d'éviter (cas
 * constaté en test : un tronçon à 3 arrêts entièrement inversé produisait
 * un aller-retour absurde). Rendre ce jugement direction-aware EXACTEMENT
 * pour un tronçon de longueur arbitraire exigerait de recalculer la
 * pénalité de CHAQUE arête interne du tronçon (son contexte de cap change
 * même si sa longueur ne change pas) — O(longueur du tronçon) par swap
 * évalué, donc O(n³) au total, disproportionné pour un gain marginal.
 *
 * Restreint à l'échange de 2 arrêts adjacents (tronçon de longueur
 * exactement 2, i.e. i+1 et j échangent leur place), le nombre d'arêtes
 * concernées reste fixe (3, pas O(n)) : (i,i+1), (i+1,j), (j,j+1) avant
 * l'échange deviennent (i,j), (j,i+1), (i+1,j+1) après — la LONGUEUR de
 * l'arête interne (i+1,j)/(j,i+1) ne change pas (mêmes deux points), mais
 * sa pénalité directionnelle SI (son contexte de cap — le prédécesseur
 * change de sens de parcours). Une première version de ce calcul omettait
 * cette arête interne (valable seulement pour une distance pure, où elle
 * s'annule — invalide dès qu'une pénalité directionnelle s'y ajoute) ; les
 * 3 arêtes de chaque côté sont maintenant comptées explicitement. Reste
 * O(n²) par passe (3 arêtes = travail constant par swap évalué), et couvre
 * déjà le cas de croisement local le plus fréquent en pratique.
 */
const MIN_IMPROVEMENT_M = 1;

function _twoOptImprove(tourStops, startPos, maxPasses = 4) {
  const n = tourStops.length;
  if (n < 3) return tourStops;

  // nodes[0] = départ virtuel (jamais renvoyé), nodes[1..n] = arrêts.
  const nodes = [{ lat: startPos.lat, lon: startPos.lng }, ...tourStops];
  const len = nodes.length;
  const distM = (a, b) => haversineKm(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon) * 1000;

  // Coût d'une arête fromIdx->toIdx, majoré de la pénalité directionnelle
  // relative au cap d'arrivée en fromIdx (arête prevIdx->fromIdx). Même
  // formule que le glouton (DIRECTION_PENALTY_PER_DEGREE_M) — sans elle,
  // cette passe ré-optimiserait sur un objectif différent de celui qui a
  // construit la tournée, et défairait son travail.
  const edgeCost = (prevIdx, fromIdx, toIdx) => {
    const d = distM(fromIdx, toIdx);
    if (prevIdx < 0) return d;
    const incoming = bearingDeg(nodes[prevIdx].lat, nodes[prevIdx].lon, nodes[fromIdx].lat, nodes[fromIdx].lon);
    const outgoing = bearingDeg(nodes[fromIdx].lat, nodes[fromIdx].lon, nodes[toIdx].lat, nodes[toIdx].lon);
    return d + angleDiffDeg(incoming, outgoing) * DIRECTION_PENALTY_PER_DEGREE_M;
  };

  let improved = true;
  let pass = 0;
  while (improved && pass < maxPasses) {
    improved = false;
    pass++;

    for (let i = 0; i < len - 2; i++) {
      const j = i + 2; // échange des arrêts i+1 et j (adjacents)
      const hasNextEdge = j + 1 < len;
      // 3 arêtes avant : (i,i+1), (i+1,j), (j,j+1 si elle existe).
      const removed = edgeCost(i - 1, i, i + 1)
        + edgeCost(i, i + 1, j)
        + (hasNextEdge ? edgeCost(i + 1, j, j + 1) : 0);
      // 3 arêtes après : (i,j), (j,i+1), (i+1,j+1 si elle existe).
      const added = edgeCost(i - 1, i, j)
        + edgeCost(i, j, i + 1)
        + (hasNextEdge ? edgeCost(j, i + 1, j + 1) : 0);

      if (added + MIN_IMPROVEMENT_M < removed) {
        [nodes[i + 1], nodes[j]] = [nodes[j], nodes[i + 1]];
        improved = true;
      }
    }
  }

  const result = [];
  for (let k = 1; k < len; k++) {
    result.push({ ...nodes[k], distanceFromPrev: distM(k - 1, k) / 1000 });
  }
  return result;
}
