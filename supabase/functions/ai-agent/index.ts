import { GoogleGenAI } from "npm:@google/genai@^2.14.0";
import { createClient } from "npm:@supabase/supabase-js@^2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // BUG corrigé (audit sécurité) : cette fonction vérifiait seulement la
    // PRÉSENCE d'un header Authorization, jamais qu'il appartienne à un
    // utilisateur réel et approuvé. La clé anon publique (déjà présente
    // dans le bundle client, voir SECURITY.md) constitue en soi un
    // "Authorization" valide pour ce test — n'importe qui pouvait donc
    // appeler cette fonction (y compris vision_ocr, coûteux) sans jamais
    // s'être inscrit ni avoir été validé, consommant le quota GEMINI_API_KEY
    // payant de l'association sans aucune limite. On valide maintenant que
    // le token correspond à une session réelle (auth.getUser()) ET à un
    // compte approuvé (user_roles.role IN ('agent','admin')) — même modèle
    // que is_approved_user() côté Postgres (schema.sql).
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Configuration serveur incomplète (SUPABASE_URL/SUPABASE_ANON_KEY)." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authUserError } = await authedClient.auth.getUser();
    if (authUserError || !user) {
      return new Response(
        JSON.stringify({ error: "Session invalide ou expirée." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: roleRow } = await authedClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!roleRow || (roleRow.role !== "agent" && roleRow.role !== "admin")) {
      return new Response(
        JSON.stringify({ error: "Compte non approuvé — accès refusé." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, fallback: true, message: "GEMINI_API_KEY not configured." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, prompt, points, userPos, imageBase64, mimeType } = await req.json();

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });

    let systemInstruction = "Tu es un agent IA spécialisé dans le recensement terrain des restaurateurs, kiosques d'attiéké, vendeurs ambulants et producteurs pour l'ANAREKA-CI (Association Nationale des Restaurateurs et Kiosques d'Attiéké de Côte d'Ivoire). Sois concis, précis, professionnel et orienté terrain en français.";
    let contents = prompt;

    if (action === "optimize_tour") {
      systemInstruction = "Tu es l'Agent IA Strategist d'ANAREKA-CI. Tu analyses la liste des restaurateurs/kiosques d'attiéké recensés et leur localisation pour donner des conseils tactiques de parcours terrain.";
      contents = `Voici la liste des points de recensement (${points ? points.length : 0} restaurateurs/kiosques): ${JSON.stringify(points)}. Position agent: ${JSON.stringify(userPos)}. Analyse ces données et donne 3 conseils tactiques de tournée terrain optimisée.`;
    } else if (action === "audit_quality") {
      systemInstruction = "Tu es l'Agent IA Inspecteur Qualité Données ANAREKA-CI. Tu détectes les anomalies, numéros de téléphones invalides, statuts douteux ou informations manquantes dans les fiches de restaurateurs/kiosques d'attiéké.";
      contents = `Audite cette liste de points de recensement: ${JSON.stringify(points)}. Liste les anomalies détectées et donne des suggestions de correction rapides.`;
    } else if (action === "parse_voice_note") {
      systemInstruction = "Tu es l'Agent Transcripteur IA pour le recensement ANAREKA-CI. Extrais les informations structurées de cette note vocale terrain sous forme de JSON strict: { name, tel, quartier, address, produits, activityType (Kiosque d'attiéké fixe, Restaurant traditionnel, Vendeur ambulant, Producteur d'attiéké, Maquis/Gargote), status (Vert, Jaune, Rouge, Violet), visited (boolean), summary }.";
      contents = `Note vocale agent terrain : "${prompt}". Extrais les informations sous format JSON.`;
    } else if (action === "vision_ocr" && imageBase64) {
      systemInstruction = "Tu es l'Agent Vision Reconnaissance ANAREKA-CI. Analyse cette photo terrain (enseigne de kiosque/restaurant, étal de vente, badge d'adhérent, document) et extrais le nom de l'établissement, le type d'activité, l'état visuel et toute information utile en français.";
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      contents = [
        { inlineData: { data: cleanBase64, mimeType: mimeType || "image/jpeg" } },
        { text: "Analyse cette image de recensement terrain (kiosque, restaurant ou point de vente d'attiéké). Identifie le nom de l'enseigne, le type d'activité, la lisibilité, l'adresse ou le nom si présent, et donne un résumé très clair." }
      ];
    } else if (action === "daily_briefing") {
      systemInstruction = "Tu es l'Agent IA Directrice de Mission pour ANAREKA-CI. Génère un briefing matinal motivant et analytique pour l'agent de recensement terrain des restaurateurs et kiosques d'attiéké.";
      contents = `Données du secteur (${points ? points.length : 0} points): ${JSON.stringify(points)}. Génère un briefing terrain synthétique avec objectifs du jour, zones d'intervention et recommandations météo/accès.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents,
      config: { systemInstruction }
    });

    return new Response(
      JSON.stringify({ success: true, result: response.text }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("AI Edge Function Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
