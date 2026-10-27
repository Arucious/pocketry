/** Export empty bins, SVG pocket bins, or saved projects through the same kernel. */
import { parseBinSpec } from "../shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION, projectDocSchema } from "../shared/gridfinity/project";
import { exportProject, readDepthProfileFile, readProjectFile, readSvgBin } from "./lib/export-bin";
import { EXPORT_USAGE, parseExportArgs } from "./lib/export-args";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--help") { console.log(EXPORT_USAGE); return; }
  const cli = parseExportArgs(argv);
  if (cli.depthProfilePath) cli.svgOptions.depthProfile = await readDepthProfileFile(cli.depthProfilePath);
  const planned = cli.svgPath ? await readSvgBin(cli.svgPath, cli.svgOptions, { widthMm: cli.svgWidthMm }) : undefined;
  if (cli.planOnly && planned) {
    console.log(JSON.stringify(planned, null, 2));
    return;
  }
  const project = planned?.project ?? (cli.projectPath
    ? await readProjectFile(cli.projectPath)
    : projectDocSchema.parse({ schemaVersion: PROJECT_SCHEMA_VERSION, spec: parseBinSpec(cli.spec), shapes: [], cutouts: [], fingerHoles: [] }));
  const spec = project.spec;
  const name = cli.name ?? `bin-${spec.gridX}x${spec.gridY}x${spec.heightUnits}`
    + (spec.fill === "solid" ? "-solid" : "") + (spec.lip === "none" ? "-nolip" : "");
  const result = await exportProject(project, cli.outDir, name);
  if (cli.json) { console.log(JSON.stringify({ ...result, ...(planned ? { summary: planned.summary } : {}) }, null, 2)); return; }
  console.log(`Exported ${spec.gridX}×${spec.gridY}×${spec.heightUnits}: ${result.dimensions.widthMm} × ${result.dimensions.lengthMm} × ${result.dimensions.totalHeightMm.toFixed(2)} mm`);
  if (planned) console.log(JSON.stringify(planned.summary, null, 2));
  console.log(`${result.triangles} triangles, ${result.volumeCm3.toFixed(2)} cm³ of model volume`);
  for (const issue of result.warnings) console.warn(`[${issue.code}] ${issue.message}`);
  for (const path of Object.values(result.paths)) console.log(path);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Use --help for usage.");
  process.exitCode = 1;
});
