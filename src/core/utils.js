const _escapeEl = document.createElement("span");

export function escapeHtml(str) {
  if (str == null) return "";
  _escapeEl.textContent = String(str);
  return _escapeEl.innerHTML.replace(/"/g, "&quot;");
}
