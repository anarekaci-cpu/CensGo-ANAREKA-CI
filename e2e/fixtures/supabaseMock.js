// Faux backend Supabase pour les tests E2E : intercepte toutes les requêtes
// vers https://e2e-test.supabase.co (URL injectée au build E2E, voir
// playwright.config.js) et bloque tout le reste du réseau externe (tuiles,
// météo, OSRM) pour que les tests soient déterministes et hors-ligne.

export const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "agent.test@anareka.ci",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Agent Test" },
  created_at: "2026-01-01T00:00:00Z"
};

export const SAMPLE_POINTS = [
  {
    point_id: "e2e-point-1", block: 1, order: 1, name: "Kiosque Awa", tel: "0701020304",
    etablissement: "Chez Awa", activity_type: "Kiosque d'attiéké fixe", city: "Bingerville",
    quartier: "Centre", address: "Carrefour mairie", produits: "Attiéké", sexe: "Femme",
    status: "Vert", visited: false, lat: 5.3553, lon: -3.8836,
    updated_at: "2026-09-01T10:00:00Z", created_at: "2026-09-01T10:00:00Z", created_by: TEST_USER.id, photo_path: null
  },
  {
    point_id: "e2e-point-2", block: 1, order: 2, name: "Maquis Koffi", tel: "0506070809",
    etablissement: "Maquis du Lac", activity_type: "Maquis/Gargote", city: "Bingerville",
    quartier: "Akandjé", address: "Bord lagune", produits: "Attiéké poisson", sexe: "Homme",
    status: "Jaune", visited: true, lat: 5.3601, lon: -3.8902,
    updated_at: "2026-09-02T10:00:00Z", created_at: "2026-09-02T10:00:00Z", created_by: TEST_USER.id, photo_path: null
  }
];

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: TEST_USER.id, role: "authenticated", exp: now + 3600, iat: now })}.sig`;
}

function session() {
  return {
    access_token: fakeJwt(),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "e2e-refresh",
    user: TEST_USER
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ role?: 'agent'|'admin'|null, points?: object[], onWrite?: (table: string, body: any, method: string) => void }} [opts]
 */
export async function mockSupabase(page, opts = {}) {
  const role = opts.role === undefined ? "agent" : opts.role;
  const points = opts.points || SAMPLE_POINTS;

  // Réseau externe non-Supabase : coupé (tuiles, météo, routage…), sauf le
  // style clair OpenFreeMap remplacé par un style minimal local : la carte
  // se charge réellement (et son worker GeoJSON tourne) sans réseau.
  await page.route(/^https:\/\/(?!e2e-test\.supabase\.co)/, route => {
    if (route.request().url().startsWith("https://tiles.openfreemap.org/styles/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        version: 8, name: "e2e", sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": "#e8efe9" } }]
      }) });
    }
    return route.abort();
  });

  await page.route("https://e2e-test.supabase.co/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

    if (method === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS"
      } });
    }

    // --- Auth ---
    if (path === "/auth/v1/token") {
      const body = req.postDataJSON() || {};
      if (body.password === "mauvais-mdp") return json({ error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" }, 400);
      return json(session());
    }
    if (path === "/auth/v1/user") return json(TEST_USER);
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    if (path.startsWith("/auth/v1/")) return json({});

    // --- REST ---
    const accept = req.headers()["accept"] || "";
    const wantsObject = accept.includes("vnd.pgrst.object");
    if (path.startsWith("/rest/v1/")) {
      const table = path.replace("/rest/v1/", "");
      if (table === "rpc/admin_list_accounts") {
        return json([
          { user_id: TEST_USER.id, email: TEST_USER.email, role: role, full_name: "Agent Test", agent_number: 7 },
          { user_id: "00000000-0000-4000-8000-000000000002", email: "nouveau@example.ci", role: null, full_name: "Nouvel Agent", agent_number: null }
        ]);
      }
      if (method !== "GET" && method !== "HEAD") {
        opts.onWrite?.(table, req.postDataJSON(), method);
        return json(method === "POST" ? [] : [], 201);
      }
      let rows = [];
      if (table === "user_roles") rows = role ? [{ role, full_name: "Agent Test", agent_number: 7 }] : [];
      else if (table === "census_points") rows = points;
      else if (table === "cities") rows = [{ id: "c-1", name: "Bingerville", created_at: "2026-08-01T00:00:00Z" }, { id: "c-2", name: "Cocody", created_at: "2026-08-01T00:00:00Z" }];
      if (wantsObject) return rows.length ? json(rows[0]) : json({ code: "PGRST116", message: "0 rows" }, 406);
      return json(rows, 200, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }

    // Storage, functions, realtime… : réponse neutre.
    return json({});
  });
}
