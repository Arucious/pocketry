import { distanceToSegment, pointInRing } from "../geometry/rings";
import { depthProfileSegments, maximumProfileDepth, profileAxisBounds } from "./depth-profile";
import { effectiveFingerHoleDepthMm, fingerHoleFootprintRing, hasFlatFingerHoleBottom,
  resolvePlacedPocketDepth, resolvePocketDepth, transformOutlinePlacement, untransformPointPlacement,
  type CutoutPlacement, type FingerHole, type TracedShape } from "./cutout";
import { hasPocketTilt } from "./pocket-orientation";
import type { BinSpec } from "./types";

/** The same conservative floor range drives preview construction and export validation.
 * Saved fixed depths are minima: following a deeper ramp never makes an access shallower. */
export function resolveFingerAccessDepth(spec: BinSpec, hole: FingerHole,
  cutouts: readonly CutoutPlacement[], shapes: ReadonlyMap<string, TracedShape>) {
  const fixedDepthMm = effectiveFingerHoleDepthMm(hole);
  const surface = resolvePocketDepth(spec, { mode: "mm", value: fixedDepthMm });
  const fixed = { minimumDepthMm: fixedDepthMm, maximumDepthMm: fixedDepthMm,
    floorZ: surface.infillTopZ - fixedDepthMm, match: null, error: null };
  if (hole.depthMode !== "nearest-profile") return fixed;
  if (!hasFlatFingerHoleBottom(hole)) return { ...fixed, error: "Following a ramp requires a flat access bottom." };
  const candidates = cutouts.flatMap(cutout => {
    const shape = shapes.get(cutout.shapeId);
    if (!shape || !cutout.depthProfile) return [];
    const outline = transformOutlinePlacement(shape.outlineMm, cutout);
    const inside = outline.some(part => pointInRing(part.outer, hole.center) && !part.holes.some(ring => pointInRing(ring, hole.center)));
    const distance = inside ? 0 : Math.min(...outline.flatMap(part => [part.outer, ...part.holes])
      .flatMap(ring => ring.map((p, i) => distanceToSegment(hole.center, p, ring[(i + 1) % ring.length]))));
    return [{ cutout, shape, distance: Math.max(0, distance - Math.max(0, cutout.clearanceMm)) }];
  }).sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0];
  if (!nearest) return { ...fixed, error: "Add a pocket depth profile before following a ramp." };
  const { cutout, shape } = nearest;
  if (hasPocketTilt(cutout) || Object.values(cutout.profileRotation ?? {}).some(value => value !== 0)) {
    return { ...fixed, error: "Ramp-following access needs an untilted pocket." };
  }
  const mouth = fingerHoleFootprintRing(hole, { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false }, 128);
  const reach = Math.max(...mouth.map(p => Math.hypot(p.x - hole.center.x, p.y - hole.center.y)));
  if (nearest.distance > reach + 1e-6) return { ...fixed, error: "Move finger access next to a profiled pocket, or use fixed depth." };
  const profile = cutout.depthProfile!;
  const bounds = profileAxisBounds(shape.outlineMm, profile.axis);
  const positions = mouth.map(p => untransformPointPlacement(p, cutout)[profile.axis] - bounds.min);
  const low = Math.min(...positions), high = Math.max(...positions);
  const segments = depthProfileSegments(profile, bounds.length);
  const depths = [segments[0].fromDepthMm, segments.at(-1)!.toDepthMm].filter((_, i) => i === 0 ? low < 0 : high > bounds.length);
  for (const s of segments) {
    const a = Math.max(low, s.fromMm), b = Math.min(high, s.toMm);
    if (b < a) continue;
    for (const at of [a, b]) depths.push(s.fromDepthMm + (s.toDepthMm - s.fromDepthMm) * (at - s.fromMm) / (s.toMm - s.fromMm));
  }
  const maximum = maximumProfileDepth(profile);
  const placed = resolvePlacedPocketDepth(spec, { mode: "mm", value: maximum }, shape, cutout);
  const profileTopZ = placed.floorZ! + maximum;
  const shift = surface.infillTopZ - profileTopZ;
  const minimumDepthMm = Math.max(fixedDepthMm, Math.min(...depths) + shift);
  const maximumDepthMm = Math.max(fixedDepthMm, Math.max(...depths) + shift);
  // Expand the swept mask far enough to cover the complete access opening.
  const otherBounds = profileAxisBounds(shape.outlineMm, profile.axis === "x" ? "y" : "x");
  const otherAxis = profile.axis === "x" ? "y" : "x";
  const localMouth = mouth.map(p => untransformPointPlacement(p, cutout));
  const extension = Math.max(0, ...localMouth.flatMap(p => [
    bounds.min - p[profile.axis], p[profile.axis] - bounds.max,
    otherBounds.min - p[otherAxis], p[otherAxis] - otherBounds.max,
  ]));
  // Reuse the ordinary owner's mask dimensions whenever they cover the access.
  // Unnecessarily different sweep widths produce near-coplanar floor slivers
  // when an inclined access cutter is unioned with its owner's cutter.
  const paddingMm = Math.max(20, (extension + 1) * Math.min(cutout.scaleX, cutout.scaleY));
  return { minimumDepthMm, maximumDepthMm, floorZ: surface.infillTopZ - maximumDepthMm,
    match: { cutout, shape, profileTopZ, paddingMm }, error: null };
}
