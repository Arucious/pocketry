import {z} from "zod";

/** Physical dimensions remain millimetres when the source outline is resized.
 * Strength-critical leaf/root/contact dimensions belong to the backed-leaf preset. */
export const wallSpringSchema=z.object({
  id:z.string().min(1),
  shapeIndex:z.number().int().nonnegative().default(0),
  ringIndex:z.number().int().min(-1).default(-1),
  atMm:z.number().finite().nonnegative(),
  widthMm:z.number().finite().min(4).max(10).default(5),
  heightMm:z.number().finite().min(10).max(30).default(10),
  rootFloorMm:z.number().finite().min(1.2).max(280).default(7),
  travelMm:z.number().finite().min(.3).max(.5).default(.4),
  interferenceMm:z.number().finite().min(.02).max(.2).default(.1),
}).strict();
export type WallSpring=z.infer<typeof wallSpringSchema>;
export const BACKED_LEAF={beamMm:1.2,rootMm:1.6,bandMm:1,taperMm:2,
  bevelMm:.3,contactRadiusMm:.8,contactDropMm:1.5,sideGapMm:1,setbackMm:.2,backingMm:.95} as const;
