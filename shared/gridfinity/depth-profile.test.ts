import { describe, expect, it } from "vitest";
import { depthProfileSchema, depthProfileError, depthProfileSegments, profileDepthAt } from "./depth-profile";
import { parseCutoutPlacement } from "./cutout";
import { parseProjectDoc, projectDocSchema, PROJECT_SCHEMA_VERSION } from "./project";
import { parseBinSpec } from "./types";
import { adjustPocketsForFillHeight } from "./fill-height-edit";

const outline = [{ outer: [{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }], holes: [] }];
const profile = depthProfileSchema.parse({ axis: "x", stations: [
  { atMm: 0, depthMm: 4 }, { atMm: 20, depthMm: 8, transition: "linear" },
  { atMm: 40, depthMm: 12, transition: "smooth" }, { atMm: 60, depthMm: 6 },
] });
const pocket = () => parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 },
  depth: { mode: "mm", value: 12 }, depthProfile: profile, bottomFilletMm: 0 });

describe("depth stations", () => {
  it("holds sharp plateaus and interpolates linear and smooth transitions without overshoot", () => {
    expect(profileDepthAt(profile, -5)).toBe(4);
    expect(profileDepthAt(profile, 19.999)).toBe(4);
    expect(profileDepthAt(profile, 20)).toBe(8);
    expect(profileDepthAt(profile, 30)).toBe(10);
    expect(profileDepthAt(profile, 50)).toBe(9);
    expect(profileDepthAt(profile, 100)).toBe(6);
    for (let p = 40; p < 60; p += .01) expect(profileDepthAt(profile, p)).toBeGreaterThanOrEqual(6);
  });
  it("keeps the sampled smooth floor within 0.01 mm of the defined curve", () => {
    for (const segment of depthProfileSegments(profile, 60)) {
      for (const t of [.25, .5, .75]) {
        const x = segment.fromMm + t * (segment.toMm - segment.fromMm);
        const approximation = segment.fromDepthMm + t * (segment.toDepthMm - segment.fromDepthMm);
        expect(Math.abs(profileDepthAt(profile, x) - approximation)).toBeLessThanOrEqual(.010001);
      }
    }
  });
  it.each([
    { axis: "z", stations: profile.stations },
    { axis: "x", stations: [profile.stations[0]] },
    { axis: "x", stations: [{ atMm: 1, depthMm: 4 }, { atMm: 10, depthMm: 5 }] },
    { axis: "x", stations: [{ atMm: 0, depthMm: 4 }, { atMm: 0, depthMm: 5 }] },
    { axis: "x", stations: [{ atMm: 0, depthMm: 4 }, { atMm: 10, depthMm: -2 }] },
    { axis: "x", stations: [{ atMm: 0, depthMm: 4, transition: "spline" }, { atMm: 10, depthMm: 5 }] },
  ])("rejects malformed profiles: %j", input => expect(depthProfileSchema.safeParse(input).success).toBe(false));
  it("rejects stations past an edited outline instead of silently moving them", () => {
    expect(depthProfileError(profile, outline)).toBeNull();
    expect(depthProfileError({ ...profile, axis: "y" }, outline)).toContain("20.00 mm");
    expect(() => parseCutoutPlacement({ ...pocket(), split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [pocket().depth, pocket().depth] } })).toThrow("Choose either");
  });
  it("round-trips new profiles and loads schema-36 projects with their old splits intact", () => {
    const doc = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [], cutouts: [pocket()],
      spec: parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 5 }), fingerHoles: [] });
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))?.cutouts[0].depthProfile).toEqual(profile);
    const old = { ...doc, schemaVersion: 36, cutouts: [{ ...pocket(), depthProfile: undefined,
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 4 }, { mode: "mm", value: 8 }] } }] };
    expect(parseProjectDoc(old)?.cutouts[0].split).toEqual(old.cutouts[0].split);
  });
  it("adjusts every station with fill height and restores the original on reversal", () => {
    const before = parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 5 }), after = { ...before, fillHeightPercent: 90 };
    const moved = adjustPocketsForFillHeight([pocket()], before, after).cutouts![0];
    const deltas = moved.depthProfile!.stations.map((s, i) => s.depthMm - profile.stations[i].depthMm);
    deltas.forEach(delta => expect(delta).toBeCloseTo(deltas[0], 8));
    expect(adjustPocketsForFillHeight([moved], after, after, false).cutouts![0].depthProfile).toEqual(profile);
  });
});
