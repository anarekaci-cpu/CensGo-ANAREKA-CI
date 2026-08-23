import { describe, it, expect } from "vitest";
import { extractExifGps } from "../core/exif.js";

/**
 * Construit un buffer JPEG minimal (SOI + APP1/Exif + TIFF + IFD0 + GPS IFD)
 * portant uniquement les 4 tags GPS nécessaires — assez pour valider le
 * parseur byte-à-byte sans dépendre d'une vraie photo.
 */
function buildJpegWithGps({ latDms, latRef, lonDms, lonRef }) {
  const buf = new ArrayBuffer(200);
  const view = new DataView(buf);
  let p = 0;

  view.setUint16(p, 0xffd8); p += 2; // SOI
  view.setUint16(p, 0xffe1); p += 2; // APP1
  const lengthFieldOffset = p; p += 2; // rempli à la fin
  writeAscii(view, p, "Exif"); p += 4;
  view.setUint8(p, 0); p += 1;
  view.setUint8(p, 0); p += 1;

  const tiffStart = p; // == TIFF_START
  writeAscii(view, p, "II"); p += 2; // little-endian
  view.setUint16(p, 0x002a, true); p += 2;
  view.setUint32(p, 8, true); p += 4; // IFD0 offset = 8 (relatif à tiffStart)

  // IFD0 à tiffStart+8 : 1 entrée (GPSInfo pointer) + next-IFD-offset
  const ifd0Offset = tiffStart + 8;
  view.setUint16(ifd0Offset, 1, true); // count = 1
  const gpsIfdOffset = ifd0Offset + 2 + 12 + 4; // juste après IFD0
  writeIfdEntry(view, ifd0Offset + 2, { tag: 0x8825, type: 4, count: 1, value: gpsIfdOffset - tiffStart }, true);
  view.setUint32(ifd0Offset + 2 + 12, 0, true); // pas d'IFD suivant

  // GPS IFD : 4 entrées (LatRef, Lat, LonRef, Lon) + next-IFD-offset
  view.setUint16(gpsIfdOffset, 4, true);
  const gpsEntriesStart = gpsIfdOffset + 2;
  const gpsDataStart = gpsEntriesStart + 4 * 12 + 4;

  // GPSLatitudeRef (ASCII, count=2, tient inline)
  writeAsciiInline(view, gpsEntriesStart + 0 * 12, 1, latRef);
  // GPSLatitude (RATIONAL x3, count=3 -> offset externe)
  writeIfdEntry(view, gpsEntriesStart + 1 * 12, { tag: 2, type: 5, count: 3, value: gpsDataStart - tiffStart }, true);
  writeRational3(view, gpsDataStart, latDms, true);

  // GPSLongitudeRef
  writeAsciiInline(view, gpsEntriesStart + 2 * 12, 3, lonRef);
  // GPSLongitude
  const lonDataStart = gpsDataStart + 24;
  writeIfdEntry(view, gpsEntriesStart + 3 * 12, { tag: 4, type: 5, count: 3, value: lonDataStart - tiffStart }, true);
  writeRational3(view, lonDataStart, lonDms, true);

  view.setUint32(gpsEntriesStart + 4 * 12, 0, true); // pas d'IFD suivant

  const segLength = (lonDataStart + 24) - (lengthFieldOffset); // longueur du segment APP1 (inclut le champ longueur lui-même)
  view.setUint16(lengthFieldOffset, segLength);

  return buf;
}

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function writeAsciiInline(view, entryOffset, tag, char) {
  view.setUint16(entryOffset, tag, true);
  view.setUint16(entryOffset + 2, 2, true); // type ASCII
  view.setUint32(entryOffset + 4, 2, true); // count = 2 (char + \0)
  view.setUint8(entryOffset + 8, char.charCodeAt(0));
  view.setUint8(entryOffset + 9, 0);
}

function writeIfdEntry(view, entryOffset, { tag, type, count, value }, little) {
  view.setUint16(entryOffset, tag, little);
  view.setUint16(entryOffset + 2, type, little);
  view.setUint32(entryOffset + 4, count, little);
  view.setUint32(entryOffset + 8, value, little);
}

function writeRational3(view, offset, [deg, min, sec], little) {
  [deg, min, sec].forEach((v, i) => {
    view.setUint32(offset + i * 8, v, little);
    view.setUint32(offset + i * 8 + 4, 1, little); // dénominateur = 1
  });
}

describe("extractExifGps", () => {
  it("décode une position Nord/Est", () => {
    const buf = buildJpegWithGps({
      latDms: [5, 22, 20],
      latRef: "N",
      lonDms: [3, 58, 3],
      lonRef: "E"
    });
    const gps = extractExifGps(buf);
    expect(gps).not.toBeNull();
    expect(gps.lat).toBeCloseTo(5 + 22 / 60 + 20 / 3600, 5);
    expect(gps.lon).toBeCloseTo(3 + 58 / 60 + 3 / 3600, 5);
  });

  it("applique le signe négatif pour Sud/Ouest", () => {
    const buf = buildJpegWithGps({
      latDms: [5, 22, 20],
      latRef: "S",
      lonDms: [3, 58, 3],
      lonRef: "W"
    });
    const gps = extractExifGps(buf);
    expect(gps.lat).toBeLessThan(0);
    expect(gps.lon).toBeLessThan(0);
  });

  it("retourne null pour un buffer sans en-tête JPEG valide", () => {
    expect(extractExifGps(new ArrayBuffer(10))).toBeNull();
  });

  it("retourne null pour un JPEG sans segment APP1/Exif", () => {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint16(0, 0xffd8);
    view.setUint16(2, 0xffda); // Start of Scan direct, pas de métadonnées
    expect(extractExifGps(buf)).toBeNull();
  });
});
