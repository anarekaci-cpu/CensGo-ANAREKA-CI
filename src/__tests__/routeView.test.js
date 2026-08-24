import { describe, expect, it } from "vitest";
import { calculateRoutePadding } from "../core/routeView.js";

describe("calculateRoutePadding", () => {
  it("réserve la hauteur réelle du panneau inférieur", () => {
    expect(calculateRoutePadding(
      { top: 0, bottom: 800 },
      { top: 620, bottom: 800 }
    )).toBe(204);
  });

  it("retourne une marge minimale sans panneau visible", () => {
    expect(calculateRoutePadding({ top: 0, bottom: 800 }, null)).toBe(24);
    expect(calculateRoutePadding({ top: 0, bottom: 800 }, { top: -100, bottom: 0 })).toBe(24);
  });
});