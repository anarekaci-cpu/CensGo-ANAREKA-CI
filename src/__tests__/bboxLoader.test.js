import { describe, it, expect } from "vitest";
import { bboxRpcArgs, boundsChangedEnough } from "../core/bboxLoader.js";

const B = (west, south, east, north) => ({ west, south, east, north });

describe("bboxRpcArgs", () => {
  it("traduit une emprise en arguments min/max ordonnés", () => {
    expect(bboxRpcArgs(B(-4.1, 5.2, -3.9, 5.4), { maxRows: 500 })).toEqual({
      min_lon: -4.1, min_lat: 5.2, max_lon: -3.9, max_lat: 5.4, max_rows: 500
    });
  });

  it("réordonne si west/east ou south/north sont inversés", () => {
    const a = bboxRpcArgs(B(-3.9, 5.4, -4.1, 5.2));
    expect(a.min_lon).toBe(-4.1);
    expect(a.max_lon).toBe(-3.9);
    expect(a.min_lat).toBe(5.2);
    expect(a.max_lat).toBe(5.4);
  });

  it("emprise invalide -> null", () => {
    expect(bboxRpcArgs(null)).toBeNull();
    expect(bboxRpcArgs(B(NaN, 5, -3, 6))).toBeNull();
    expect(bboxRpcArgs({ west: 1, south: 2 })).toBeNull();
  });

  it("maxRows par défaut = 2000, jamais < 1, entier", () => {
    expect(bboxRpcArgs(B(-1, -1, 1, 1)).max_rows).toBe(2000);
    expect(bboxRpcArgs(B(-1, -1, 1, 1), { maxRows: 0 }).max_rows).toBe(1);
    expect(bboxRpcArgs(B(-1, -1, 1, 1), { maxRows: 123.9 }).max_rows).toBe(123);
  });
});

describe("boundsChangedEnough", () => {
  const view = B(-4.00, 5.30, -3.90, 5.40); // 0.1° x 0.1°

  it("premier appel (prev absent) -> true", () => {
    expect(boundsChangedEnough(null, view)).toBe(true);
  });

  it("emprise courante invalide -> false", () => {
    expect(boundsChangedEnough(view, null)).toBe(false);
    expect(boundsChangedEnough(view, B(1, 2, NaN, 4))).toBe(false);
  });

  it("micro-pan (centre déplacé de ~10% de la diagonale) -> false", () => {
    const tiny = B(-3.995, 5.305, -3.895, 5.405); // +0.005° ~ 5% par axe
    expect(boundsChangedEnough(view, tiny)).toBe(false);
  });

  it("pan franc (centre déplacé d'une demi-largeur) -> true", () => {
    const moved = B(-3.95, 5.30, -3.85, 5.40); // +0.05° en lon = 50% de la largeur
    expect(boundsChangedEnough(view, moved)).toBe(true);
  });

  it("dézoom important (surface x4) -> true même sans déplacement du centre", () => {
    const zoomedOut = B(-4.05, 5.25, -3.85, 5.45); // 0.2° x 0.2° = surface x4, même centre
    expect(boundsChangedEnough(view, zoomedOut)).toBe(true);
  });
});
