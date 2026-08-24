# 🤝 Guide de Contribution

Merci de votre intérêt pour améliorer CensGo — Recensement ANAREKA-CI !

## 🌿 Branches

- `main` — Production stable
- `develop` — Intégration des nouvelles fonctionnalités
- `feature/*` — Nouvelles fonctionnalités
- `fix/*` — Corrections de bugs
- `hotfix/*` — Corrections urgentes en production

## 📝 Convention de commits

```
feat: ajout de la reconnaissance vocale
fix: correction du bug de synchronisation offline
docs: mise à jour du README
style: formatage du code
refactor: restructuration du module map
perf: optimisation du chargement des marqueurs
test: ajout des tests unitaires
chore: mise à jour des dépendances
```

## 🧪 Tests

Avant de soumettre une PR :
```bash
npm run lint
npm run test
npm run build
```

## 📋 Checklist PR

- [ ] Le code compile sans erreur
- [ ] Les tests passent
- [ ] La documentation est à jour
- [ ] Aucune clé API n'est exposée
- [ ] Le code suit les conventions du projet
