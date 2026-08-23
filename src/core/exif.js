/**
 * Extraction minimale des coordonnées GPS EXIF d'un JPEG.
 *
 * Ne lit QUE ce qui est nécessaire pour GPSLatitude/GPSLongitude (segment
 * APP1 "Exif", IFD0 -> pointeur GPS IFD -> tags 1-4) — ce n'est PAS un
 * parseur EXIF complet, volontairement, pour rester petit et vérifiable.
 * Beaucoup de photos n'ont pas de GPS EXIF (métadonnées retirées par
 * l'app photo, GPS désactivé...) : retourne `null` dans ce cas, jamais
 * une erreur — c'est un signal "on ne peut pas vérifier", pas un échec.
 *
 * Sert au recoupement géographique de la photo envoyée à l'Agent Vision
 * (voir appView.js, onglet "Photo OCR") : si la photo a été prise loin de
 * la position GPS actuelle de l'agent, c'est probablement une ancienne
 * photo de galerie plutôt qu'une prise fraîche sur le terrain.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{lat:number, lon:number}|null}
 */
export function extractExifGps(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break; // pas un marker JPEG valide

      if (marker === 0xffd8 || marker === 0x0001 || (marker >= 0xffd0 && marker <= 0xffd7)) {
        offset += 2; // markers sans segment de longueur (SOI, RSTn...)
        continue;
      }
      if (marker === 0xffda) break; // Start of Scan : plus de métadonnées après

      const segLength = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        const segStart = offset + 4;
        if (readAscii(view, segStart, 6) === "Exif\u0000\u0000") {
          return parseTiff(view, segStart + 6);
        }
      }
      offset += 2 + segLength;
    }
  } catch {
    return null;
  }
  return null;
}

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 9: 4, 10: 8 };

function readAscii(view, offset, length) {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function readIfdEntries(view, ifdOffset, little) {
  const entries = new Map();
  const count = view.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    entries.set(view.getUint16(entryOffset, little), {
      type: view.getUint16(entryOffset + 2, little),
      count: view.getUint32(entryOffset + 4, little),
      valueFieldOffset: entryOffset + 8
    });
  }
  return entries;
}

/**
 * Résout l'offset absolu (depuis le début du buffer) du bloc de données
 * d'un tag DONT LA VALEUR EST UN TABLEAU (ASCII, RATIONAL...) : si le
 * tableau tient dans les 4 octets du champ valeur, il y est stocké tel
 * quel (offset = l'adresse du champ lui-même) ; sinon le champ contient un
 * POINTEUR (relatif à tiffStart) vers les données réelles ailleurs dans le
 * buffer. Ne pas confondre avec readLongValue() ci-dessous, pour un tag
 * dont la valeur EST directement un entier (ex: le pointeur GPSInfo).
 */
function dataOffsetFor(view, tiffStart, entry, little) {
  const size = (TYPE_SIZES[entry.type] || 1) * entry.count;
  return size <= 4 ? entry.valueFieldOffset : tiffStart + view.getUint32(entry.valueFieldOffset, little);
}

/** Lit la valeur scalaire (LONG) d'un tag dont le champ contient le nombre lui-même. */
function readLongValue(view, entry, little) {
  return view.getUint32(entry.valueFieldOffset, little);
}

function readRational3(view, tiffStart, entry, little) {
  if (entry.type !== 5 || entry.count < 3) return null;
  const start = dataOffsetFor(view, tiffStart, entry, little);
  const values = [];
  for (let i = 0; i < 3; i++) {
    const num = view.getUint32(start + i * 8, little);
    const den = view.getUint32(start + i * 8 + 4, little);
    values.push(den === 0 ? 0 : num / den);
  }
  return values; // [degrés, minutes, secondes]
}

function readAsciiTag(view, tiffStart, entry, little) {
  if (entry.type !== 2) return null;
  const start = dataOffsetFor(view, tiffStart, entry, little);
  return readAscii(view, start, 1); // GPS*Ref : un seul caractère utile
}

function dmsToDecimal([deg, min, sec]) {
  return deg + min / 60 + sec / 3600;
}

function parseTiff(view, tiffStart) {
  const byteOrder = readAscii(view, tiffStart, 2);
  const little = byteOrder === "II";
  if (!little && byteOrder !== "MM") return null;
  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null;

  const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, little);
  const ifd0 = readIfdEntries(view, ifd0Offset, little);

  const gpsPointer = ifd0.get(0x8825);
  if (!gpsPointer) return null;

  const gpsIfdOffset = tiffStart + readLongValue(view, gpsPointer, little);
  const gpsIfd = readIfdEntries(view, gpsIfdOffset, little);

  const latDms = gpsIfd.get(2) && readRational3(view, tiffStart, gpsIfd.get(2), little);
  const lonDms = gpsIfd.get(4) && readRational3(view, tiffStart, gpsIfd.get(4), little);
  if (!latDms || !lonDms) return null;

  const latRef = (gpsIfd.get(1) && readAsciiTag(view, tiffStart, gpsIfd.get(1), little)) || "N";
  const lonRef = (gpsIfd.get(3) && readAsciiTag(view, tiffStart, gpsIfd.get(3), little)) || "E";

  const lat = dmsToDecimal(latDms) * (latRef === "S" ? -1 : 1);
  const lon = dmsToDecimal(lonDms) * (lonRef === "W" ? -1 : 1);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
