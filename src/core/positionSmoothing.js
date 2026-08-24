export const GPS_ACCURACY_DEGRADE_THRESHOLD_M = 50;
export const GPS_DISPLAY_ALPHA = 0.35;

export function shouldAcceptGpsFix(fix, previousFix) {
  const accuracy = Number(fix?.accuracy);
  const previousAccuracy = Number(previousFix?.accuracy);
  if (!Number.isFinite(accuracy) || !Number.isFinite(previousAccuracy)) return true;
  return accuracy <= previousAccuracy + GPS_ACCURACY_DEGRADE_THRESHOLD_M;
}

export function smoothGpsPosition(previous, next, alpha = GPS_DISPLAY_ALPHA) {
  if (!previous) return { ...next };
  const weight = Math.min(1, Math.max(0, alpha));
  return {
    ...next,
    lat: previous.lat + (next.lat - previous.lat) * weight,
    lng: previous.lng + (next.lng - previous.lng) * weight
  };
}