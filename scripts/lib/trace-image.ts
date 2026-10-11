import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { imageTraceOptionsSchema, type ImageTraceOptions } from "../../shared/geometry/image-trace";
import { outlineBounds, normalizeOutline } from "../../shared/geometry/outline";
import { ringArea } from "../../shared/geometry/rings";
import { importSvgShape } from "../../shared/geometry/svg-import";
import { mmPerPixel } from "../../shared/geometry/scale";
import { runAutoCalibration } from "../../client/src/lib/calibrate/auto-calibrate";
import { detectOutline, refineOutline } from "../../client/src/lib/detect/pipeline";
import type { ImageLike } from "../../client/src/lib/detect/types";
import { generateOutlineSVG } from "../../client/src/lib/export/svg";

// OpenCV's bundled ArUco bindings are untyped; this is the Node runtime boundary.
let cvRuntime: Promise<any> | undefined;
function nodeCv(): Promise<any> {
  cvRuntime ??= Promise.resolve(createRequire(import.meta.url)("../../client/public/opencv/opencv.js"));
  return cvRuntime;
}

async function decodeImage(imagePath: string): Promise<{ image: ImageLike; sha256: string }> {
  const file = await open(imagePath, "r");
  const limit = 20 * 1024 * 1024;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error("Use a local PNG/JPEG image under 20 MB.");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error("Use a local PNG/JPEG image under 20 MB.");
    const bytes = buffer.subarray(0, length);
    const decoder = sharp(bytes, { limitInputPixels: 50_000_000 });
    const metadata = await decoder.metadata();
    if (metadata.format !== "png" && metadata.format !== "jpeg") throw new Error("Only PNG and JPEG photos are supported.");
    const { data, info: pixels } = await decoder.rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { image: { width: pixels.width, height: pixels.height, data: new Uint8ClampedArray(data) },
      sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally { await file.close(); }
}

/** Local CLI/MCP only. Express routes do not process or upload these photos. */
export async function inspectImage(imagePath: string) {
  const { image, sha256 } = await decodeImage(imagePath);
  const automatic = runAutoCalibration(await nodeCv(), image as ImageData);
  return { imagePath: resolve(imagePath), sha256, widthPx: image.width, heightPx: image.height,
    coordinateFrame: "native EXIF-oriented image pixels, x-right/y-down", automaticCalibration: automatic };
}

/** Reuses the browser's pure-JS segmentation backend, ring refinement and SVG writer. */
export async function traceImage(imagePath: string, input: ImageTraceOptions = {}) {
  const options = imageTraceOptionsSchema.parse(input);
  const { image, sha256 } = await decodeImage(imagePath);
  const automatic = options.calibration === "auto"
    ? runAutoCalibration(await nodeCv(), image as ImageData) : null;
  if (options.calibration === "auto" && (automatic?.kind !== "calibrated-strip" || automatic.requiresPerspectiveCorrection)) {
    throw new Error(`Automatic scalar calibration unavailable (${automatic?.kind}). Use a valid reference strip or explicit measured ruler endpoints; perspective correction must be applied before tracing.`);
  }
  const calibration = options.calibration === "auto"
    ? (automatic as Extract<NonNullable<typeof automatic>, { kind: "calibrated-strip" }>).calibration
    : options.calibration;
  const scale = mmPerPixel(calibration);
  if (scale === null) throw new Error("Ruler endpoints must be distinct and describe a positive physical distance.");
  for (const [x, y] of [[calibration.startX, calibration.startY], [calibration.endX, calibration.endY]]) {
    if (x >= image.width || y >= image.height) throw new Error("Ruler endpoints must lie inside the EXIF-oriented image.");
  }
  const roi = options.roi;
  if (roi && (roi.x + roi.width > image.width || roi.y + roi.height > image.height)) throw new Error("ROI must lie inside the EXIF-oriented image.");
  if (options.outlinePx?.some(p => p.x >= image.width || p.y >= image.height)) throw new Error("Reviewed outline points must lie inside the EXIF-oriented image.");
  const refinement = { tolerancePx: options.toleranceMm / scale, smoothing: options.smoothing };
  const detected = options.outlinePx ? null : await detectOutline(image, { engine: "js", roi,
    sensitivity: options.sensitivity, ...refinement, maxPixels: 6_000_000 });
  const refined = options.outlinePx
    ? refineOutline(normalizeOutline([{ outer: options.outlinePx, holes: [] }]), refinement)
    : detected!.outline;
  const components = [...refined].sort((a, b) => ringArea(b.outer) - ringArea(a.outer));
  const component = components[options.component];
  if (!component) throw new Error(`No component ${options.component}; detected ${components.length} components. Adjust ROI or sensitivity.`);
  const outline = normalizeOutline([{ outer: component.outer, holes: options.exteriorOnly ? [] : component.holes }]);
  const bounds = outlineBounds(outline)!;
  const svg = generateOutlineSVG(outline, { width: image.width, height: image.height,
    calibration, precision: 4, fill: "black", stroke: "none", strokeWidth: 0 });
  // The same importer validates both automatically traced and reviewed rings.
  importSvgShape(svg);
  return { svg, summary: { imagePath: resolve(imagePath), sha256, widthPx: image.width, heightPx: image.height,
    widthMm: (bounds.maxX - bounds.minX) * scale, heightMm: (bounds.maxY - bounds.minY) * scale,
    boundsPx: bounds, mmPerPixel: scale, calibration, automaticCalibration: automatic, options,
    detectedComponents: components.length, selectedComponent: options.component,
    holes: outline[0].holes.length, omittedHoles: options.exteriorOnly ? component.holes.length : 0,
    pointCount: outline[0].outer.length + outline[0].holes.reduce((sum, ring) => sum + ring.length, 0),
    engine: detected?.engine ?? "reviewed-outline", threshold: detected?.threshold ?? null,
    warnings: ["Photo scale cannot establish object/reference coplanarity, lens distortion or physical pocket fit.",
      ...(components.length > 1 ? ["Multiple components detected; review the selected outline against the photo."] : [])] } };
}

/** Refuses to replace existing SVGs unless explicitly requested. */
export async function traceImageToSvg(imagePath: string, svgPath: string, options: ImageTraceOptions = {}, overwrite = false) {
  const traced = await traceImage(imagePath, options);
  if (resolve(imagePath) === resolve(svgPath)) throw new Error("SVG output must differ from the source photo.");
  if (overwrite) {
    const existing = await lstat(svgPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) throw new Error("SVG output cannot be a symbolic link.");
  }
  const source = await open(imagePath, "r");
  try {
    // Open without O_TRUNC so a hardlink cannot destroy the photo before checking.
    const flags = constants.O_WRONLY | constants.O_CREAT |
      (overwrite ? constants.O_NOFOLLOW : constants.O_EXCL);
    const destination = await open(svgPath, flags, 0o644);
    try {
      const inputIdentity = await source.stat({ bigint: true });
      const outputIdentity = await destination.stat({ bigint: true });
      if (inputIdentity.dev === outputIdentity.dev && inputIdentity.ino === outputIdentity.ino) {
        throw new Error("SVG output cannot alias the source photo.");
      }
      if (!outputIdentity.isFile()) throw new Error("SVG output must be a regular file.");
      await destination.truncate(0);
      await destination.writeFile(traced.svg);
    } finally { await destination.close(); }
  } finally { await source.close(); }
  return { svgPath: resolve(svgPath), ...traced.summary };
}
