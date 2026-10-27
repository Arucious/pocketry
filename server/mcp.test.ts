import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { importSvgShape } from "../shared/geometry/svg-import";
import { planSvgBin } from "../shared/gridfinity/svg-bin";
import type { ExportResult } from "../scripts/lib/export-bin";
import { createPocketryMcpServer, type PocketryMcpHandlers } from "./mcp";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>';
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function connect(overrides: Partial<PocketryMcpHandlers> = {}): Promise<Client> {
  const server = createPocketryMcpServer(overrides);
  const client = new Client({ name: "pocketry-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(async () => { await client.close(); await server.close(); });
  return client;
}

function exported(): ExportResult {
  return {
    paths: { stl: "/tmp/bin.stl", threeMf: "/tmp/bin.3mf", project: "/tmp/bin.pocketry.json" },
    dimensions: { widthMm: 83.5, lengthMm: 41.5, heightToRimMm: 28, totalHeightMm: 31.8 },
    volumeCm3: 32,
    triangles: 300,
    warnings: [],
  };
}

describe("Pocketry MCP tools over the official SDK", () => {
  it("exposes depth stations and transition modes through the shared planner schema", async () => {
    const readSvgBin = vi.fn<PocketryMcpHandlers["readSvgBin"]>(async () => planSvgBin(importSvgShape(svg), { objectDepthMm: 12 }));
    const client = await connect({ readSvgBin });
    const profile = { axis: "x", stations: [{ atMm: 0, depthMm: 12, transition: "step" },
      { atMm: 10, depthMm: 12, transition: "smooth" }, { atMm: 30, depthMm: 4, transition: "linear" }] };
    const response = await client.callTool({ name: "pocketry_plan_svg_bin", arguments: { svgPath: "tool.svg",
      options: { objectDepthMm: 12, depthProfile: profile } } });
    expect(response.isError).not.toBe(true);
    expect(readSvgBin).toHaveBeenCalledWith("tool.svg", expect.objectContaining({ depthProfile: profile }), expect.anything());
  });
  it("advertises photo and SVG tools, shared planner fields and local write annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual([
      "pocketry_inspect_svg", "pocketry_plan_svg_bin", "pocketry_export_svg_bin", "pocketry_export_project",
      "pocketry_inspect_image", "pocketry_trace_image_svg",
    ]);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tools[2].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    const planSchema = tools[1].inputSchema.properties?.options as {
      properties?: Record<string, unknown>; required?: string[];
    };
    expect(planSchema.properties).toHaveProperty("objectDepthMm");
    expect(planSchema.properties).toHaveProperty("objectHeightMm");
    expect(planSchema.required).toContain("objectDepthMm");
  });

  it("passes validated photo options to the shared local tracer", async () => {
    const traceImageToSvg = vi.fn<PocketryMcpHandlers["traceImageToSvg"]>();
    const client = await connect({ traceImageToSvg });
    const response = await client.callTool({ name: "pocketry_trace_image_svg", arguments: {
      imagePath: "photo.jpg", svgPath: "outline.svg", options: { exteriorOnly: true },
    } });
    expect(response.isError).not.toBe(true);
    expect(traceImageToSvg).toHaveBeenCalledWith("photo.jpg", "outline.svg", expect.objectContaining({
      calibration: "auto", exteriorOnly: true, toleranceMm: 0.05, component: 0,
    }), false);
  });

  it("returns photo failures as tool errors and rejects invalid pixel regions before tracing", async () => {
    const inspectImage = vi.fn<PocketryMcpHandlers["inspectImage"]>(async () => { throw new Error("Unsupported image"); });
    const traceImageToSvg = vi.fn<PocketryMcpHandlers["traceImageToSvg"]>();
    const client = await connect({ inspectImage, traceImageToSvg });
    const failed = await client.callTool({ name: "pocketry_inspect_image", arguments: { imagePath: "bad.jpg" } });
    expect(failed.isError).toBe(true);
    const invalid = await client.callTool({ name: "pocketry_trace_image_svg", arguments: {
      imagePath: "photo.jpg", svgPath: "outline.svg", options: { roi: { x: -1, y: 0, width: 10, height: 10 } },
    } });
    expect(invalid.isError).toBe(true);
    expect(traceImageToSvg).not.toHaveBeenCalled();
  });

  it("inspects calibrated outline dimensions and reports y-up local coordinates", async () => {
    const readSvgFile = vi.fn<PocketryMcpHandlers["readSvgFile"]>(async () => svg);
    const client = await connect({ readSvgFile });
    const response = await client.callTool({ name: "pocketry_inspect_svg", arguments: { svgPath: "shape.svg", name: "Test shape" } });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      name: "Test shape", widthMm: 40, heightMm: 20, components: 1, holes: 0,
      boundsMm: { minX: -20, minY: -10, maxX: 20, maxY: 10 },
      coordinateFrame: expect.stringContaining("y-up"),
    });
    expect(readSvgFile).toHaveBeenCalledWith("shape.svg");
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  });

  it("passes an outline-width calibration through to the importer", async () => {
    const client = await connect({ readSvgFile: async () => svg });
    const response = await client.callTool({ name: "pocketry_inspect_svg", arguments: { svgPath: "shape.svg", widthMm: 80 } });
    expect(response.structuredContent).toMatchObject({ widthMm: 80, heightMm: 40 });
  });

  it("returns an editable plan without invoking any exporter", async () => {
    const plan = planSvgBin(importSvgShape(svg), { objectDepthMm: 12, objectHeightMm: 18 });
    const readSvgBin = vi.fn<PocketryMcpHandlers["readSvgBin"]>(async () => plan);
    const exportProject = vi.fn<PocketryMcpHandlers["exportProject"]>(async () => exported());
    const client = await connect({ readSvgBin, exportProject });
    const response = await client.callTool({ name: "pocketry_plan_svg_bin", arguments: {
      svgPath: "shape.svg", widthMm: 40, name: "Example",
      options: { objectDepthMm: 12, objectHeightMm: 18 },
    } });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({ project: plan.project, summary: plan.summary });
    expect(readSvgBin).toHaveBeenCalledWith("shape.svg", expect.objectContaining({ objectDepthMm: 12, objectHeightMm: 18 }), { widthMm: 40, name: "Example" });
    expect(exportProject).not.toHaveBeenCalled();
    expect(plan.project.spec.lip).toBe("standard");
    expect(plan.project.spec.labelTab).toBeNull();
    expect(plan.project.spec.magnetHoles).toBe(false);
    expect(plan.project.spec.screwHoles).toBe(false);
    expect(Number.isInteger(plan.project.spec.heightUnits)).toBe(true);
  });

  it("exports the planned project and reports all artifact paths", async () => {
    const plan = planSvgBin(importSvgShape(svg), { objectDepthMm: 12 });
    const exportProject = vi.fn<PocketryMcpHandlers["exportProject"]>(async () => exported());
    const client = await connect({ readSvgBin: async () => plan, exportProject });
    const response = await client.callTool({ name: "pocketry_export_svg_bin", arguments: {
      svgPath: "shape.svg", options: { objectDepthMm: 12 }, outDir: "/tmp/artifacts", exportName: "test-bin",
    } });
    expect(response.structuredContent).toEqual({ ...exported(), summary: plan.summary });
    expect(exportProject).toHaveBeenCalledWith(plan.project, "/tmp/artifacts", "test-bin");
  });

  it("keeps display names distinct from the optional output filename", async () => {
    const plan = planSvgBin(importSvgShape(svg), { objectDepthMm: 12 });
    const exportProject = vi.fn<PocketryMcpHandlers["exportProject"]>(async () => exported());
    const client = await connect({ readSvgBin: async () => plan, exportProject });
    await client.callTool({ name: "pocketry_export_svg_bin", arguments: {
      svgPath: "shape.svg", name: "My tool shape", options: { objectDepthMm: 12 }, outDir: "/tmp/artifacts",
    } });
    expect(exportProject).toHaveBeenCalledWith(plan.project, "/tmp/artifacts", undefined);
  });

  it("preserves explicit bin-local finger centres in the shared options", async () => {
    const plan = planSvgBin(importSvgShape(svg), { objectDepthMm: 12 });
    const readSvgBin = vi.fn<PocketryMcpHandlers["readSvgBin"]>(async () => plan);
    const client = await connect({ readSvgBin });
    const centers = [{ x: -8, y: 10 }, { x: 8, y: -10 }];
    const response = await client.callTool({ name: "pocketry_plan_svg_bin", arguments: {
      svgPath: "shape.svg", options: { objectDepthMm: 12, fingerAccess: { placement: "custom", centers } },
    } });
    expect(response.isError).not.toBe(true);
    expect(readSvgBin).toHaveBeenCalledWith("shape.svg", expect.objectContaining({
      fingerAccess: expect.objectContaining({ placement: "custom", centers }),
    }), { widthMm: undefined, name: undefined });
  });

  it("reads a saved project through the shared reader before exporting", async () => {
    const plan = planSvgBin(importSvgShape(svg), { objectDepthMm: 12 });
    const readProjectFile = vi.fn<PocketryMcpHandlers["readProjectFile"]>(async () => plan.project);
    const exportProject = vi.fn<PocketryMcpHandlers["exportProject"]>(async () => exported());
    const client = await connect({ readProjectFile, exportProject });
    const response = await client.callTool({ name: "pocketry_export_project", arguments: {
      projectPath: "modified.pocketry.json", outDir: "/tmp/modified", name: "modified-bin",
    } });
    expect(response.isError).not.toBe(true);
    expect(readProjectFile).toHaveBeenCalledWith("modified.pocketry.json");
    expect(exportProject).toHaveBeenCalledWith(plan.project, "/tmp/modified", "modified-bin");
  });

  it.each([
    { svgPath: "shape.svg", options: { objectDepthMm: -1 }, outDir: "/tmp/artifacts" },
    { svgPath: "shape.svg", options: {}, outDir: "/tmp/artifacts" },
    { svgPath: "shape.svg", options: { objectDepthMm: 12 }, outDir: "" },
    { svgPath: "shape\0.svg", options: { objectDepthMm: 12 }, outDir: "/tmp/artifacts" },
    { svgPath: "shape.svg", options: { objectDepthMm: 12 }, outDir: "/tmp/artifacts", unknown: true },
    { svgPath: "shape.svg", options: { objectDepthMm: 12, objectHeightMm: 6 }, outDir: "/tmp/artifacts" },
    { svgPath: "shape.svg", options: { objectDepthMm: 12, fingerAccess: { placement: "custom" } }, outDir: "/tmp/artifacts" },
    { svgPath: "shape.svg", options: { objectDepthMm: 12, unknown: true }, outDir: "/tmp/artifacts" },
  ])("rejects invalid inputs before any reader or exporter runs: %j", async arguments_ => {
    const readSvgBin = vi.fn<PocketryMcpHandlers["readSvgBin"]>();
    const exportProject = vi.fn<PocketryMcpHandlers["exportProject"]>();
    const client = await connect({ readSvgBin, exportProject });
    const response = await client.callTool({ name: "pocketry_export_svg_bin", arguments: arguments_ });
    expect(response.isError).toBe(true);
    expect(readSvgBin).not.toHaveBeenCalled();
    expect(exportProject).not.toHaveBeenCalled();
  });

  it("returns actionable file errors as MCP tool errors", async () => {
    const client = await connect({ readSvgFile: async () => { throw new Error("Expected a file: /tmp/svg-directory"); } });
    const response = await client.callTool({ name: "pocketry_inspect_svg", arguments: { svgPath: "/tmp/svg-directory" } });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([{ type: "text", text: "Expected a file: /tmp/svg-directory" }]);
  });

  it("does not invoke the exporter if saved project validation fails", async () => {
    const exportProject = vi.fn<PocketryMcpHandlers["exportProject"]>();
    const client = await connect({
      readProjectFile: async () => { throw new Error("Invalid or unsupported Pocketry project."); }, exportProject,
    });
    const response = await client.callTool({ name: "pocketry_export_project", arguments: { projectPath: "bad.json", outDir: "/tmp/artifacts" } });
    expect(response.isError).toBe(true);
    expect(exportProject).not.toHaveBeenCalled();
  });

  it("starts the real stdio entrypoint and reads SVGs and traces photos without protocol noise", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocketry-mcp-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const svgPath = join(directory, "outline.svg");
    await writeFile(svgPath, svg);
    const client = new Client({ name: "pocketry-stdio-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "scripts/mcp.ts"],
      cwd: dirname(dirname(fileURLToPath(import.meta.url))),
      stderr: "pipe",
    });
    cleanups.push(() => client.close());
    let stderr = "";
    transport.stderr?.on("data", chunk => { stderr += String(chunk); });
    try {
      await client.connect(transport);
    } catch (error) {
      throw new Error(`MCP stdio startup failed: ${stderr}`, { cause: error });
    }
    expect((await client.listTools()).tools).toHaveLength(6);
    const response = await client.callTool({ name: "pocketry_inspect_svg", arguments: { svgPath } });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ widthMm: 40, heightMm: 20 });
    const imagePath = join(directory, "photo.jpg");
    await sharp(Buffer.from('<svg width="100" height="80"><rect width="100" height="80" fill="#222"/><rect x="20" y="20" width="60" height="40" fill="white"/></svg>')).jpeg().toFile(imagePath);
    const inspected = await client.callTool({ name: "pocketry_inspect_image", arguments: { imagePath } });
    expect(inspected.structuredContent).toMatchObject({ widthPx: 100, heightPx: 80, automaticCalibration: { kind: "no-markers" } });
    const traced = await client.callTool({ name: "pocketry_trace_image_svg", arguments: {
      imagePath, svgPath: join(directory, "photo.svg"), options: {
        calibration: { startX: 0, startY: 0, endX: 50, endY: 0, lengthMm: 25 }, smoothing: 0,
      },
    } });
    expect(traced.isError).not.toBe(true);
    expect(traced.structuredContent).toMatchObject({ engine: "js", detectedComponents: 1, mmPerPixel: 0.5 });
    expect(stderr).toBe("");
  }, 15000);
});
