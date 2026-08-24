import { describe, it, expect } from "vitest";
import { mergeTourStopsWithLiveStatus, buildTourReportHtml } from "../modules/report/tourReport.js";

describe("mergeTourStopsWithLiveStatus", () => {
  const originalPoints = [
    { id: "a1", name: "Chez Awa", quartier: "Plateau", tel: "0700000001", status: "VERT (Joignable)" },
    { id: "a2", name: "Kiosque Bamba", quartier: "Adjamé", tel: "0700000002", status: "NON DEFINI" }
  ];

  it("marque visité un point dont l'état vivant l'indique, avec son horodatage", () => {
    const livePoints = [
      { id: "a1", name: "Chez Awa", quartier: "Plateau", tel: "0700000001", status: "VERT (Joignable)", visited: true, updatedAt: "2026-08-24T09:00:00.000Z" },
      { id: "a2", name: "Kiosque Bamba", quartier: "Adjamé", tel: "0700000002", status: "NON DEFINI", visited: false }
    ];

    const stops = mergeTourStopsWithLiveStatus(originalPoints, livePoints);

    expect(stops[0].visited).toBe(true);
    expect(stops[0].updatedAt).toBe("2026-08-24T09:00:00.000Z");
    expect(stops[1].visited).toBe(false);
    expect(stops[1].updatedAt).toBeNull();
  });

  it("préserve l'ordre original de la tournée (numérotation 1..N)", () => {
    const stops = mergeTourStopsWithLiveStatus(originalPoints, []);
    expect(stops.map(s => s.order)).toEqual([1, 2]);
    expect(stops.map(s => s.id)).toEqual(["a1", "a2"]);
  });

  it("un point disparu du store vivant (supprimé) reste 'non visité', sans planter", () => {
    const stops = mergeTourStopsWithLiveStatus(originalPoints, [
      { id: "a1", visited: true, updatedAt: "2026-08-24T09:00:00.000Z" }
      // a2 absent
    ]);
    expect(stops[1].visited).toBe(false);
    expect(stops[1].name).toBe("Kiosque Bamba"); // repli sur le snapshot
  });

  it("compare les ids via normalizePointId (number vs string)", () => {
    const stops = mergeTourStopsWithLiveStatus(
      [{ id: 1001, name: "Point Number" }],
      [{ id: "1001", visited: true, updatedAt: "2026-08-24T09:00:00.000Z" }]
    );
    expect(stops[0].visited).toBe(true);
  });

  it("gère une liste vide sans erreur", () => {
    expect(mergeTourStopsWithLiveStatus([], [])).toEqual([]);
    expect(mergeTourStopsWithLiveStatus(null, null)).toEqual([]);
  });
});

describe("buildTourReportHtml", () => {
  const stops = [
    { order: 1, name: "Chez Awa", quartier: "Plateau", tel: "0700000001", status: "VERT (Joignable)", visited: true, updatedAt: "2026-08-24T09:00:00.000Z" },
    { order: 2, name: "Kiosque Bamba", quartier: "Adjamé", tel: "0700000002", status: "NON DEFINI", visited: false, updatedAt: null }
  ];

  it("inclut le résumé (total / visités / couverture)", () => {
    const html = buildTourReportHtml(stops, { agentName: "Jean K." });
    expect(html).toContain(">2<"); // total arrêts
    expect(html).toContain(">1<"); // visités
    expect(html).toContain(">50%<"); // couverture
  });

  it("échappe le contenu utilisateur (protection XSS)", () => {
    const malicious = [{ order: 1, name: '<script>alert(1)</script>', quartier: "", tel: "", status: "", visited: false, updatedAt: null }];
    const html = buildTourReportHtml(malicious, {});
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("distingue visuellement visité / non visité", () => {
    const html = buildTourReportHtml(stops, {});
    expect(html).toContain('class="ok"');
    expect(html).toContain('class="pending"');
  });

  it("gère une tournée sans arrêt sans planter (0 total, pas de division par zéro)", () => {
    const html = buildTourReportHtml([], {});
    expect(html).toContain(">0<");
    expect(html).toContain("Aucun arrêt");
  });

  it("affiche 'En cours' si la tournée n'est pas terminée (pas de endedAt)", () => {
    const html = buildTourReportHtml(stops, { startedAt: "2026-08-24T08:00:00.000Z" });
    expect(html).toContain("En cours");
  });
});
