import { mkdir, open, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import { importSvgShape } from "../../shared/geometry/svg-import";
import { planSvgBin, type SvgBinPlan } from "../../shared/gridfinity/svg-bin";
import { parseProjectDoc, serializeProjectDoc, type ProjectDoc } from "../../shared/gridfinity/project";
import { validateBinSpec, validateLayout, type ValidationIssue } from "../../shared/gridfinity/validate";
import { binDimensionsMm, buildBinWithCutouts, EXPORT_QUALITY } from "../../client/src/lib/gridfinity/bin";
import { writeBinarySTL } from "../../client/src/lib/export/stl-writer";
import { Arena } from "../../client/src/lib/manifold/arena";
import type { Kernel } from "../../client/src/lib/manifold/runtime";
import { extractPrintableMeshData } from "../../client/src/lib/mesh/mesh-data";
import { writeThreeMf, type ThreeMfObject } from "../../client/src/lib/mesh/threemf";

export interface ExportResult {
  paths: { stl: string; threeMf: string; project: string };
  dimensions: ReturnType<typeof binDimensionsMm>;
  volumeCm3: number;
  triangles: number;
  warnings: ValidationIssue[];
}

let runtime: Promise<ManifoldToplevel> | undefined;

/** Node owns WASM loading; the browser/worker and Node inject the same kernel. */
async function loadNodeRuntime(): Promise<ManifoldToplevel> {
  runtime ??= Module({
    locateFile: () => createRequire(import.meta.url).resolve("manifold-3d/manifold.wasm"),
  }).then(wasm => { wasm.setup(); return wasm; });
  return runtime;
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<string> {
  const file = await open(path, "r");
  const tooLarge = () => new Error(`File exceeds ${maximumBytes / 1024 / 1024} MB: ${path}`);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error(`Expected a file: ${path}`);
    if (info.size > maximumBytes) throw tooLarge();
    // Read from this handle, at most limit + 1 bytes even if the file grows.
    const buffer = Buffer.alloc(maximumBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maximumBytes) throw tooLarge();
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    await file.close();
  }
}

/** Shared CLI/MCP boundary: SVGs remain local, with a bounded input size. */
export function readSvgFile(path: string): Promise<string> {
  return readBoundedFile(path, 2 * 1024 * 1024);
}

/** Read existing versioned Pocketry projects through their normal migration gate. */
export async function readProjectFile(path: string): Promise<ProjectDoc> {
  const project = parseProjectDoc(JSON.parse(await readBoundedFile(path, 10 * 1024 * 1024)));
  if (!project) throw new Error("Invalid or unsupported Pocketry project.");
  return project;
}

/** Import and plan without building a mesh or creating any files. */
export async function readSvgBin(
  svgPath: string,
  options: unknown,
  importOptions: { widthMm?: number; name?: string } = {},
): Promise<SvgBinPlan> {
  const svgText = await readSvgFile(svgPath);
  const name = importOptions.name ?? basename(svgPath).replace(/\.svg$/i, "");
  // Shapes are immutable by id in Pocketry. Different SVGs or calibrations
  // must never share the preview cache/library key when projects are switched.
  const id = `svg-${createHash("sha256").update(svgText)
    .update(JSON.stringify({ widthMm: importOptions.widthMm, name })).digest("hex")}`;
  const shape = importSvgShape(svgText, {
    ...importOptions,
    name, id,
  });
  return planSvgBin(shape, options);
}

function exportName(project: ProjectDoc, requested?: string): string {
  const name = requested ?? `gridfinity-bin-${project.spec.gridX}x${project.spec.gridY}x${project.spec.heightUnits}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(name) || name.includes("..")) {
    throw new Error("Export name must be a filename stem (letters, digits, dash, underscore or dot; no paths).");
  }
  return name;
}

/** Build, validate and serialize before writing; every WASM handle is scoped. */
export async function exportProject(
  input: ProjectDoc,
  outDir: string,
  requestedName?: string,
): Promise<ExportResult> {
  const project = parseProjectDoc(input);
  if (!project) throw new Error("Invalid or unsupported Pocketry project.");
  if (new Set(project.shapes.map(shape => shape.id)).size !== project.shapes.length) {
    throw new Error("Project shape ids must be unique.");
  }
  const name = exportName(project, requestedName);
  const shapesById = new Map(project.shapes.map(shape => [shape.id, shape]));
  const issues = [
    ...validateBinSpec(project.spec).issues,
    ...validateLayout(project.spec, project.cutouts, shapesById, project.fingerHoles),
  ];
  const assertValid = (found: readonly ValidationIssue[]) => {
    const errors = found.filter(issue => issue.severity === "error");
    if (errors.length) throw new Error(errors.map(issue => issue.message).join("\n"));
  };
  assertValid(issues);
  const wasm = await loadNodeRuntime();
  const arena = new Arena();
  try {
    const kernel: Kernel = { CrossSection: wasm.CrossSection, Manifold: wasm.Manifold, triangulate: wasm.triangulate, arena };
    const materials = project.materials;
    const built = buildBinWithCutouts(kernel, project.spec, {
      shapesById, cutouts: project.cutouts, fingerHoles: project.fingerHoles,
    }, EXPORT_QUALITY, {
      floorInsertThicknessMm: materials?.colorPocketFloors ? materials.pocketFloorThicknessMm : undefined,
      rimInsertThicknessMm: materials?.colorStackingRim ? materials.stackingRimThicknessMm : undefined,
      borderWidthMm: materials?.borderWidthMm,
    });
    assertValid(built.validationIssues);
    const solid = built.solid;
    if (solid.isEmpty() || solid.status() !== "NoError" || solid.volume() <= 0) {
      throw new Error("The bin did not produce a valid, nonempty printable solid.");
    }
    const mesh = extractPrintableMeshData(kernel, solid);
    const objects: ThreeMfObject[] = [];
    const addPart = (partName: string, part: Manifold | null, color?: string) => {
      if (!part || part.isEmpty()) return;
      objects.push({ name: partName, mesh: extractPrintableMeshData(kernel, part),
        ...(color ? { material: { name: partName, displayColor: color as `#${string}` } } : {}),
      });
    };
    if (built.materialParts) {
      addPart("Bin body", built.materialParts.body, materials?.binColor);
      addPart("Pocket floors", built.materialParts.pocketFloors, materials?.pocketFloorColor);
      addPart("Stacking rim", built.materialParts.stackingRim, materials?.stackingRimColor);
    } else {
      addPart("Bin body", built.bodySolid, materials?.binColor);
    }
    for (const part of built.textParts) {
      addPart(part.label.name ?? part.label.text, part.solid, project.spec.textColor ?? materials?.stackingRimColor);
    }
    const threeMf = writeThreeMf(objects, { title: project.name ?? name, assemble: objects.length > 1 });
    const stl = new Uint8Array(writeBinarySTL(mesh));
    const projectJson = JSON.stringify(serializeProjectDoc(project), null, 2) + "\n";
    const directory = resolve(outDir);
    const paths = { stl: join(directory, `${name}.stl`), threeMf: join(directory, `${name}.3mf`), project: join(directory, `${name}.pocketry.json`) };
    await mkdir(directory, { recursive: true });
    await writeFile(paths.stl, stl);
    await writeFile(paths.threeMf, threeMf);
    await writeFile(paths.project, projectJson);
    return {
      paths, dimensions: binDimensionsMm(project.spec), volumeCm3: solid.volume() / 1000,
      triangles: mesh.indices.length / 3,
      warnings: [...issues, ...built.validationIssues].filter(issue => issue.severity === "warning"),
    };
  } finally {
    arena.dispose();
  }
}
