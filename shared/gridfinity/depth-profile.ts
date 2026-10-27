import { z } from "zod";
import { outlineBounds } from "../geometry/outline";
import { signedArea } from "../geometry/rings";
import type { Outline, Point, Ring } from "../geometry/types";

/** Distances are measured from the minimum of the unscaled shape-local axis.
 * The outgoing transition describes the interval to the next station. */
export const depthStationSchema = z.object({
  atMm: z.number().finite().nonnegative(),
  depthMm: z.number().finite().min(0.1).max(280),
  transition: z.enum(["step", "linear", "smooth"]).default("step"),
}).strict();
export const depthProfileSchema = z.object({
  axis: z.enum(["x", "y"]),
  stations: z.array(depthStationSchema).min(2).max(64),
}).strict().superRefine((profile, ctx) => {
  if (profile.stations[0]?.atMm !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom,
    path: ["stations", 0, "atMm"], message: "The first depth station must start at 0 mm." });
  profile.stations.forEach((station, i) => {
    if (i && station.atMm <= profile.stations[i - 1].atMm) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ["stations", i, "atMm"], message: "Depth stations must have strictly increasing positions." });
  });
});
export type DepthProfile = z.infer<typeof depthProfileSchema>;
export interface DepthSegment { fromMm: number; toMm: number; fromDepthMm: number; toDepthMm: number }
export const maximumProfileDepth = (profile: DepthProfile): number => Math.max(...profile.stations.map(s => s.depthMm));
export const minimumProfileDepth = (profile: DepthProfile): number => Math.min(...profile.stations.map(s => s.depthMm));

export function profileAxisBounds(outline: Outline, axis: DepthProfile["axis"]): { min: number; max: number; length: number } {
  const bounds = outlineBounds(outline);
  if (!bounds) return { min: 0, max: 0, length: 0 };
  const min = axis === "x" ? bounds.minX : bounds.minY, max = axis === "x" ? bounds.maxX : bounds.maxY;
  return { min, max, length: max - min };
}
export function depthProfileError(profile: DepthProfile, outline: Outline): string | null {
  const { length } = profileAxisBounds(outline, profile.axis);
  return profile.stations.at(-1)!.atMm > length + 1e-6
    ? `Depth stations extend beyond the ${length.toFixed(2)} mm outline. Move the last station inward.` : null;
}

/** Monotone smoothstep has zero slope at each end and never overshoots a depth. */
export function profileDepthAt(profile: DepthProfile, distanceMm: number): number {
  const stations = profile.stations;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    if (distanceMm >= b.atMm) continue;
    if (a.transition === "step") return a.depthMm;
    const t = Math.min(1, Math.max(0, (distanceMm - a.atMm) / (b.atMm - a.atMm)));
    const blend = a.transition === "smooth" ? t * t * (3 - 2 * t) : t;
    return a.depthMm + (b.depthMm - a.depthMm) * blend;
  }
  return stations.at(-1)!.depthMm;
}

/** Piecewise linear floor, shared by solid construction, side previews and
 * rigid placement. Smooth curves have a bounded 0.01 mm vertical chord error. */
export function depthProfileSegments(profile: DepthProfile, lengthMm: number): DepthSegment[] {
  const result: DepthSegment[] = [];
  profile.stations.forEach((a, i) => {
    const b = profile.stations[i + 1];
    if (!b) {
      if (lengthMm > a.atMm) result.push({ fromMm: a.atMm, toMm: lengthMm, fromDepthMm: a.depthMm, toDepthMm: a.depthMm });
      return;
    }
    const count = a.transition === "smooth" ? Math.max(1, Math.ceil(Math.sqrt(0.75 * Math.abs(b.depthMm - a.depthMm) / 0.01))) : 1;
    const depth = (t: number) => a.transition === "step" ? a.depthMm
      : a.depthMm + (b.depthMm - a.depthMm) * (a.transition === "smooth" ? t * t * (3 - 2 * t) : t);
    for (let j = 0; j < count; j++) result.push({
      fromMm: a.atMm + (b.atMm - a.atMm) * j / count,
      toMm: a.atMm + (b.atMm - a.atMm) * (j + 1) / count,
      fromDepthMm: depth(j / count), toDepthMm: depth((j + 1) / count),
    });
  });
  return result;
}

/** Clip a convex scan-line cell; retaining holes/multipart outlines is the
 * responsibility of the existing profileCells decomposition. */
export function clipProfileCell(ring: Ring, axis: "x" | "y", minimum: number, maximum: number): Ring {
  let output = ring;
  for (const [limit, sign] of [[minimum, 1], [maximum, -1]]) {
    const input = output; output = [];
    input.forEach((a, i) => {
      const b = input[(i + 1) % input.length], da = (a[axis] - limit) * sign, db = (b[axis] - limit) * sign;
      if (da >= -1e-9) output.push(a);
      if ((da > 1e-9 && db < -1e-9) || (da < -1e-9 && db > 1e-9)) {
        const t = da / (da - db); const p: Point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }; output.push(p);
      }
    });
  }
  return output.length >= 3 && signedArea(output) > 1e-9 ? output : [];
}
