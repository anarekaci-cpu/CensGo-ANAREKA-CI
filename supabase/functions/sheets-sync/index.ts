// =============================================================
// Double envoi automatique vers Google Sheets (en plus de Supabase, jamais
// à la place — voir plan Partie C). Un onglet par ville + un onglet
// "Général" recevant TOUTES les fiches, dans la MÊME feuille Google Sheets
// dédiée à l'app.
//
// STATUT : écrit avant réception des credentials Google (compte de service
// + ID de feuille) — NON TESTÉ EN CONDITIONS RÉELLES. Relire une fois les
// secrets configurés et faire un premier essai manuel (créer un point,
// vérifier l'apparition dans les deux onglets) avant de considérer ce flux
// fiable.
//
// Secrets requis (Supabase Dashboard > Edge Functions > sheets-sync >
// Secrets, ou `supabase secrets set`) :
//   SUPABASE_URL, SUPABASE_ANON_KEY          — déjà utilisés par ai-agent
//   SUPABASE_SERVICE_ROLE_KEY                — accès à sheets_sync_state (RLS la bloque sinon, voir add_sheets_sync.sql)
//   GOOGLE_SERVICE_ACCOUNT_EMAIL              — "client_email" du fichier JSON du compte de service
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY        — "private_key" du même fichier (PEM, avec ses \n)
//   GOOGLE_SHEETS_SPREADSHEET_ID              — ID de la feuille dédiée (dans son URL)
//   SHEETS_ALLOWED_ORIGINS                    — mêmes origines que AI_ALLOWED_ORIGINS (ai-agent)
// =============================================================

import { createClient } from "npm:@supabase/supabase-js@^2.45.0";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const configured = (Deno.env.get("SHEETS_ALLOWED_ORIGINS") || "").split(",").map(v => v.trim()).filter(Boolean);
  const allowed = configured.includes(origin);
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" }
  });
}

const MAX_BODY_BYTES = 32 * 1024; // une fiche seule, pas une photo — largement suffisant
const GENERAL_SHEET_NAME = "Général";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// Ordre = colonnes A..O dans chaque onglet. Garder synchronisé avec l'export
// CSV existant (src/appView.js, exportCSV()) pour que les deux exports
// racontent la même donnée dans le même ordre.
const COLUMNS: Array<{ key: string; header: string }> = [
  { key: "name", header: "Nom" },
  { key: "tel", header: "Téléphone" },
  { key: "etablissement", header: "Établissement" },
  { key: "activityType", header: "Type d'activité" },
  { key: "city", header: "Ville" },
  { key: "quartier", header: "Quartier" },
  { key: "address", header: "Adresse" },
  { key: "produits", header: "Produits" },
  { key: "sexe", header: "Sexe" },
  { key: "status", header: "Statut" },
  { key: "visited", header: "Visité" },
  { key: "lat", header: "Latitude" },
  { key: "lon", header: "Longitude" },
  { key: "point_id", header: "ID Point" },
  { key: "updated_at", header: "Mis à jour le" },
];

// --- Authentification Google (JWT-bearer, compte de service) ---
// Pas de dépendance npm dédiée (google-auth-library) : le flux OAuth2
// "compte de service" tient en une signature RS256 + un échange de jeton,
// entièrement réalisable avec l'API Web Crypto déjà disponible dans Deno —
// cohérent avec le souci de dépendances minimales déjà documenté ailleurs
// dans ce projet (vite.config.js, poids du bundle).

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(str: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

function pemToCryptoKey(pem: string): Promise<CryptoKey> {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getGoogleAccessToken(): Promise<string> {
  // Réutilise le jeton tant qu'il reste valide plus d'une minute — une
  // instance Edge Function "chaude" (invocations rapprochées) évite ainsi
  // de re-signer un JWT à chaque appel.
  if (cachedToken && cachedToken.expiresAt - 60 > Date.now() / 1000) {
    return cachedToken.value;
  }

  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!email || !rawKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY non configurées.");
  }
  // Le JSON du compte de service contient des "\n" littéraux dans
  // private_key — une variable d'environnement les stocke tels quels
  // (chaîne échappée), à reconvertir en vrais sauts de ligne pour le PEM.
  const privateKeyPem = rawKey.replace(/\\n/g, "\n");

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600
  };
  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await pemToCryptoKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!res.ok) {
    throw new Error(`Échec de l'authentification Google (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: nowSec + (data.expires_in || 3600) };
  return cachedToken.value;
}

// --- API Google Sheets ---

async function sheetsRequest(accessToken: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${SHEETS_API_BASE}/${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) {
    throw new Error(`Google Sheets API ${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function ensureSheetExists(accessToken: string, spreadsheetId: string, sheetName: string) {
  const meta = await sheetsRequest(accessToken, `${spreadsheetId}?fields=sheets.properties.title`);
  const exists = (meta.sheets || []).some((s: { properties: { title: string } }) => s.properties.title === sheetName);
  if (exists) return;

  await sheetsRequest(accessToken, `${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
  });

  // Ligne d'en-tête posée une seule fois, à la création de l'onglet.
  const range = encodeURIComponent(`'${sheetName}'!A1:O1`);
  await sheetsRequest(accessToken, `${spreadsheetId}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [COLUMNS.map(c => c.header)] })
  });
}

function parseRowNumberFromUpdatedRange(updatedRange: string): number {
  // Ex: "'Bingerville'!A6:O6" -> 6. Le point d'ancrage est TOUJOURS la
  // colonne A (append écrit une ligne entière) donc "A(\d+)" suffit.
  const match = updatedRange.match(/!A(\d+)/);
  if (!match) throw new Error(`Impossible d'interpréter updatedRange="${updatedRange}"`);
  return Number(match[1]);
}

async function upsertRowInSheet(
  accessToken: string,
  spreadsheetId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  sheetName: string,
  pointId: string,
  rowValues: unknown[]
) {
  await ensureSheetExists(accessToken, spreadsheetId, sheetName);

  const { data: existing } = await supabaseAdmin
    .from("sheets_sync_state")
    .select("row_number")
    .eq("point_id", pointId)
    .eq("sheet_name", sheetName)
    .maybeSingle();

  if (existing?.row_number) {
    const range = encodeURIComponent(`'${sheetName}'!A${existing.row_number}:O${existing.row_number}`);
    await sheetsRequest(accessToken, `${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [rowValues] })
    });
    await supabaseAdmin.from("sheets_sync_state")
      .update({ synced_at: new Date().toISOString() })
      .eq("point_id", pointId).eq("sheet_name", sheetName);
    return;
  }

  const appendRange = encodeURIComponent(`'${sheetName}'!A:O`);
  const result = await sheetsRequest(
    accessToken,
    `${spreadsheetId}/values/${appendRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [rowValues] }) }
  );
  const rowNumber = parseRowNumberFromUpdatedRange(result.updates.updatedRange);

  await supabaseAdmin.from("sheets_sync_state").upsert({
    point_id: pointId,
    sheet_name: sheetName,
    row_number: rowNumber,
    synced_at: new Date().toISOString()
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("SHEETS_ALLOWED_ORIGINS") || "").split(",").map(v => v.trim()).filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) {
    return jsonResponse(req, { error: "Origine non autorisée." }, 403);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const spreadsheetId = Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !spreadsheetId) {
      return jsonResponse(req, { error: "Configuration serveur incomplète (Supabase/Google Sheets)." }, 500);
    }

    // Même contrôle que ai-agent/index.ts : session réelle ET compte
    // approuvé (agent/admin), jamais la seule présence d'un header.
    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authUserError } = await authedClient.auth.getUser();
    if (authUserError || !user) return jsonResponse(req, { error: "Session invalide ou expirée." }, 401);

    const { data: roleRow } = await authedClient.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    if (!roleRow || (roleRow.role !== "agent" && roleRow.role !== "admin")) {
      return jsonResponse(req, { error: "Compte non approuvé — accès refusé." }, 403);
    }

    const contentLength = Number(req.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) return jsonResponse(req, { error: "Requête trop volumineuse." }, 413);

    const { pointId, fields } = await req.json();
    if (typeof pointId !== "string" || !pointId || !fields || typeof fields !== "object") {
      return jsonResponse(req, { error: "Payload invalide (pointId/fields requis)." }, 400);
    }
    const city = typeof fields.city === "string" && fields.city.trim() ? fields.city.trim() : null;

    const rowValues = COLUMNS.map(c => {
      const v = (fields as Record<string, unknown>)[c.key];
      if (c.key === "point_id") return pointId;
      if (c.key === "visited") return v ? "oui" : "non";
      return v ?? "";
    });

    const accessToken = await getGoogleAccessToken();
    // service_role : seul rôle autorisé à toucher sheets_sync_state (RLS
    // sans policy pour authenticated/anon, voir add_sheets_sync.sql).
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Général d'abord (toujours tenté), puis l'onglet ville s'il y en a une
    // — un point sans ville renseignée part quand même dans "Général".
    await upsertRowInSheet(accessToken, spreadsheetId, supabaseAdmin, GENERAL_SHEET_NAME, pointId, rowValues);
    if (city) {
      await upsertRowInSheet(accessToken, spreadsheetId, supabaseAdmin, city, pointId, rowValues);
    }

    return jsonResponse(req, { success: true });
  } catch (err) {
    console.error("Sheets sync Edge Function Error:", err instanceof Error ? err.message : "unknown error");
    return jsonResponse(req, { success: false, error: "Échec de l'envoi vers Google Sheets." }, 500);
  }
});
