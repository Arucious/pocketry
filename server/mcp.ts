import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import packageMetadata from "../package.json";
import { importSvgShape } from "../shared/geometry/svg-import";
import { svgBinOptionsSchema } from "../shared/gridfinity/svg-bin";
import { imageTraceOptionsSchema } from "../shared/geometry/image-trace";
import { inspectImage, traceImageToSvg } from "../scripts/lib/trace-image";
import {
  exportProject,
  readProjectFile,
  readSvgBin,
  readSvgFile,
} from "../scripts/lib/export-bin";

/** Local operations are injected for transport tests; production uses the CLI's exporter. */
export interface PocketryMcpHandlers {
  readSvgFile: typeof readSvgFile;
  readProjectFile: typeof readProjectFile;
  readSvgBin: typeof readSvgBin;
  exportProject: typeof exportProject;
  inspectImage: typeof inspectImage;
  traceImageToSvg: typeof traceImageToSvg;
}

const localPath = z.string().trim().min(1).max(4096)
  .refine(path => !path.includes("\0"), "A local path cannot contain a NUL character.");
const svgInputSchema = z.object({
  svgPath: localPath.describe("Local SVG file path; relative paths use the MCP server's working directory."),
  widthMm: z.number().finite().positive().optional()
    .describe("Optional physical width of the actual outline, excluding canvas margins. Preserves aspect ratio."),
  name: z.string().trim().min(1).max(80).optional()
    .describe("Optional name for the imported shape and saved project."),
}).strict();
const planInputSchema = svgInputSchema.extend({
  options: svgBinOptionsSchema.describe("Shared SVG bin planner options. All distances are millimetres."),
});
const exportSvgInputSchema = planInputSchema.extend({
  outDir: localPath.describe("Local directory for STL, 3MF and editable .pocketry.json artifacts; created if needed."),
  exportName: z.string().trim().min(1).max(101).optional()
    .describe("Optional output filename stem. Letters, digits, dash, underscore or dot; no paths or '..'."),
});
const exportProjectInputSchema = z.object({
  projectPath: localPath.describe("Local .pocketry.json file path. Current and supported older schemas are accepted."),
  outDir: localPath.describe("Local export directory; created if needed."),
  name: z.string().trim().min(1).max(80).optional().describe("Optional output file stem."),
}).strict();
const imageInputSchema = z.object({
  imagePath: localPath.describe("Local PNG/JPEG photo path; all coordinates refer to native EXIF-oriented pixels."),
}).strict();
const traceImageInputSchema = imageInputSchema.extend({
  svgPath: localPath.describe("Output SVG path in an existing directory. Physical scale comes from the ruler, never image DPI."),
  options: imageTraceOptionsSchema.default({}).describe("Automatic reference-strip or explicit ruler calibration, optional ROI, detail and component selection. Largest component is index zero."),
  overwrite: z.boolean().default(false).describe("Allow replacing an existing SVG; disabled by default."),
});

const readOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const exportAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

function result(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

/** Expected file/geometry errors reach the client as tool errors, without stderr/stdout noise. */
async function asToolResult(operation: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return result(await operation());
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

/** Creates a stdio-ready server without opening files, loading WASM or connecting a transport. */
export function createPocketryMcpServer(overrides: Partial<PocketryMcpHandlers> = {}): McpServer {
  const handlers: PocketryMcpHandlers = {
    readSvgFile,
    readProjectFile,
    readSvgBin,
    exportProject,
    inspectImage,
    traceImageToSvg,
    ...overrides,
  };
  const server = new McpServer({ name: "pocketry", version: packageMetadata.version }, {
    instructions: "Pocketry's local photo and SVG pocket tools use physical millimetres and the same tracing/planning code as the browser and export:bin. "
      + "Inspect a PNG/JPEG photo's reference-strip calibration, trace its selected silhouette to SVG, then inspect the measured SVG. Photo coordinates are native EXIF-oriented pixels, y-down; scale requires a valid marker strip or explicit ruler endpoints. "
      + "Inspect an SVG, plan the bin, then export. Planning returns an editable project and reports the selected whole-unit bin size. "
      + "Shape-local and explicit finger-access coordinates are y-up. Exports write local files and may replace matching artifact names. "
      + "Generated models use Pocketry's native Gridfinity profiles and are exported locally for editing or slicing.",
  });

  server.registerTool("pocketry_inspect_svg", {
    title: "Inspect SVG outline",
    description: "Read a local SVG and report its physical outline dimensions, ring counts and point count. Uses SVG physical units or an explicit outline width; does not write files.",
    inputSchema: svgInputSchema,
    annotations: readOnlyAnnotations,
  }, async ({ svgPath, widthMm, name }) => asToolResult(async () => {
    const shape = importSvgShape(await handlers.readSvgFile(svgPath), { widthMm, name });
    return {
      name: shape.name,
      widthMm: shape.bboxMm.maxX - shape.bboxMm.minX,
      heightMm: shape.bboxMm.maxY - shape.bboxMm.minY,
      boundsMm: shape.bboxMm,
      components: shape.outlineMm.length,
      holes: shape.outlineMm.reduce((count, component) => count + component.holes.length, 0),
      pointCount: shape.pointCount,
      coordinateFrame: "shape-local millimetres, y-up, origin at outline bounding-box centre",
    };
  }));

  server.registerTool("pocketry_plan_svg_bin", {
    title: "Plan SVG pocket bin",
    description: "Read an SVG and find the smallest feasible whole-cell stackable Pocketry bin among the planner's tested rotations. objectDepthMm includes the deepest seat; objectHeightMm covers a taller upside feature for stacking clearance. Optional depthProfile specifies up to 64 source-local stations with step, linear or smooth transitions; depthClearanceMm is added once to every station. Finger access supports sides, ends, both, none, or explicit bin-local centres. Returns an editable project and dimensional summary without writing files.",
    inputSchema: planInputSchema,
    annotations: readOnlyAnnotations,
  }, async ({ svgPath, widthMm, name, options }) => asToolResult(async () => {
    const plan = await handlers.readSvgBin(svgPath, options, { widthMm, name });
    return { project: plan.project, summary: plan.summary };
  }));

  server.registerTool("pocketry_export_svg_bin", {
    title: "Export SVG pocket bin",
    description: "Plan an SVG pocket bin with the shared planner and write STL, 3MF and editable .pocketry.json artifacts. Stacking lip is enabled by default, with no labels or optional base holes. Reports final geometry and file paths. Existing files with matching names may be replaced.",
    inputSchema: exportSvgInputSchema,
    annotations: exportAnnotations,
  }, async ({ svgPath, widthMm, name, options, outDir, exportName }) => asToolResult(async () => {
    const plan = await handlers.readSvgBin(svgPath, options, { widthMm, name });
    const exported = await handlers.exportProject(plan.project, outDir, exportName);
    return { ...exported, summary: plan.summary };
  }));

  server.registerTool("pocketry_export_project", {
    title: "Export saved Pocketry project",
    description: "Read an editable .pocketry.json project, validate it, then write STL, 3MF and project artifacts with Pocketry's shared geometry exporter. Useful after moving pockets or finger access in the browser editor. Existing matching files may be replaced.",
    inputSchema: exportProjectInputSchema,
    annotations: exportAnnotations,
  }, async ({ projectPath, outDir, name }) => asToolResult(async () => {
    const project = await handlers.readProjectFile(projectPath);
    return { ...await handlers.exportProject(project, outDir, name) };
  }));

  server.registerTool("pocketry_inspect_image", {
    title: "Inspect photo calibration",
    description: "Read a local PNG/JPEG, report EXIF-oriented pixel dimensions and SHA-256, and detect Pocketry calibration markers using the bundled OpenCV. Reports invalid/absent calibration without inventing a scale. Does not write files or upload photos.",
    inputSchema: imageInputSchema,
    annotations: readOnlyAnnotations,
  }, async ({ imagePath }) => asToolResult(async () => ({ ...await handlers.inspectImage(imagePath) })));

  server.registerTool("pocketry_trace_image_svg", {
    title: "Trace calibrated photo to SVG",
    description: "Use Pocketry's existing segmentation/refinement pipeline to trace a local PNG/JPEG into a physically scaled closed SVG. Supports automatic valid reference strips or explicit measured ruler endpoints, a pixel ROI, largest/selected component, optional exterior-only silhouette and a reviewed exterior ring for correcting low-contrast boundaries. No clearance is added. Inspect the output against the photo before CAD; marker geometry cannot establish coplanarity or physical fit. Refuses to overwrite files by default.",
    inputSchema: traceImageInputSchema,
    annotations: exportAnnotations,
  }, async ({ imagePath, svgPath, options, overwrite }) => asToolResult(async () => ({
    ...await handlers.traceImageToSvg(imagePath, svgPath, options, overwrite),
  })));

  return server;
}
