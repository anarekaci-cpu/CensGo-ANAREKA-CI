/**
 * Compression côté client d'une photo prise sur le terrain, avant stockage
 * local (Dexie, voir db/database.js: savePendingPhoto()) puis upload
 * Supabase Storage (syncEngine.js). Une photo de smartphone moderne pèse
 * couramment 3-8 Mo — inacceptable pour un upload sur réseau 3G dégradé
 * avec les timeouts déjà serrés de ce projet (12s/requête, voir
 * dataLoader.js) : redimensionnée et recompressée ici, une photo de terrain
 * (kiosque, façade) pèse typiquement 100-300 Ko sans perte visible utile.
 */

const MAX_DIMENSION_PX = 1280;
const JPEG_QUALITY = 0.7;

/**
 * @param {File|Blob} file
 * @returns {Promise<{blob: Blob, mimeType: string}>}
 */
export async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Échec de la compression de la photo."))),
        "image/jpeg",
        JPEG_QUALITY
      );
    });

    return { blob, mimeType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
