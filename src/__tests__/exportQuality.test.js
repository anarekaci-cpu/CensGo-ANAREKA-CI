import { describe, expect, it } from "vitest";
import { auditExportQuality } from "../core/exportQuality.js";

describe("auditExportQuality", () => {
  it("compte les champs essentiels incomplets et les doublons GPS", () => {
    const points = [
      { name: "A", tel: "0102030405", activityType: "Restaurant", lat: 5.36, lon: -3.97 },
      { name: "", tel: "", activityType: "", lat: 5.3601, lon: -3.9701 },
      { name: "C", tel: "0102030406", activityType: "Kiosque", lat: 5.4, lon: -3.99 }
    ];
    expect(auditExportQuality(points, 2)).toEqual({ incompleteCount: 1, pendingCount: 2, duplicateCount: 1 });
  });
});