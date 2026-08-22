import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizePointId } from "../core/utils.js";

/**
 * Problème #4 — le popup ne doit JAMAIS être associé au mauvais point.
 *
 * Test d'intégration de la chaîne complète :
 *   store.points -> GeoJSON -> Supercluster -> marqueur -> click
 *   -> récupération du point -> popup
 * avec maplibre-gl simulé mais Supercluster RÉEL, et des ids volontairement
 * mixtes (number / string UUID / string numérique).
 */

const state = vi.hoisted(() => ({
  markerWrappers: [],
  popups: [],
  fakeMap: null
}));

vi.mock("maplibre-gl", () => {
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this._lngLat = null;
      state.markerWrappers.push(this);
    }
    setLngLat(c) { this._lngLat = c; return this; }
    addTo() { return this; }
    remove() { }
    getLngLat() { return { lng: this._lngLat?.[0], lat: this._lngLat?.[1] }; }
  }
  class Popup {
    constructor() {
      this.content = null;
      this.open = false;
      this.handlers = {};
      this._lngLat = null;
      state.popups.push(this);
    }
    setLngLat(c) { this._lngLat = c; return this; }
    setDOMContent(el) { this.content = el; return this; }
    addTo() { this.open = true; return this; }
    on(ev, cb) { this.handlers[ev] = cb; return this; }
    isOpen() { return this.open; }
    remove() { this.open = false; this.handlers.close?.(); }
  }
  class LngLatBounds {
    extend() { }
  }
  const lib = { Marker, Popup, LngLatBounds };
  return { default: lib, ...lib };
});

vi.mock("../modules/map/map.js", async () => {
  const { default: Supercluster } = await import("supercluster");
  // radius 0 : aucun regroupement -> chaque point est cliquable individuellement
  const cluster = new Supercluster({ radius: 0, maxZoom: 17 });
  const fakeMap = {
    on() { },
    off() { },
    getBounds() {
      return { getWest: () => -180, getSouth: () => -85, getEast: () => 180, getNorth: () => 85 };
    },
    getZoom() { return 12; },
    easeTo() { },
    fitBounds() { },
    isStyleLoaded() { return true; },
    once() { },
    addSource() { },
    addLayer() { },
    getLayer() { return false; },
    getSource() { return false; },
    removeLayer() { },
    removeSource() { }
  };
  state.fakeMap = fakeMap;
  return {
    getMap: () => fakeMap,
    getClusterGroup: () => cluster,
    flyToPoint: vi.fn(),
    showUserLocation: vi.fn(),
    hideUserLocation: vi.fn(),
    fitToBounds: vi.fn(),
    addRouteLayer: vi.fn(),
    clearRouteLayers: vi.fn(),
    fitRouteBounds: vi.fn(),
    showDestinationMarker: vi.fn(),
    hideDestinationMarker: vi.fn()
  };
});

vi.mock("../modules/census/censusFormModal.js", () => ({
  openCensusForm: vi.fn()
}));

vi.mock("../db/database.js", () => ({
  updatePointVisit: vi.fn(async () => ({}))
}));

const { store } = await import("../core/store.js");
const { renderMarkers } = await import("../modules/census/markers.js");

// Trois points aux représentations d'id volontairement différentes :
// A = number (vieux cache Supabase), B = string UUID (création offline),
// C = string numérique (données normalisées récentes).
const POINT_A = { id: 123, name: "Chez Awa", lat: 5.36, lon: -3.97, status: "VERT (Joignable)", visited: false };
const POINT_B = { id: "arka_uuid-b", name: "Kiosque Bamba", lat: 5.40, lon: -3.99, status: "ROUGE (Absent)", visited: false };
const POINT_C = { id: "789", name: "Restaurant C", lat: 5.32, lon: -3.95, status: "NON DEFINI", visited: true };

function clickMarker(pointId) {
  const pid = normalizePointId(pointId);
  const wrapper = state.markerWrappers.find(m => m.el._pointId === pid);
  if (!wrapper) throw new Error(`Marqueur introuvable pour ${pid}`);
  wrapper.el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function lastPopupText() {
  const popup = state.popups[state.popups.length - 1];
  return popup?.content?.textContent || "";
}

beforeEach(() => {
  // NB : markerWrappers n'est PAS vidé — le pool de marqueurs de markers.js
  // persiste au niveau module et RÉUTILISE les mêmes instances Marker/element
  // d'un test à l'autre (acquire/release). Vider la liste casserait la
  // recherche alors que les éléments restent valides (_pointId mis à jour).
  state.popups.length = 0;
  store.set("geo.position", null);
  store.set("points", [POINT_A, POINT_B, POINT_C]);
});

describe("chaîne marker -> point -> popup (ids mixtes)", () => {
  it("clic sur A (id number 123) affiche les infos de A", () => {
    renderMarkers(store.get("points"));
    clickMarker(123);
    const text = lastPopupText();
    expect(text).toContain("Chez Awa");
    expect(text).not.toContain("Kiosque Bamba");
    expect(text).not.toContain("Restaurant C");
  });

  it("clic sur B (UUID string) puis C (string numérique) : chaque popup correspond exactement au point", () => {
    renderMarkers(store.get("points"));
    clickMarker("arka_uuid-b");
    expect(lastPopupText()).toContain("Kiosque Bamba");
    clickMarker("789");
    expect(lastPopupText()).toContain("Restaurant C");
    expect(lastPopupText()).not.toContain("Kiosque Bamba");
  });

  it("scénario A -> B -> retour A : le popup revient sur les bonnes infos", () => {
    renderMarkers(store.get("points"));
    clickMarker(123);
    clickMarker("arka_uuid-b");
    clickMarker("123"); // dataset.id est une STRING même si p.id est number
    const text = lastPopupText();
    expect(text).toContain("Chez Awa");
    expect(text).not.toContain("Kiosque Bamba");
  });

  it("les boutons du popup portent l'id normalisé du bon point", () => {
    renderMarkers(store.get("points"));
    clickMarker(123);
    const popup = state.popups[state.popups.length - 1];
    const routeBtn = popup.content.querySelector('[data-action="route"]');
    expect(routeBtn.dataset.id).toBe("123");
  });

  it("action Itinéraire : destination = EXACTEMENT le point cliqué", async () => {
    renderMarkers(store.get("points"));
    clickMarker("arka_uuid-b");
    const popup = state.popups[state.popups.length - 1];
    popup.content.querySelector('[data-action="route"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Laisser la micro-tâche store se vider
    await Promise.resolve();
    expect(normalizePointId(store.get("navigation.destination").id)).toBe("arka_uuid-b");
    expect(store.get("navigation.destination").name).toBe("Kiosque Bamba");
  });

  it("Audit : un second clic Itinéraire sur LE MÊME point (retry après échec) redéclenche bien le calcul", async () => {
    // Bug trouvé à l'audit : store.set() ignore une valeur si elle a la
    // MÊME RÉFÉRENCE que l'ancienne (core/store.js). getPointById() renvoie
    // toujours la même référence tant que store.points n'a pas changé, donc
    // après un premier échec (GPS non fixé, timeout OSRM...), chaque clic
    // "Itinéraire" suivant sur CE MÊME point ne déclenchait plus aucun
    // abonné — aucune erreur, mais plus aucune tentative non plus.
    // store.set() (core/store.js) n'avertit les abonnés QUE si la nouvelle
    // valeur diffère par référence (oldValue !== value) de l'ancienne. La
    // preuve directe et déterministe du correctif est donc : deux clics sur
    // le même point doivent produire deux références DIFFÉRENTES pour
    // navigation.destination (sinon le second clic serait un no-op silencieux
    // pour tout abonné, exactement le bug observé en terrain).
    renderMarkers(store.get("points"));

    clickMarker(123);
    const popup1 = state.popups[state.popups.length - 1];
    popup1.content.querySelector('[data-action="route"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dest1 = store.get("navigation.destination");

    clickMarker(123);
    const popup2 = state.popups[state.popups.length - 1];
    popup2.content.querySelector('[data-action="route"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dest2 = store.get("navigation.destination");

    expect(dest1).not.toBe(dest2); // références différentes -> le store notifiera bien les abonnés
    expect(normalizePointId(dest1.id)).toBe("123");
    expect(normalizePointId(dest2.id)).toBe("123");
  });

  it("popup complet : téléphone, quartier, adresse, statut présents", () => {
    renderMarkers(store.get("points"));
    clickMarker(123);
    const text = lastPopupText();
    expect(text).toContain("Quartier:");
    expect(text).toContain("Adresse:");
    expect(text).toContain("Téléphone:");
    expect(text).toContain("VERT (Joignable)");
    expect(text).toContain("Itinéraire");
    expect(text).toContain("visité");
  });

  it("les coordonnées des features sont bien [lon, lat]", () => {
    renderMarkers(store.get("points"));
    const wrapper = state.markerWrappers.find(m => m.el._pointId === "123");
    // Abidjan : lon -3.97 DOIT être en première position GeoJSON
    expect(wrapper._lngLat[0]).toBe(-3.97);
    expect(wrapper._lngLat[1]).toBe(5.36);
  });
});
