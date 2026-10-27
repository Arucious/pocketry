// SPDX-License-Identifier: GPL-3.0-only
// Adapted from Gridfinity Extended by ostat, revision 94d5a3e2d39e0b90894c042a255fc487cfcc9197.
// See NOTICE and licenses/GridfinityExtended-GPL-3.0.txt. Native Manifold port:
// side-entry magnets, removal relief and per-cell receiving cavities. Pocketry's
// existing foot profile and lip height are retained; this is not an Extended mesh.
import type { Manifold } from "manifold-3d";
import { DEFAULT_REFINED_MAGNETS, REFINED_MAGNET_HEIGHT_ALLOWANCE_MM, type RefinedMagnetSettings } from "@shared/gridfinity/construction";
import { cellCenterMm, occupiedCells } from "@shared/gridfinity/footprint";
import { binHeightMm, binTotalHeightMm, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, STACKING_LIP_DEPTH } from "@shared/gridfinity/standard";
import type { Kernel } from "../manifold/runtime";
import type { GridSize } from "./base";
import type { WallSpec } from "./wall";
import { footprintOuterSection } from "./footprint-section";
import { roundedRectPolygon } from "./profiles";

/** Eight smooth friction contacts, retaining the requested outer diameter. */
function boreRing(radius: number, crush: number, segments: number): [number, number][] {
  const count = 8 * Math.max(8, Math.ceil(segments / 8));
  return Array.from({ length: count }, (_, i) => {
    const theta = i * 2 * Math.PI / count;
    const r = radius - crush / 2 + crush / 2 * Math.sin(8 * theta);
    return [r * Math.cos(theta), r * Math.sin(theta)];
  });
}

/** Local +X side entry and -X extraction access. The skin remains under the
 * magnet; easy release opens only a small tool-access strip beside it. */
export function refinedMagnetCutter(kernel: Kernel, settings: RefinedMagnetSettings = DEFAULT_REFINED_MAGNETS,
  segments = 64): Manifold {
  const { arena, Manifold, CrossSection } = kernel;
  const radius = settings.diameterMm / 2;
  const cavityHeight = settings.thicknessMm + REFINED_MAGNET_HEIGHT_ALLOWANCE_MM;
  const top = settings.captiveHeightMm + cavityHeight;
  const section = arena.track(new CrossSection([boreRing(radius, settings.crushDepthMm, segments)]));
  const bore = arena.track(arena.track(section.extrude(cavityHeight)).translate([0, 0, settings.captiveHeightMm]));
  const entry = arena.track(arena.track(Manifold.cube([8, settings.diameterMm, cavityHeight]))
    .translate([0, -radius, settings.captiveHeightMm]));
  const pieces = [bore, entry];
  if (settings.easyRelease === "auto") {
    // Two-millimetre removal slot, rounded in plan; its roof slopes down at
    // the outer end instead of leaving an unsupported horizontal recess.
    const end = radius + 2.5;
    const start = radius * .4;
    const rectangle = arena.track(arena.track(CrossSection.square([radius + 1.5 - start, 2])).translate([start, -1]));
    const cap = arena.track(arena.track(CrossSection.circle(1, segments)).translate([radius + 1.5, 0]));
    const releaseSection = arena.track(rectangle.add(cap));
    let relief = arena.track(arena.track(releaseSection.extrude(top + .01)).translate([0, 0, -.01]));
    const slope = top / 2.5, norm = Math.hypot(slope, 1);
    relief = arena.track(relief.trimByPlane([-slope / norm, 0, -1 / norm], -slope * end / norm));
    pieces.push(arena.track(relief.rotate([0, 0, 180])));
  }
  return arena.track(Manifold.union(pieces));
}

/** Corner-only means exposed convex corners, including connected custom masks.
 * Each entry points toward an exposed side of its own socket. */
export function refinedMagnetCutters(kernel: Kernel, grid: GridSize,
  settings: RefinedMagnetSettings, segments: number): Manifold | null {
  if (grid.gridPitch && grid.gridPitch !== "full") return null;
  const { arena, Manifold } = kernel;
  const cells = occupiedCells(grid), occupied = new Set(cells.map(c => `${c.x},${c.y}`));
  const cluster = refinedMagnetCutter(kernel, settings, segments), pieces: Manifold[] = [];
  for (const cell of cells) {
    const center = cellCenterMm(grid, cell);
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      if (settings.cornerOnly && (occupied.has(`${cell.x + sx},${cell.y}`) || occupied.has(`${cell.x},${cell.y + sy}`))) continue;
      const rightAngle = sx === 1 ? sy === 1 ? 90 : 0 : sy === 1 ? 180 : 270;
      const angle = rightAngle - (settings.sideAccess === "left" ? 90 : 0);
      pieces.push(arena.track(arena.track(cluster.rotate([0, 0, angle]))
        .translate([center.x + 13 * sx, center.y + 13 * sy, 0])));
    }
  }
  return pieces.length ? arena.track(Manifold.union(pieces)) : null;
}

/** Replace the upper continuous rim with cell-by-cell receiving relief.
 * Like Extended's frame_cavity/pad_oversize, rounded cell corners leave webs
 * at grid boundaries. Native lower support and all standard foot dimensions
 * are preserved; the upper female taper has at least 0.25 mm radial clearance. */
export function notchedStackingLip(kernel: Kernel, spec: WallSpec, ordinary: Manifold, segments: number): Manifold {
  const { arena, Manifold } = kernel;
  const rim = binHeightMm(spec.heightUnits), top = binTotalHeightMm(spec.heightUnits, true);
  const start = rim + 2.5;
  const outer = footprintOuterSection(kernel, spec, segments);
  const inset = STACKING_LIP_DEPTH - .7;
  const inner = arena.track(outer.offset(-inset, "Round", 2, segments));
  const band = arena.track(outer.subtract(inner));
  const upper = arena.track(arena.track(band.extrude(top - start + .01)).translate([0, 0, start - .01]));
  const receiving: Manifold[] = [];
  const r0 = BASE_TOP_RADIUS - (BASE_PROFILE_HEIGHT - 2.6) + .25 - .01;
  const height = top - start + .51;
  const rings = [roundedRectPolygon(34 + 2 * r0, 34 + 2 * r0, r0, segments),
    roundedRectPolygon(34 + 2 * (r0 + height), 34 + 2 * (r0 + height), r0 + height, segments)];
  const cavity = arena.track(Manifold.hull(rings.flatMap((ring, i) => ring.map(([x, y]) => [x, y, start - .01 + i * height] as [number, number, number]))));
  for (const cell of occupiedCells(spec)) {
    const center = cellCenterMm(spec, cell);
    receiving.push(arena.track(cavity.translate([center.x, center.y, 0])));
  }
  const lower = arena.track(ordinary.trimByPlane([0, 0, -1], -start));
  const cutUpper = arena.track(upper.subtract(arena.track(Manifold.union(receiving))));
  return arena.track(lower.add(cutUpper));
}
