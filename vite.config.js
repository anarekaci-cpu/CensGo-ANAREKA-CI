import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function aiApiPlugin() {
  return {
    name: "vite-plugin-ai-api",
    configureServer(server) {
      server.middlewares.use("/api/ai", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end(JSON.stringify({ error: "Method not allowed" }));
        }

        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", async () => {
          try {
            const { action, prompt, points, userPos, imageBase64, mimeType } = JSON.parse(body || "{}");
            const apiKey = process.env.GEMINI_API_KEY;

            if (!apiKey) {
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({
                success: false,
                fallback: true,
                message: "Clé GEMINI_API_KEY non configurée. Mode secours IA activé."
              }));
            }

            const { GoogleGenAI } = await import("@google/genai");
            const ai = new GoogleGenAI({
              apiKey: apiKey,
              httpOptions: {
                headers: { "User-Agent": "aistudio-build" }
              }
            });

            let systemInstruction = "Tu es un agent IA spécialisé dans l'optimisation du recensement terrain ANAREKA-CI à Bingerville, Côte d'Ivoire. Sois concis, précis, professionnel et orienté terrain en français.";
            let contents = prompt;

            if (action === "optimize_tour") {
              systemInstruction = "Tu es l'Agent IA Strategist d'ANAREKA-CI. Tu analyses la liste des ménages/points de recensement et leur localisation pour donner des conseils tactiques de parcours terrain à Bingerville.";
              contents = `Voici la liste des points de recensement (${points ? points.length : 0} points): ${JSON.stringify(points)}. Position agent: ${JSON.stringify(userPos)}. Analyse ces données et donne 3 conseils tactiques de tournée terrain optimisée.`;
            } else if (action === "audit_quality") {
              systemInstruction = "Tu es l'Agent IA Inspecteur Qualité Données ANAREKA-CI. Tu détectes les anomalies, numéros de téléphones invalides, statuts douteux ou informations manquantes.";
              contents = `Audite cette liste de points de recensement: ${JSON.stringify(points)}. Liste les anomalies détectées et donne des suggestions de correction rapides.`;
            } else if (action === "parse_voice_note") {
              systemInstruction = "Tu es l'Agent Transcripteur IA pour le recensement ANAREKA-CI. Extrais les informations structurées de cette note vocale terrain sous forme de JSON strict: { name, tel, quartier, address, produits, status (Vert, Jaune, Rouge, Violet), visited (boolean), summary }.";
              contents = `Note vocale agent terrain : "${prompt}". Extrais les informations sous format JSON.`;
            } else if (action === "vision_ocr" && imageBase64) {
              systemInstruction = "Tu es l'Agent Vision Reconnaissance ANAREKA-CI. Analyse cette photo terrain (compteur d'électricité/eau, badge d'habitation, document) et extrais le numéro de compteur, le nom, l'état visuel et toute information utile en français.";
              const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
              contents = [
                { inlineData: { data: cleanBase64, mimeType: mimeType || "image/jpeg" } },
                { text: "Analyse cette image de recensement terrain. Identifie le numéro de compteur, la lisibilité, l'adresse ou le nom si présent, et donne un résumé très clair." }
              ];
            } else if (action === "daily_briefing") {
              systemInstruction = "Tu es l'Agent IA Directrice de Mission pour ANAREKA-CI Bingerville. Génère un briefing matinal motivant et analytique pour l'agent de recensement.";
              contents = `Données du secteur (${points ? points.length : 0} points): ${JSON.stringify(points)}. Génère un briefing terrain synthétique avec objectifs du jour, zones d'intervention et recommandations météo/accès.`;
            }

            const response = await ai.models.generateContent({
              model: "gemini-3.6-flash",
              contents: contents,
              config: { systemInstruction }
            });

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              success: true,
              result: response.text
            }));
          } catch (err) {
            console.error("AI API Error:", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  base: "/",
  server: {
    host: "0.0.0.0",
    port: 3000
  },
  plugins: [
    aiApiPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Recensement ANAREKA-CI",
        short_name: "ANAREKA-CI",
        start_url: "/Recensement-ANAREKA-CI/",
        display: "standalone",
        background_color: "#1a3d2b",
        theme_color: "#1a3d2b",
        orientation: "portrait-primary",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 5000, maxAgeSeconds: 86400 * 30 }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
