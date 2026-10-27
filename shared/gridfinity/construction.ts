import { z } from "zod";

/** Side-entry dimensions from the owner's saved Extended preset. Fit is provisional. */
export const refinedMagnetSchema = z.object({
  diameterMm: z.number().finite().min(4).max(8).default(6.25),
  thicknessMm: z.number().finite().min(1).max(3.5).default(2.1),
  captiveHeightMm: z.number().finite().min(.2).max(1.2).default(.4),
  sideAccess: z.enum(["left", "right"]).default("right"),
  easyRelease: z.enum(["off", "auto"]).default("auto"),
  cornerOnly: z.boolean().default(true),
  /** Optional friction trial; no ribs by default. */
  crushDepthMm: z.number().finite().min(0).max(.3).default(0),
}).strict();
export type RefinedMagnetSettings = z.infer<typeof refinedMagnetSchema>;
export const DEFAULT_REFINED_MAGNETS: Readonly<RefinedMagnetSettings> = Object.freeze(refinedMagnetSchema.parse({}));
export const REFINED_MAGNET_HEIGHT_ALLOWANCE_MM = .1;
export const MIN_REFINED_MAGNET_ROOF_MM = 1.2;
export const baseStyleSchema = z.enum(["solid", "standard-magnets", "refined-magnets", "flat"]);
export function baseStylePatch(style: z.infer<typeof baseStyleSchema>) {
  return { flatBottom: style === "flat", magnetHoles: style === "standard-magnets" || style === "refined-magnets",
    magnetCrushRibs: false, screwHoles: false,
    ...(style === "refined-magnets" ? { magnetStyle: "refined" as const } :
      style === "standard-magnets" ? { magnetStyle: "standard" as const } : {}) };
}

/** Explicit preset, never an implicit rewrite of existing or upstream projects. */
export function refinedConstructionPreset() {
  return { lip: "standard" as const, lipNotches: true, flatBottom: false,
    magnetHoles: true, magnetStyle: "refined" as const, refinedMagnet: { ...DEFAULT_REFINED_MAGNETS },
    magnetCrushRibs: false, screwHoles: false, labelTab: null };
}
