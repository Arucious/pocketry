import type { Manifold } from "manifold-3d";
import { depthProfileError, depthProfileSegments, profileAxisBounds } from "@shared/gridfinity/depth-profile";
import type { CutoutPlacement, TracedShape } from "@shared/gridfinity/cutout";
import { signedArea } from "@shared/geometry/rings";
import type { Kernel } from "../manifold/runtime";

/** A floor graph swept across the whole outline. Intersecting the existing
 * silhouette cutter preserves concavities, holes, offsets and one continuous
 * opening. Sharp transitions are vertical faces; ramps are actual geometry. */
export function depthProfileMask(kernel: Kernel, shape: TracedShape, cutout: CutoutPlacement,
  topZ: number, ceilingZ: number, floorShiftMm = 0, paddingMm = 20): Manifold {
  const profile = cutout.depthProfile!;
  const error = depthProfileError(profile, shape.outlineMm);
  if (error) throw new Error(error);
  const { min, length } = profileAxisBounds(shape.outlineMm, profile.axis);
  const segments = depthProfileSegments(profile, length);
  const pad = paddingMm / Math.min(cutout.scaleX, cutout.scaleY);
  const points = [{ x: min - pad, y: topZ - segments[0].fromDepthMm + floorShiftMm }];
  for (const segment of segments) {
    points.push({ x: min + segment.fromMm, y: topZ - segment.fromDepthMm + floorShiftMm },
      { x: min + segment.toMm, y: topZ - segment.toDepthMm + floorShiftMm });
  }
  const lastFloor = topZ - profile.stations.at(-1)!.depthMm + floorShiftMm;
  points.push({ x: min + length, y: lastFloor }, { x: min + length + pad, y: lastFloor },
    { x: min + length + pad, y: ceilingZ }, { x: min - pad, y: ceilingZ });
  const cleaned = points.filter((p, i) => !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-9);
  if (signedArea(cleaned) < 0) cleaned.reverse();
  const { arena } = kernel;
  const section = arena.track(new kernel.CrossSection([cleaned.map(p => [p.x, p.y] as [number, number])]));
  const other = profileAxisBounds(shape.outlineMm, profile.axis === "x" ? "y" : "x");
  const width = other.length + pad * 2;
  let mask = arena.track(section.extrude(width));
  mask = arena.track(mask.rotate([90, 0, 0]));
  mask = arena.track(mask.translate([0, other.max + pad, 0]));
  if (profile.axis === "y") {
    // XZ graph becomes YZ; the swept coordinate changes sign once more.
    mask = arena.track(mask.rotate([0, 0, 90]));
    mask = arena.track(mask.translate([other.min + other.max, 0, 0]));
  }
  mask = arena.track(mask.scale([cutout.scaleX * (cutout.mirrored ? -1 : 1), cutout.scaleY, 1]));
  mask = arena.track(mask.rotate([0, 0, cutout.rotationDeg]));
  return arena.track(mask.translate([cutout.position.x, cutout.position.y, 0]));
}
