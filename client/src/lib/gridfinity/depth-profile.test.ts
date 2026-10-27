import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCutoutPlacement, resolvePocketDepth, transformPointPlacement, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { depthProfileSchema, profileDepthAt } from "@shared/gridfinity/depth-profile";
import { parseBinSpec } from "@shared/gridfinity/types";
import { rigidPocket, pocketSourceCells } from "@shared/gridfinity/rigid-pocket";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { buildBin, buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { extractPrintableMeshData } from "../mesh/mesh-data";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "s", name: "Tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -30, minY: -10, maxX: 30, maxY: 10 },
  outlineMm: [{ outer: [{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }], holes: [] }] };
const profile = depthProfileSchema.parse({ axis: "x", stations: [
  { atMm: 0, depthMm: 4 }, { atMm: 20, depthMm: 8, transition: "linear" },
  { atMm: 40, depthMm: 12, transition: "smooth" }, { atMm: 60, depthMm: 6 },
] });
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 5, flatBottom: true });
const pocket = (extra: Partial<CutoutPlacement> = {}) => parseCutoutPlacement({ id: "p", shapeId: shape.id,
  position: { x: 0, y: 0 }, depth: { mode: "mm", value: 12 }, depthProfile: profile,
  cornerRoundMm: 0, bottomFilletMm: 0, topFilletMm: 0, ...extra });
const layout = (c: CutoutPlacement, s = shape) => ({ cutouts: [c], fingerHoles: [], shapesById: new Map([[s.id, s]]) });

describe("multi-depth pocket solids", () => {
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("cuts the analytical stepped/ramped volume at quality %j", quality => {
    const base = buildBin(kernel, spec, quality).solid;
    const built = buildBinWithCutouts(kernel, spec, layout(pocket()), quality);
    // Three 20 mm bands, 20 mm wide: 4, average(8,12), average(12,6).
    expect(base.volume() - built.solid.volume()).toBeCloseTo(20 * 20 * (4 + 10 + 9), 4);
    expect(built.solid.status()).toBe("NoError");
    expect(built.solid.decompose().map(s => arena.track(s))).toHaveLength(1);
    expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
  });
  it.each([false, true])("preserves source positions after rotation/nonuniform scale, mirrored=%s", mirrored => {
    const c = pocket({ rotationDeg: 31, scaleX: 1.2, scaleY: .7, mirrored });
    const built = buildBinWithCutouts(kernel, spec, layout(c), EXPORT_QUALITY);
    const top = resolvePocketDepth(spec, c.depth).infillTopZ;
    for (const distance of [10, 25, 35, 45, 55]) {
      const point = transformPointPlacement({ x: distance - 30, y: 0 }, c);
      const floor = top - profileDepthAt(profile, distance);
      for (const offset of [-.1, .1]) {
        const probe = arena.track(arena.track(wasm.Manifold.cube([.02, .02, .02])).translate([point.x - .01, point.y - .01, floor + offset - .01]));
        expect(arena.track(built.solid.intersect(probe)).volume()).toBeCloseTo(offset < 0 ? .000008 : 0, 9);
      }
    }
  });
  it("supports a Y profile and retains holes in the original silhouette", () => {
    const tool = { ...shape, outlineMm: [{ ...shape.outlineMm[0], holes: [[{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: -2 }]] }] };
    const c = pocket({ depthProfile: { axis: "y", stations: [{ atMm: 0, depthMm: 6, transition: "linear" }, { atMm: 20, depthMm: 10, transition: "step" }] } });
    const base = buildBin(kernel, spec, PREVIEW_QUALITY).solid;
    const built = buildBinWithCutouts(kernel, spec, layout(c, tool), PREVIEW_QUALITY);
    expect(base.volume() - built.solid.volume()).toBeCloseTo((1200 - 16) * 8, 4);
  });
  it("produces matching finite solids after rigid conversion and nonoverlapping floor colors", () => {
    const c = pocket(), rigid = rigidPocket(c, shape, spec);
    const legacy = buildBinWithCutouts(kernel, spec, layout(c), EXPORT_QUALITY);
    const built = buildBinWithCutouts(kernel, spec, layout(rigid), EXPORT_QUALITY, { floorInsertThicknessMm: .6 });
    expect(arena.track(legacy.solid.subtract(built.solid)).volume()).toBeLessThan(1e-4);
    expect(arena.track(built.solid.subtract(legacy.solid)).volume()).toBeLessThan(1e-4);
    const parts = built.materialParts!;
    expect(parts.pocketFloors).not.toBeNull();
    expect(arena.track(parts.body.intersect(parts.pocketFloors!)).volume()).toBeLessThan(1e-5);
    const cells = pocketSourceCells(shape.outlineMm, rigid);
    expect(Math.min(...cells.flatMap(c => c.vertices.map(v => v.z)))).toBe(-12);
  });
  it("keeps a printable colored profile under tilt, mirroring, clearance and vertical insertion", () => {
    const c = { ...rigidPocket(pocket(), shape, spec), elevationMm: 7, tilt: { xDeg: 12, yDeg: -15 },
      mirrored: true, rotationDeg: 25, insertionMode: "vertical" as const, clearanceMm: .3, topFilletMm: .6 };
    const built = buildBinWithCutouts(kernel, spec, layout(c), EXPORT_QUALITY, { floorInsertThicknessMm: .5 });
    expect(built.solid.status()).toBe("NoError");
    expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
    expect(built.validationIssues.filter(i => i.severity === "error")).toEqual([]);
  });
});
