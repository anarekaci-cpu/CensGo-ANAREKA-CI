import { describe, it, expect, beforeEach } from "vitest";
import {
  isStationary,
  resolveGpsProfile,
  nextGpsPowerPreference,
  readGpsPowerPreference,
  writeGpsPowerPreference,
  describeGpsPowerMode,
  GPS_PROFILES,
  STATIONARY_WINDOW_MS,
  LOW_BATTERY_THRESHOLD
} from "../core/gpsPowerMode.js";

// ~1.1 m par 0.00001° de latitude — assez pour fabriquer des écarts francs.
const at = (lat, lng, tMs) => ({ lat, lng, timestamp: tMs });

describe("isStationary", () => {
  const W = STATIONARY_WINDOW_MS;

  it("false si moins de 2 fixes", () => {
    expect(isStationary([])).toBe(false);
    expect(isStationary([at(5.3, -4.0, 0)])).toBe(false);
  });

  it("true : toutes les positions groupées et l'historique couvre toute la fenêtre", () => {
    const fixes = [
      at(5.30000, -4.00000, 0),
      at(5.30001, -4.00001, W * 0.4),
      at(5.30000, -4.00002, W * 0.8),
      at(5.30001, -4.00000, W + 1000)
    ];
    expect(isStationary(fixes)).toBe(true);
  });

  it("false si un fix de la fenêtre s'éloigne au-delà du rayon", () => {
    const fixes = [
      at(5.30000, -4.00000, 0),
      at(5.30050, -4.00050, W * 0.5), // ~70 m plus loin
      at(5.30000, -4.00000, W + 1000)
    ];
    expect(isStationary(fixes)).toBe(false);
  });

  it("false tant que l'historique ne couvre pas une fenêtre complète (pas assez de recul)", () => {
    const fixes = [
      at(5.30000, -4.00000, 0),
      at(5.30001, -4.00001, 5000),
      at(5.30000, -4.00000, 10000)
    ];
    expect(isStationary(fixes)).toBe(false);
  });

  it("ignore les entrées invalides sans planter", () => {
    const fixes = [
      at(5.30000, -4.00000, 0),
      { lat: NaN, lng: -4, timestamp: W * 0.3 },
      null,
      at(5.30000, -4.00001, W * 0.6),
      at(5.30001, -4.00001, W + 1000)
    ];
    expect(isStationary(fixes)).toBe(true);
  });
});

describe("resolveGpsProfile", () => {
  it("préférence 'high' -> profil high quel que soit le contexte", () => {
    const p = resolveGpsProfile({ preference: "high", batteryLevel: 0.05, stationary: true });
    expect(p.name).toBe("high");
    expect(p.enableHighAccuracy).toBe(true);
    expect(p.minIntervalMs).toBe(GPS_PROFILES.high.minIntervalMs);
  });

  it("préférence 'saver' -> profil saver quel que soit le contexte", () => {
    const p = resolveGpsProfile({ preference: "saver", batteryLevel: 0.99, charging: true, stationary: false });
    expect(p.name).toBe("saver");
    expect(p.enableHighAccuracy).toBe(false);
  });

  it("auto + batterie faible hors charge -> saver (reason battery-low)", () => {
    const p = resolveGpsProfile({ preference: "auto", batteryLevel: LOW_BATTERY_THRESHOLD - 0.01, charging: false });
    expect(p.name).toBe("saver");
    expect(p.reason).toBe("battery-low");
  });

  it("auto + batterie faible MAIS en charge -> pas saver", () => {
    const p = resolveGpsProfile({ preference: "auto", batteryLevel: 0.1, charging: true });
    expect(p.name).toBe("normal");
  });

  it("auto + immobile -> saver (reason stationary)", () => {
    const p = resolveGpsProfile({ preference: "auto", batteryLevel: 0.9, stationary: true });
    expect(p.name).toBe("saver");
    expect(p.reason).toBe("stationary");
  });

  it("auto + en mouvement + batterie OK -> normal (= réglage historique)", () => {
    const p = resolveGpsProfile({ preference: "auto", batteryLevel: 0.9, charging: false, stationary: false });
    expect(p.name).toBe("normal");
    expect(p).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000
    });
  });

  it("auto + API Battery indisponible (batteryLevel null) -> normal, pas de crash", () => {
    const p = resolveGpsProfile({ preference: "auto", batteryLevel: null, charging: null, stationary: false });
    expect(p.name).toBe("normal");
  });

  it("entrée vide -> normal", () => {
    expect(resolveGpsProfile().name).toBe("normal");
  });
});

describe("nextGpsPowerPreference", () => {
  it("fait défiler auto -> saver -> high -> auto", () => {
    expect(nextGpsPowerPreference("auto")).toBe("saver");
    expect(nextGpsPowerPreference("saver")).toBe("high");
    expect(nextGpsPowerPreference("high")).toBe("auto");
  });

  it("valeur inconnue -> auto", () => {
    expect(nextGpsPowerPreference("n'importe quoi")).toBe("auto");
  });
});

describe("persistance de la préférence", () => {
  beforeEach(() => {
    try { localStorage.removeItem("anareka.gpsPowerMode"); } catch { /* jsdom sans storage */ }
  });

  it("défaut 'auto' quand rien n'est stocké", () => {
    expect(readGpsPowerPreference()).toBe("auto");
  });

  it("roundtrip d'une valeur valide", () => {
    writeGpsPowerPreference("saver");
    expect(readGpsPowerPreference()).toBe("saver");
  });

  it("une valeur invalide écrite est normalisée en 'auto'", () => {
    expect(writeGpsPowerPreference("turbo")).toBe("auto");
    expect(readGpsPowerPreference()).toBe("auto");
  });
});

describe("describeGpsPowerMode", () => {
  it("libellés selon préférence et profil effectif", () => {
    expect(describeGpsPowerMode("high")).toMatch(/précision max/i);
    expect(describeGpsPowerMode("saver")).toMatch(/économie/i);
    expect(describeGpsPowerMode("auto", "normal")).toBe("GPS auto");
    expect(describeGpsPowerMode("auto", "saver")).toMatch(/auto.*économie/i);
  });
});
