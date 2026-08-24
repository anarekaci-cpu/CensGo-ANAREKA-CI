# Project: CensGo — Recensement ANAREKA-CI

## Overview
PWA de recensement pour ANAREKA-CI (Cote d'Ivoire). Vanilla JS + Vite + MapLibre GL + Supercluster + Supabase + Dexie.js (IndexedDB). Offline-first architecture.

## Commands
- `npm run dev` — Start Vite dev server (port 3000)
- `npm run build` — Production build to `dist/`
- `npm test` / `npm run test:watch` — Vitest tests
- `npm run lint` — ESLint check on `src/`
- `npm run lint:fix` — Auto-fix lint issues
- `npm run deploy` — Build + deploy to GitHub Pages

## Architecture
- Entry: `src/main.js` → bootstrap IndexedDB → auth → sync engine → app shell → app view
- Shell: `src/appShell.js` (login screen + single-mount guard `_appMounted`)
- View: `src/appView.js` (authenticated layout, filters, stats, events)
- State: `src/core/store.js` (Observer pattern, dot-path subscriptions; same-reference set() does NOT notify)
- DB: `src/db/database.js` (Dexie.js — IndexedDB: points, syncQueue, meta; writes in transactions)
- Supabase: `src/core/supabase.js`
- Config: `src/core/config.js` (reads `import.meta.env.VITE_*`)
- Pure logic in `src/core/`: normalize.js (normalizePoint), analytics.js (computeStats), filters.js (filterPoints), tourPlanner.js (generateOptimizedTour), geo.js
- Modules: `src/modules/` — auth, census (dataLoader cache-first paginé, markers pool + index O(1)), map, geolocation, routing, navigation, tour, sync, ai
- Styles: `src/style.css` (single file)

## Conventions
- ES modules (`"type": "module"` in package.json)
- ESLint: `eslint:recommended`, browser + es2022, no-console off, unused-vars warn (argsIgnorePattern `^_`)
- No framework — vanilla DOM manipulation
- UUID-based IDs for offline-safe point creation
- Business defaults for points live in `upsertPoint()` (block:1, order:maxLocalId+1) — do NOT apply normalizePoint() defaults (block:0, order:null) on top of form data
- All user-supplied strings rendered into DOM must go through escapeHtml()
- Commit style: `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `chore:`

## Security
- `.env` contains live Supabase credentials — NEVER commit it
- `.env.example` is the template — safe to commit
- Pre-commit hook blocks `.env` files
- RLS policies exist in `supabase/reset_rls.sql` and must be executed in the Supabase dashboard before production
- A past anon key leak exists in git history (see SECURITY.md) — key rotation required

## Testing
- Vitest + jsdom configured (`npm test`)
- Tests live in `src/__tests__/` covering pure modules: store, geo, normalize, analytics, filters, tourPlanner, sync queue logic
