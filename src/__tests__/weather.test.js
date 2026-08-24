import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  getMeta: vi.fn(async () => null),
  setMeta: vi.fn(async () => {})
}));

vi.mock("../db/database.js", () => dbMock);

const { getWeather, getRainAlert, describeWeatherCode } = await import("../modules/weather/weather.js");

function openMeteoResponse({ weatherCode = 0, precipitation = 0, rainProbabilityPct = 10 } = {}) {
  return {
    current: {
      temperature_2m: 28.4,
      precipitation,
      weather_code: weatherCode,
      wind_speed_10m: 12,
      is_day: 1
    },
    daily: {
      weather_code: [weatherCode, 2],
      temperature_2m_max: [31, 30],
      temperature_2m_min: [24, 23],
      precipitation_probability_max: [rainProbabilityPct, 20],
      precipitation_sum: [0, 0]
    }
  };
}

describe("weather", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getMeta.mockResolvedValue(null);
    globalThis.fetch = vi.fn();
  });

  it("getWeather() normalise la réponse Open-Meteo et met en cache", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => openMeteoResponse({ weatherCode: 0 })
    });

    const weather = await getWeather(5.37, -3.97);

    expect(weather.current.temperatureC).toBe(28.4);
    expect(weather.today.tempMaxC).toBe(31);
    expect(weather.tomorrow.tempMaxC).toBe(30);
    expect(dbMock.setMeta).toHaveBeenCalledTimes(1);
  });

  it("getWeather() réutilise le cache si assez frais, sans appel réseau", async () => {
    dbMock.getMeta.mockResolvedValue({
      current: { temperatureC: 25 },
      today: {},
      tomorrow: {},
      fetchedAt: Date.now()
    });

    const weather = await getWeather(5.37, -3.97);

    expect(weather.current.temperatureC).toBe(25);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("getWeather() retombe sur le cache périmé si le réseau échoue", async () => {
    dbMock.getMeta.mockResolvedValue({
      current: { temperatureC: 25 },
      today: {},
      tomorrow: {},
      fetchedAt: Date.now() - 60 * 60 * 1000 // 1h > TTL 30min
    });
    globalThis.fetch.mockRejectedValue(new Error("offline"));

    const weather = await getWeather(5.37, -3.97);

    expect(weather.current.temperatureC).toBe(25);
    expect(weather.stale).toBe(true);
  });

  it("getWeather() lève si aucun réseau ni cache n'est disponible", async () => {
    globalThis.fetch.mockRejectedValue(new Error("offline"));
    await expect(getWeather(5.37, -3.97)).rejects.toThrow();
  });

  it("getRainAlert() retourne null par temps sec", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => openMeteoResponse({ weatherCode: 0, precipitation: 0, rainProbabilityPct: 10 })
    });

    expect(await getRainAlert(5.37, -3.97)).toBeNull();
  });

  it("getRainAlert() alerte si il pleut actuellement", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => openMeteoResponse({ weatherCode: 63, precipitation: 2.5, rainProbabilityPct: 80 })
    });

    const alert = await getRainAlert(5.37, -3.97);
    expect(alert).not.toBeNull();
    expect(alert.message).toMatch(/pleut/i);
  });

  it("getRainAlert() alerte si la probabilité de pluie du jour dépasse le seuil, même ciel clair maintenant", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => openMeteoResponse({ weatherCode: 0, precipitation: 0, rainProbabilityPct: 70 })
    });

    const alert = await getRainAlert(5.37, -3.97);
    expect(alert).not.toBeNull();
    expect(alert.message).toMatch(/70%/);
  });

  it("getRainAlert() ne bloque jamais : retourne null si offline sans cache", async () => {
    globalThis.fetch.mockRejectedValue(new Error("offline"));
    expect(await getRainAlert(5.37, -3.97)).toBeNull();
  });

  it("describeWeatherCode() a un repli pour un code inconnu", () => {
    expect(describeWeatherCode(9999)).toEqual({ icon: "🌡️", label: "Conditions inconnues" });
    expect(describeWeatherCode(0).label).toBe("Ciel dégagé");
  });
});
