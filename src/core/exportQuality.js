import { haversineKm } from "./geo.js";

const REQUIRED_FIELDS = ["name", "tel", "activityType", "lat", "lon"];

export function auditExportQuality(points, pendingCount, duplicateRadiusM = 25) {
  const incompleteCount = points.filter(point => REQUIRED_FIELDS.some(field => {
    const value = point[field];
    return value === null || value === undefined || String(value).trim() === "";
  })).length;

  let duplicateCount = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = haversineKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon) * 1000;
      if (Number.isFinite(distance) && distance <= duplicateRadiusM) duplicateCount++;
    }
  }

  return { incompleteCount, pendingCount, duplicateCount };
}