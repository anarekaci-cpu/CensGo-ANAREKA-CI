import { describe, expect, it } from "vitest";
import { shouldAcceptGpsFix, smoothGpsPosition } from "../core/positionSmoothing.js";

describe("positionSmoothing", () => {
  it("ignore un fix nettement moins précis que le précédent", () => {
    expect(shouldAcceptGpsFix({ accuracy: 120 }, { accuracy: 30 })).toBe(false);
    expect(shouldAcceptGpsFix({ accuracy: 75 }, { accuracy: 30 })).toBe(true);
  });

  it("applique une moyenne exponentielle sans modifier le reste du fix", () => {
    const result = smoothGpsPosition(
      { lat: 5, lng: -4, accuracy: 10 },
      { lat: 6, lng: -3, accuracy: 20, heading: 90 },
      0.25
    );
    expect(result).toMatchObject({ lat: 5.25, lng: -3.75, accuracy: 20, heading: 90 });
  });

  it("accepte le premier fix sans position précédente", () => {
    expect(smoothGpsPosition(null, { lat: 5, lng: -4, accuracy: 10 })).toEqual({ lat: 5, lng: -4, accuracy: 10 });
  });
});