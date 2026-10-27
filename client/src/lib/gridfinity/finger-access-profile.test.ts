import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fingerHoleSchema, parseCutoutPlacement, resolvePocketDepth, transformPointPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { profileDepthAt } from "@shared/gridfinity/depth-profile";
import { resolveFingerAccessDepth } from "@shared/gridfinity/finger-access-depth";
import { parseBinSpec } from "@shared/gridfinity/types";
import { validateLayout } from "@shared/gridfinity/validate";
import { parseProjectDoc, projectDocSchema, PROJECT_SCHEMA_VERSION } from "@shared/gridfinity/project";
import { Arena } from "@/lib/manifold/arena";
import { createKernel, loadManifold, type Kernel, type ManifoldToplevel } from "@/lib/manifold/runtime";
import { buildFingerHoleCutters } from "./cutouts";
import { buildBinWithCutouts, EXPORT_QUALITY, PREVIEW_QUALITY } from "./bin";
import { extractPrintableMeshData } from "../mesh/mesh-data";

let wasm: ManifoldToplevel, arena: Arena, kernel: Kernel;
beforeAll(async () => { wasm = await loadManifold(); });
beforeEach(() => { arena = new Arena(); kernel = createKernel(wasm, arena); });
afterEach(() => arena.dispose());
const shape: TracedShape = { id: "s", name: "Tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -30, minY: -5, maxX: 30, maxY: 5 },
  outlineMm: [{ outer: [{ x: -30, y: -5 }, { x: 30, y: -5 }, { x: 30, y: 5 }, { x: -30, y: 5 }], holes: [] }] };
const spec = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 5 });
const pocket = parseCutoutPlacement({ id: "p", shapeId: "s", position: { x: 0, y: 0 },
  depth: { mode: "mm", value: 12 }, bottomFilletMm: 0, topFilletMm: 0, clearanceMm: 0,
  depthProfile: { axis: "x", stations: [{ atMm: 0, depthMm: 12, transition: "smooth" }, { atMm: 60, depthMm: 4 }] } });
const hole = fingerHoleSchema.parse({ id: "h", center: { x: 0, y: 9 }, diameterMm: 20,
  depthMm: 1, depthMode: "nearest-profile", topChamferMm: .5 });
const layout = { cutouts: [pocket], shapesById: new Map([[shape.id, shape]]), fingerHoles: [hole] };

describe("ramp-following finger access", () => {
  it.each([PREVIEW_QUALITY, EXPORT_QUALITY])("matches the ramp at every position, without a floor ledge (%j)", quality => {
    const built = buildBinWithCutouts(kernel, spec, layout, quality);
    const top = resolvePocketDepth(spec, pocket.depth).infillTopZ;
    for (const x of [-7, 0, 7]) {
      const floor = top - profileDepthAt(pocket.depthProfile!, x + 30);
      for (const offset of [-.04, .04]) {
        const probe = arena.track(arena.track(wasm.Manifold.cube([.01, .01, .01]))
          .translate([x - .005, 9 - .005, floor + offset - .005]));
        expect(arena.track(built.solid.intersect(probe)).volume()).toBeCloseTo(offset < 0 ? 1e-6 : 0, 9);
      }
    }
    expect(built.solid.status()).toBe("NoError");
    expect(extractPrintableMeshData(kernel, built.solid).indices.length).toBeGreaterThan(0);
    expect(built.validationIssues.filter(i => i.severity === "error")).toEqual([]);
  });
  it("resolves local range after mirroring, scale, rotation, elevation and offset", () => {
    const c = { ...pocket, mirrored: true, scaleX: 1.2, scaleY: .8, rotationDeg: 37, elevationMm: 15 };
    const center = transformPointPlacement({ x: 0, y: 8 }, c);
    const h = { ...hole, center };
    const result = resolveFingerAccessDepth(spec, h, [c], layout.shapesById);
    expect(result.match?.profileTopZ).toBe(27);
    expect(result.maximumDepthMm).toBeGreaterThan(result.minimumDepthMm);
    const shifted = resolveFingerAccessDepth(spec, h, [{ ...c, elevationMm: undefined, zOffsetMm: -1 }], layout.shapesById);
    expect(shifted.maximumDepthMm).toBeGreaterThan(8);
  });
  it("keeps requested depth when it is deeper and selects the closest of two profiles", () => {
    const other = { ...pocket, id: "other", position: { x: 0, y: 40 } };
    const result = resolveFingerAccessDepth(spec, { ...hole, depthMm: 15 }, [other, pocket], layout.shapesById);
    expect(result.minimumDepthMm).toBe(15);
    expect(result.maximumDepthMm).toBe(15);
    expect(result.match?.cutout.id).toBe("p");
  });
  it.each(["chamfer", "round"])("keeps overlapping rotated access printable with one %s entry surface", edge => {
    const c = { ...pocket, rotationDeg: -82.25, scaleX: .9, scaleY: 1.1 };
    const holes = [4, 10].map((y, i) => ({ ...hole, id: `overlap-${i}`,
      center: transformPointPlacement({ x: .17, y }, c),
      topChamferMm: edge === "chamfer" ? .5 : 0, topFilletMm: edge === "round" ? .5 : 0 }));
    const built = buildBinWithCutouts(kernel, spec, { ...layout, cutouts: [c], fingerHoles: holes }, EXPORT_QUALITY,
      { floorInsertThicknessMm: .6 });
    for (const part of [built.solid, built.materialParts?.body, built.materialParts?.pocketFloors]) {
      if (part && !part.isEmpty()) expect(extractPrintableMeshData(kernel, part).indices.length).toBeGreaterThan(0);
    }
  });
  it("rejects missing, distant, curved-bottom or tilted matches", () => {
    expect(resolveFingerAccessDepth(spec, hole, [], layout.shapesById).error).toMatch(/profile/);
    expect(resolveFingerAccessDepth(spec, { ...hole, center: { x: 50, y: 50 } }, [pocket], layout.shapesById).error).toMatch(/next to/);
    expect(resolveFingerAccessDepth(spec, { ...hole, kind: "deep-scoop" }, [pocket], layout.shapesById).error).toMatch(/flat/);
    expect(resolveFingerAccessDepth(spec, hole, [{ ...pocket, tilt: { xDeg: 10, yDeg: 0 } }], layout.shapesById).error).toMatch(/untilted/);
  });
  it("blocks profile cuts into a Gridfinity base or a thin flat floor", () => {
    for (const flatBottom of [true, false]) {
      const small = parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 2, flatBottom, magnetHoles: !flatBottom });
      const h = { ...hole, depthMm: flatBottom ? 12.5 : 10 };
      expect(validateLayout(small, [pocket], layout.shapesById, [h])).toContainEqual(
        expect.objectContaining({ code: "finger-hole-in-base", severity: "error", fingerHoleIds: ["h"] }));
    }
  });
  it("round-trips optional settings and migrates the preceding project version without inventing them", () => {
    const project = projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION, spec,
      shapes: [shape], cutouts: [pocket], fingerHoles: [hole] });
    expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);
    const legacy = parseProjectDoc({ ...project, schemaVersion: 37, fingerHoles: [{ ...hole, depthMode: undefined, topChamferMm: undefined }] });
    expect(legacy?.fingerHoles[0].depthMode).toBeUndefined();
    expect(legacy?.fingerHoles[0].topChamferMm).toBeUndefined();
  });
});

describe("continuous access chamfers", () => {
  it.each(["straight", "oblong-straight", "flat-ended-straight"] as const)("bevels %s at 45 degrees and preserves its floor", kind => {
    const h = fingerHoleSchema.parse({ ...hole, kind, depthMode: "fixed", depthMm: 8,
      topChamferMm: 1, lengthMm: 32, topFilletMm: 2 });
    const cutter = buildFingerHoleCutters(kernel, [h], spec, EXPORT_QUALITY)[0];
    const top = resolvePocketDepth(spec, { mode: "mm", value: 8 }).infillTopZ;
    expect(cutter.boundingBox().min[2]).toBeCloseTo(top - 8, 6);
    const width = (z: number) => {
      const bounds = arena.track(cutter.slice(z)).bounds();
      return bounds.max[1] - bounds.min[1];
    };
    expect(width(top - 1.01)).toBeCloseTo(20, 4);
    expect(width(top - .5)).toBeCloseTo(21, 2);
    expect(width(top - .01)).toBeCloseTo(21.98, 2);
    expect(cutter.status()).toBe("NoError");
  });
});
