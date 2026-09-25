// Petits utilitaires d'interface partagés entre les vues.
export function closeControls() {
  document.getElementById("controls")?.classList.remove("open");
}
