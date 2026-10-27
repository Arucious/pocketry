import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { importSvgShape } from "../../shared/geometry/svg-import";
import { MEASUREMENT_AIDS, referenceStripBlackCells } from "../../client/src/lib/calibrate/reference-strip";
import { inspectImage, traceImage, traceImageToSvg } from "./trace-image";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

async function fixture(format: "png" | "jpeg" = "png", orientation?: number) {
  const directory = await mkdtemp(join(tmpdir(), "pocketry-photo-"));
  directories.push(directory);
  const path = join(directory, `tool.${format}`);
  // A generic concave silhouette, no private item/photo fixtures.
  const svg = '<svg width="160" height="100"><rect width="160" height="100" fill="#222"/><path d="M30 20H130V40H90V60H130V80H30Z" fill="#ddd"/></svg>';
  let encoder = sharp(Buffer.from(svg));
  if (orientation) encoder = encoder.withMetadata({ orientation });
  await encoder[format]().toFile(path);
  return { path, directory };
}
const calibration = { startX: 10, startY: 5, endX: 110, endY: 5, lengthMm: 50 };

describe("local calibrated image tracing", () => {
  it.each(["png", "jpeg"] as const)("decodes %s and preserves concavity, physical scale and Y orientation through SVG", async (format) => {
    const { path } = await fixture(format);
    const traced = await traceImage(path, { calibration, roi: { x: 15, y: 10, width: 130, height: 80 }, smoothing: 0 });
    expect(traced.summary.widthMm).toBeCloseTo(50, 0);
    expect(traced.summary.heightMm).toBeCloseTo(30, 0);
    expect(traced.summary.engine).toBe("js");
    const shape = importSvgShape(traced.svg);
    expect(shape.outlineMm).toHaveLength(1);
    expect(shape.bboxMm.maxX - shape.bboxMm.minX).toBeCloseTo(traced.summary.widthMm, 3);
    expect(shape.outlineMm[0].outer.length).toBeGreaterThan(4);
    expect(traced.svg).toContain('fill="black"');
    expect(traced.svg).toContain('stroke="none"');
    expect(traced.summary.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects the shipped 50 mm aid and uses its 35 mm marker-centre baseline", async () => {
    const { directory } = await fixture();
    const spec = MEASUREMENT_AIDS[50];
    const cells = referenceStripBlackCells(spec).map(c => `<rect x="${40 + c.x * 4}" y="${15 + c.y * 4}" width="${c.size * 4}" height="${c.size * 4}"/>`).join("");
    const svg = `<svg width="300" height="180"><rect width="300" height="180" fill="#222"/><rect x="40" y="15" width="200" height="60" fill="white"/><g fill="black">${cells}</g><rect x="20" y="110" width="250" height="50" fill="white"/></svg>`;
    const path = join(directory, "markers.png");
    await sharp(Buffer.from(svg)).png().toFile(path);
    const inspected = await inspectImage(path);
    expect(inspected.automaticCalibration.kind).toBe("calibrated-strip");
    const traced = await traceImage(path, { roi: { x: 0, y: 90, width: 300, height: 90 }, smoothing: 0 });
    expect(traced.summary.calibration.lengthMm).toBe(35);
    expect(traced.summary.mmPerPixel).toBeCloseTo(0.25, 2);
    expect(traced.summary.widthMm).toBeCloseTo(62.5, 0);
  });

  it("reports EXIF-oriented pixels instead of unrotated JPEG dimensions", async () => {
    const { path } = await fixture("jpeg", 6);
    expect(await inspectImage(path)).toMatchObject({ widthPx: 100, heightPx: 160 });
  });

  it("requires usable scale and rejects out-of-image ROI/endpoints", async () => {
    const { path } = await fixture();
    await expect(traceImage(path)).rejects.toThrow("Automatic scalar calibration unavailable");
    await expect(traceImage(path, { calibration: { ...calibration, endX: 10 } })).rejects.toThrow("distinct");
    await expect(traceImage(path, { calibration: { ...calibration, endX: 200 } })).rejects.toThrow("inside");
    await expect(traceImage(path, { calibration, roi: { x: 100, y: 0, width: 100, height: 30 } })).rejects.toThrow("ROI");
    await expect(traceImage(path, { calibration, component: 100 })).rejects.toThrow("No component");
  });

  it("accepts reviewed photo boundaries and rejects invalid or out-of-image rings", async () => {
    const { path } = await fixture();
    const outlinePx = [{ x: 20, y: 10 }, { x: 140, y: 10 }, { x: 140, y: 90 }, { x: 20, y: 90 }];
    const traced = await traceImage(path, { calibration, outlinePx, smoothing: 0 });
    expect(traced.summary).toMatchObject({ engine: "reviewed-outline", widthMm: 60, heightMm: 40, threshold: null });
    await expect(traceImage(path, { calibration, outlinePx: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 30 }] })).rejects.toThrow("inside");
    await expect(traceImage(path, { calibration, outlinePx: [{ x: 20, y: 10 }, { x: 140, y: 90 }, { x: 20, y: 90 }, { x: 140, y: 10 }], smoothing: 0 })).rejects.toThrow();
  });

  it("writes a calibrated SVG and preserves an existing file unless overwrite is explicit", async () => {
    const { path, directory } = await fixture();
    const svgPath = join(directory, "new.svg");
    await traceImageToSvg(path, svgPath, { calibration });
    const first = await readFile(svgPath, "utf8");
    await expect(traceImageToSvg(path, svgPath, { calibration })).rejects.toThrow("EEXIST");
    expect(await readFile(svgPath, "utf8")).toBe(first);
    await writeFile(svgPath, "old");
    await traceImageToSvg(path, svgPath, { calibration }, true);
    expect(await readFile(svgPath, "utf8")).toBe(first);
    await expect(traceImageToSvg(path, path, { calibration }, true)).rejects.toThrow("differ");
  });

  it.for(["symlink", "hardlink"] as const)("preserves the source photo when overwrite targets a %s alias", async (kind, context) => {
    const { path, directory } = await fixture();
    const before = await readFile(path);
    const alias = join(directory, "alias.svg");
    try {
      await (kind === "symlink" ? symlink(path, alias) : link(path, alias));
    } catch (error) {
      if (kind === "symlink" && process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("Windows symlink privilege is unavailable; source-alias protection still runs for hardlinks.");
      }
      throw error;
    }
    await expect(traceImageToSvg(path, alias, { calibration }, true)).rejects.toThrow(kind === "symlink" ? "symbolic link" : "alias");
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(alias)).toEqual(before);
  });
});
