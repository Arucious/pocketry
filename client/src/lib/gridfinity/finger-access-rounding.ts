import type { Manifold } from "manifold-3d";
import {
  elongatedFingerHoleEndpoints,
  fingerHoleFootprintRing,
  effectiveFingerHoleDepthMm,
  effectiveFingerHoleCornerRoundMm,
  capsuleRing,
  roundedRectangleRing,
  flatEndedScoopRadiusMm,
  hasFlatFingerHoleBottom,
  hasFlatFingerHoleEnds,
  isElongatedFingerHole,
  type FingerHole,
} from "@shared/gridfinity/cutout";
import type { Kernel } from "@/lib/manifold/runtime";
import type { FilletOptions } from "./fillet-stack";

/** Continuous 45-degree entry bevel. The fixed ring topology preserves round
 * and slot mouths without the horizontal ledges of an offset-layer stack. */
export function buildChamferedFingerAccessCutter(kernel: Kernel, hole: FingerHole,
  topZ: number, cutterTopZ: number, width: number, segments: number): Manifold {
  const { arena, CrossSection } = kernel;
  const ring = fingerHoleFootprintRing(hole, { position: { x: 0, y: 0 }, rotationDeg: 0, mirrored: false }, segments);
  const section = arena.track(new CrossSection([ring.map(p => [p.x, p.y] as [number, number])]));
  // Offset once, then map each outer vertex to its nearest point on the mouth.
  const expanded = arena.track(section.offset(width, "Round", 2, segments));
  const prism = arena.track(expanded.extrude(2, 1));
  return arena.track(prism.warp(v => {
    let qx = v[0], qy = v[1], best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((v[0] - a.x) * dx + (v[1] - a.y) * dy) / (dx * dx + dy * dy)));
      const x = a.x + t * dx, y = a.y + t * dy, d = (x - v[0]) ** 2 + (y - v[1]) ** 2;
      if (d < best) { best = d; qx = x; qy = y; }
    }
    const level = Math.round(v[2]);
    if (level === 0) { v[0] = qx; v[1] = qy; }
    v[2] = level === 0 ? topZ - width : level === 1 ? topZ : cutterTopZ;
  }));
}

/** Exact transverse circle/fillet tangency, measured from the bin's top (z=0). */
export function fingerAccessRimGeometry(
  hole: FingerHole,
  rimRadius: number,
) {
  const depth = effectiveFingerHoleDepthMm(hole);
  const radius = flatEndedScoopRadiusMm({ ...hole, depthMm: depth });
  const centerZ = radius - depth;
  // A shaft at least as tall as the rim radius takes an ordinary quarter circle.
  const verticalJoin = hasFlatFingerHoleBottom(hole) || centerZ <= -rimRadius;
  // The fillet centre is (openingHalfWidth, -rimRadius). External tangency
  // requires its distance from the cylinder centre to equal radius + rimRadius.
  const openingHalfWidth = verticalJoin
    ? hole.diameterMm / 2 + rimRadius
    : Math.sqrt((radius + rimRadius) ** 2 - (centerZ + rimRadius) ** 2);
  const tangentZ = verticalJoin
    ? -rimRadius
    : -rimRadius * depth / (radius + rimRadius);
  const tangentHalfWidth = verticalJoin
    ? hole.diameterMm / 2
    : openingHalfWidth * radius / (radius + rimRadius);
  return { depth, radius, centerZ, rimRadius, openingHalfWidth, tangentZ, tangentHalfWidth, verticalJoin };
}

type RimGeometry = ReturnType<typeof fingerAccessRimGeometry>;

/** Half-width of the rounded cutter at a horizontal plane. */
export function fingerAccessHalfWidthAtZ(
  hole: FingerHole,
  rim: RimGeometry,
  z: number,
): number {
  if (z >= 0) return rim.openingHalfWidth;
  if (z >= rim.tangentZ) {
    return rim.openingHalfWidth - Math.sqrt(Math.max(0, rim.rimRadius ** 2 - (z + rim.rimRadius) ** 2));
  }
  if (hasFlatFingerHoleBottom(hole) || z >= rim.centerZ) return hole.diameterMm / 2;
  const height = Math.max(0, z + rim.depth);
  return Math.sqrt(Math.max(0, height * (2 * rim.radius - height)));
}

/**
 * Curved styles use a whole cutter with tangent circular profiles (a zero rim
 * radius also supports unrounded shallow round and oblong cuts). Round holes
 * use circular rings, oblongs sweep them along the capsule spine, and flat-ended
 * scoops retain planar ends with quarter-circle end rounding. Straight holes
 * return only the top flare to preserve their separately built bottom fillet.
 */
export function buildRoundedFingerAccessCutter(
  kernel: Kernel,
  hole: FingerHole,
  topZ: number,
  cutterTopZ: number,
  options: FilletOptions,
): Manifold {
  const { arena, CrossSection } = kernel;
  const r = options.radiusMm;
  const rim = fingerAccessRimGeometry(hole, r);
  const flatEnded = hasFlatFingerHoleEnds(hole);
  const oblong = isElongatedFingerHole(hole) && !flatEnded;
  const straight = hasFlatFingerHoleBottom(hole);
  const { lengthMm } = elongatedFingerHoleEndpoints(hole);
  const halfSpan = oblong ? (lengthMm - hole.diameterMm) / 2 : 0;
  const halfWidth = hole.diameterMm / 2;
  const corner = effectiveFingerHoleCornerRoundMm(hole);
  const steps = Math.max(
    12,
    Math.ceil(options.circularSegments / 2),
    Math.ceil(Math.PI * r / (2 * options.profileStepMm)),
  );
  const heights = [straight ? -r : -rim.depth, rim.tangentZ, -r, 0, cutterTopZ - topZ];
  const bottomAngle = rim.verticalJoin ? Math.PI / 2 : Math.asin(rim.tangentHalfWidth / rim.radius);
  const rimAngle = r === 0 ? 0 : Math.acos(Math.max(0, Math.min(1, (rim.tangentZ + r) / r)));
  for (let i = 0; i <= steps; i++) {
    // Sample the cylinder and both fillets by angle, including their tangent joins.
    if (!straight) heights.push(-rim.depth + 2 * rim.radius * Math.sin(bottomAngle * i / (2 * steps)) ** 2);
    heights.push(-r + r * Math.cos(rimAngle * i / steps));
    heights.push(-r + r * Math.sin(Math.PI * i / (2 * steps)));
  }
  const levels = heights
    .sort((a, b) => a - b)
    .filter((z, i, all) => i === 0 || z - all[i - 1] > 1e-9);
  const template = flatEnded
    ? corner > 0
      ? arena.track(new CrossSection([roundedRectangleRing(lengthMm + 2 * r, hole.diameterMm + 2 * r,
          corner + r, options.circularSegments).map(({ x, y }) => [x, y] as [number, number])]))
      : arena.track(arena.track(CrossSection.square([lengthMm, hole.diameterMm], true))
          .offset(r, "Round", 2, options.circularSegments))
    : oblong
      ? arena.track(new CrossSection([capsuleRing(
          { x: -halfSpan, y: 0 }, { x: halfSpan, y: 0 }, halfWidth,
          options.circularSegments,
        ).map(({ x, y }) => [x, y] as [number, number])]))
      : arena.track(CrossSection.circle(halfWidth, options.circularSegments));
  // The source prism supplies a connected, consistently wound mesh for each ring.
  const prism = arena.track(template.extrude(levels.length - 1, levels.length - 2));
  let cutter = arena.track(prism.warp((vertex) => {
    const z = levels[Math.max(0, Math.min(levels.length - 1, Math.round(vertex[2])))];
    const width = fingerAccessHalfWidthAtZ(hole, rim, z);
    if (flatEnded) {
      const endOutset = z <= -r
        ? 0
        : z >= 0 ? r : r - Math.sqrt(Math.max(0, r * r - (z + r) ** 2));
      const baseX = Math.max(-lengthMm / 2 + corner, Math.min(lengthMm / 2 - corner, vertex[0]));
      const baseY = Math.max(-halfWidth + corner, Math.min(halfWidth - corner, vertex[1]));
      // Keep the planar ends and scale corner arcs with the narrowing trough.
      // At a straight wall this is a circular corner plus the outward rim round.
      const nx = (vertex[0] - baseX) / (corner + r);
      const ny = (vertex[1] - baseY) / (corner + r);
      vertex[0] = baseX + nx * (corner + endOutset);
      vertex[1] = (baseY + ny * corner) / halfWidth * (width - endOutset) + ny * endOutset;
    } else {
      const baseX = Math.max(-halfSpan, Math.min(halfSpan, vertex[0]));
      vertex[0] = baseX + (vertex[0] - baseX) * width / halfWidth;
      vertex[1] *= width / halfWidth;
    }
    vertex[2] = z;
  }));
  // Round/straight mouths ignore retained rotation, matching their shaft polygons.
  if (flatEnded || oblong) cutter = arena.track(cutter.rotate([0, 0, hole.rotationDeg ?? 0]));
  return arena.track(cutter.translate([hole.center.x, hole.center.y, topZ]));
}
