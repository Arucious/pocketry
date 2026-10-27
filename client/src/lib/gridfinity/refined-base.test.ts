import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REFINED_MAGNETS, refinedConstructionPreset, refinedMagnetSchema } from "@shared/gridfinity/construction";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateBinSpec } from "@shared/gridfinity/validate";
import { parseProjectDoc, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { refinedMagnetCutter } from "./refined-base";
import { buildBase } from "./base";
import { buildBin, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { holeOptionsFromSpec } from "./holes";
import { extractPrintableMeshData } from "../mesh/mesh-data";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const volumeAt = (solid: ReturnType<typeof refinedMagnetCutter>, x: number, y: number, z: number) => {
  const probe = arena.track(arena.track(wasm.Manifold.cube([.02, .02, .02])).translate([x - .01, y - .01, z - .01]));
  return arena.track(solid.intersect(probe)).volume();
};

describe("refined side-entry magnets", () => {
  it("has a retained 0.4 mm skin, 2.2 mm cavity, side entry and independent extraction relief", () => {
    const cutter = refinedMagnetCutter(kernel, { ...DEFAULT_REFINED_MAGNETS, easyRelease: "off" }, 64);
    expect(cutter.boundingBox().min[2]).toBeCloseTo(.4, 6);
    expect(cutter.boundingBox().max[2]).toBeCloseTo(2.6, 6);
    expect(volumeAt(cutter, 0, 0, .2)).toBe(0);
    expect(volumeAt(cutter, 0, 0, 1)).toBeCloseTo(.000008, 8);
    expect(volumeAt(cutter, 7, 0, 1)).toBeCloseTo(.000008, 8);
    expect(volumeAt(cutter, -4, 0, .2)).toBe(0);
    const release = refinedMagnetCutter(kernel, DEFAULT_REFINED_MAGNETS, 64);
    expect(volumeAt(release, -4, 0, .2)).toBeCloseTo(.000008, 8);
    expect(volumeAt(release, 0, 0, .2)).toBe(0);
    expect(release.status()).toBe("NoError");
  });
  it.each(["right", "left"] as const)("uses four outer corners and keeps middle sockets solid, %s entry", sideAccess => {
    const spec = parseBinSpec({ gridX: 3, gridY: 2, heightUnits: 3, ...refinedConstructionPreset(),
      refinedMagnet: { ...DEFAULT_REFINED_MAGNETS, sideAccess, easyRelease: "off" } });
    const base = buildBase(kernel, spec, 64, holeOptionsFromSpec(spec));
    for (const [sx, sy] of [[1,1],[-1,1],[-1,-1],[1,-1]]) {
      const x = 55 * sx, y = 34 * sy;
      expect(volumeAt(base, x, y, .2)).toBeCloseTo(.000008, 8);
      expect(volumeAt(base, x, y, 1)).toBe(0);
      const angle = (sx === 1 ? sy === 1 ? 90 : 0 : sy === 1 ? 180 : 270) - (sideAccess === "left" ? 90 : 0);
      const dx = Math.cos(angle * Math.PI / 180), dy = Math.sin(angle * Math.PI / 180);
      expect(volumeAt(base, x + 4 * dx, y + 4 * dy, 1)).toBe(0);
    }
    expect(volumeAt(base, 13, 34, 1)).toBeCloseTo(.000008, 8);
    expect(base.decompose().map(s => arena.track(s))).toHaveLength(1);
  });
  it("supports all-cell mounting, custom convex corners and optional friction ribs", () => {
    const settings = { ...DEFAULT_REFINED_MAGNETS, cornerOnly: false, easyRelease: "off" as const, crushDepthMm: .15 };
    const grid = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, ...refinedConstructionPreset(), refinedMagnet: settings,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    const base = buildBase(kernel, grid, 64, holeOptionsFromSpec(grid));
    expect(base.status()).toBe("NoError");
    expect(extractPrintableMeshData(kernel, base).indices.length).toBeGreaterThan(0);
    const plain = refinedMagnetCutter(kernel, { ...settings, crushDepthMm: 0 }, 128);
    const ribbed = refinedMagnetCutter(kernel, settings, 128);
    expect(plain.volume() - ribbed.volume()).toBeGreaterThan(1);
  });
  it("rejects unsupported pitch, conflicting bores, insufficient roof and malformed dimensions", () => {
    for (const patch of [ { gridPitch: "half" as const }, { screwHoles: true }, { magnetCrushRibs: true },
      { refinedMagnet: { ...DEFAULT_REFINED_MAGNETS, thicknessMm: 3.5, captiveHeightMm: 1.2 } } ]) {
      const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 3, ...refinedConstructionPreset(), ...patch });
      expect(validateBinSpec(spec).issues.some(i => i.severity === "error")).toBe(true);
    }
    expect(refinedMagnetSchema.safeParse({ diameterMm: NaN }).success).toBe(false);
    expect(refinedMagnetSchema.safeParse({ captiveHeightMm: 0 }).success).toBe(false);
  });
  it("migrates the preceding project without enabling new geometry, and saves explicit preferences", () => {
    const spec = parseBinSpec({ gridX: 2, gridY: 1, heightUnits: 3 });
    const legacy = parseProjectDoc({ schemaVersion: 38, shapes: [], cutouts: [], fingerHoles: [], spec });
    expect(legacy?.spec).toEqual(spec);
    const current = parseProjectDoc({ ...legacy, schemaVersion: PROJECT_SCHEMA_VERSION,
      spec: { ...spec, ...refinedConstructionPreset() } })!;
    expect(parseProjectDoc(JSON.parse(JSON.stringify(current)))).toEqual(current);
  });
});

describe("notched stacking lip", () => {
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("retains a connected printable bin and receives every native foot (%j)", quality => {
    const spec = parseBinSpec({ gridX: 2, gridY: 1, heightUnits: 3, fill: "none", ...refinedConstructionPreset() });
    const built = buildBin(kernel, spec, quality);
    const rim = 21;
    expect(built.solid.boundingBox().max[2]).toBeCloseTo(24.551471862576143, 6);
    expect(built.solid.decompose().map(s => arena.track(s))).toHaveLength(1);
    for (const x of [-21, 21]) {
      const foot = arena.track(buildBase(kernel, { gridX: 1, gridY: 1 }, quality.circularSegments).translate([x, 0, rim]));
      expect(arena.track(built.solid.intersect(foot)).volume()).toBeLessThan(1e-5);
    }
    // Cell centres have receiving relief; the grid junction retains its web.
    expect(volumeAt(built.solid, -21, 19.45, rim + 3.2)).toBe(0);
    expect(volumeAt(built.solid, 0, 19.45, rim + 3.2)).toBeCloseTo(.000008, 8);
    expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
    expect(validateBinSpec(spec).ok).toBe(true);
  });
});
