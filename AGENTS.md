# Project: Recensement ANAREKA-CI

## Overview
PWA de recensement pour ANAREKA-CI (Cote d'Ivoire). Vanilla JS + Vite + Leaflet + Supabase + Dexie.js (IndexedDB). Offline-first architecture.

## Commands
- `npm run dev` — Start Vite dev server (port 3000)
- `npm run build` — Production build to `dist/`
- `npm run lint` — ESLint check on `src/`
- `npm run lint:fix` — Auto-fix lint issues
- `npm run deploy` — Build + deploy to GitHub Pages

## Architecture
- Entry: `src/main.js` → `src/app.js` (App class)
- State: `src/core/store.js` (Observer pattern, dot-path subscriptions)
- DB: `src/db/database.js` (Dexie.js — IndexedDB)
- Supabase: `src/core/supabase.js`
- Config: `src/core/config.js` (reads `import.meta.env.VITE_*`)
- Modules: `src/modules/` — auth, census, map, geolocation, routing, navigation, tour, sync, ai
- Styles: `src/style.css` (single file, 637 lines)

## Conventions
- ES modules (`"type": "module"` in package.json)
- ESLint: `eslint:recommended`, browser + es2022, no-console off, unused-vars warn (argsIgnorePattern `^_`)
- No framework — vanilla DOM manipulation
- UUID-based IDs for offline-safe point creation
- Commit style: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `chore:`

## Security
- `.env` contains live Supabase credentials — NEVER commit it
- `.env.example` is the template — safe to commit
- Pre-commit hook blocks `.env` files
- RLS on Supabase is documented but needs activation (see SECURITY.md)

## Testing
- No test runner configured yet (Vitest planned)
- CONTRIBUTING.md references `npm run test` but script does not exist
