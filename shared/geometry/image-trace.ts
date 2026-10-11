import { z } from "zod";

const coordinate = z.number().finite().nonnegative();
export const photoCalibrationSchema = z.object({
  startX: coordinate, startY: coordinate, endX: coordinate, endY: coordinate,
  lengthMm: z.number().finite().positive(),
}).strict();

/** Coordinates always refer to native, EXIF-oriented pixels, before any ROI crop. */
export const imageTraceOptionsSchema = z.object({
  calibration: z.union([z.literal("auto"), photoCalibrationSchema]).default("auto"),
  roi: z.object({ x: coordinate, y: coordinate,
    width: z.number().finite().positive(), height: z.number().finite().positive(),
  }).strict().optional(),
  sensitivity: z.number().int().min(0).max(255).default(128),
  toleranceMm: z.number().finite().min(0).max(5).default(0.05),
  smoothing: z.number().int().min(0).max(20).default(1),
  component: z.number().int().nonnegative().default(0),
  exteriorOnly: z.boolean().default(false),
  outlinePx: z.array(z.object({ x: coordinate, y: coordinate }).strict()).min(3).max(10_000).optional()
    .describe("Optional reviewed exterior ring in native photo pixels, implicitly closed. Use to correct segmentation where an object's dark edge blends into the background; no repeated final vertex."),
}).strict();
export type ImageTraceOptions = z.input<typeof imageTraceOptionsSchema>;
