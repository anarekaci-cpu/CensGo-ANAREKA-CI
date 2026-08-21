/**
 * Système d'analyse centralisé.
 *
 * Toutes les statistiques de l'application (header, couverture par quartier,
 * futurs dashboards/KPI) sont calculées ICI, en UN SEUL passage O(N) sur la
 * liste du store — jamais sur un mélange Supabase + IndexedDB. Le store est
 * la seule source : il est dédupliqué en amont (normalizePoints), donc aucun
 * point ne peut être compté deux fois.
 */

/**
 * Calcule l'ensemble des statistiques à partir d'une liste de points normalisés.
 * @param {object[]} points - points du store (dédupliqués)
 * @param {Array<{name:string}>} [targetZones] - zones cibles sans encore de point
 * @returns {object} statistiques complètes
 */
export function computeStats(points, targetZones = []) {
  const safePoints = Array.isArray(points) ? points : [];
  const total = safePoints.length;

  let visited = 0;
  const byStatus = new Map();
  const byActivity = new Map();
  const quartierMap = new Map();

  // Zones cibles définies par l'admin : présentes même avec 0 point recensé,
  // pour guider les agents vers les zones prioritaires non couvertes.
  for (const zone of Array.isArray(targetZones) ? targetZones : []) {
    const name = String(zone?.name || "").trim();
    if (name && !quartierMap.has(name)) {
      quartierMap.set(name, { quartier: name, total: 0, visited: 0 });
    }
  }

  for (const p of safePoints) {
    if (p.visited === true) visited++;

    const status = p.status || "NON DEFINI";
    byStatus.set(status, (byStatus.get(status) || 0) + 1);

    const activity = p.activityType || "Non renseignée";
    byActivity.set(activity, (byActivity.get(activity) || 0) + 1);

    const q = (p.quartier || "").trim() || "Non renseigné";
    if (!quartierMap.has(q)) {
      quartierMap.set(q, { quartier: q, total: 0, visited: 0 });
    }
    const entry = quartierMap.get(q);
    entry.total++;
    if (p.visited === true) entry.visited++;
  }

  const byQuartier = [...quartierMap.values()]
    .map(e => ({ ...e, pct: e.total > 0 ? Math.round((e.visited / e.total) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct || b.total - a.total);

  return {
    total,
    visited,
    remaining: total - visited,
    coveragePct: total > 0 ? Math.round((visited / total) * 100) : 0,
    byStatus: Object.fromEntries([...byStatus.entries()].sort()),
    byActivity: Object.fromEntries([...byActivity.entries()].sort((a, b) => b[1] - a[1])),
    byQuartier,
    quartierCount: quartierMap.size
  };
}
