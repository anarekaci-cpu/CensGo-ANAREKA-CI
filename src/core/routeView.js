export function calculateRoutePadding(mapRect, panelRect, margin = 24) {
  if (!mapRect || !panelRect || panelRect.bottom <= mapRect.top) {
    return margin;
  }
  return Math.max(margin, mapRect.bottom - panelRect.top + margin);
}