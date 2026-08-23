// Régénère les icônes PNG (public/icon-*.png, apple-touch-icon.png) depuis
// les SVG source (public/icon-192.svg, icon-512.svg). À relancer après
// toute modification du logo. PNG indispensable en plus du SVG : requis par
// l'installation Android (WebAPK), les générateurs d'APK (PWABuilder,
// Bubblewrap) et apple-touch-icon (iOS ne lit pas le SVG pour l'écran
// d'accueil) — voir vite.config.js pour où ces fichiers sont référencés.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg192 = readFileSync(join(publicDir, "icon-192.svg"));
const svg512 = readFileSync(join(publicDir, "icon-512.svg"));

const DENSITY = 384; // rendu net avant redimensionnement, texte/emoji inclus

async function run() {
  await sharp(svg512, { density: DENSITY }).resize(512, 512).png().toFile(join(publicDir, "icon-512.png"));
  await sharp(svg192, { density: DENSITY }).resize(192, 192).png().toFile(join(publicDir, "icon-192.png"));
  await sharp(svg512, { density: DENSITY }).resize(180, 180).png().toFile(join(publicDir, "apple-touch-icon.png"));
  await sharp(svg512, { density: DENSITY }).resize(512, 512).png().toFile(join(publicDir, "icon-512-maskable.png"));
  console.log("✅ Icônes PNG régénérées dans public/");
}

run().catch((err) => {
  console.error("❌ Échec de la génération des icônes:", err);
  process.exit(1);
});
