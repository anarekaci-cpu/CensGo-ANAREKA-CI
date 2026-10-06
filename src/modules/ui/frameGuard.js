// Garde anti-iframe (clickjacking) : la directive CSP frame-ancestors n'est
// pas supportée via <meta>, et GitHub Pages ne permet pas d'en-têtes HTTP.
// Fichier externe (et non script inline) car la CSP impose script-src 'self'.
if (window.top !== window.self) {
  try {
    window.top.location = window.self.location;
  } catch {
    document.documentElement.style.display = "none";
  }
}
