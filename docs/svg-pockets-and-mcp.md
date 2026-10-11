# SVG pockets and local automation

Import a closed SVG silhouette, specify the object's depth, and generate an
editable Pocketry project and printable STL/3MF files. The browser, CLI and MCP
wrapper share the importer; CLI and MCP share the planner, validators and export
kernel. The workflow accepts arbitrary calibrated silhouettes, with no
object-specific geometry or settings.

## SVG scale and supported outlines

Use physical canvas units such as `width="72mm"` with a `viewBox`. Pocketry reads
the artwork's bounds, so canvas margins do not enlarge the pocket. For an SVG
without physical scale, provide `--svg-width MM` or MCP `widthMm`: this is the
width of the **artwork**, excluding canvas margins. The other axis scales
proportionally. Verify these dimensions before printing.

Paths, rectangles, circles, ellipses, polygons, closed polylines, group transforms,
curves and compound-path holes are supported. A closed `fill="none"` path is
treated as an object's silhouette; stroke width does not thicken it. Curves use
adaptive sampling at 0.05 mm chord tolerance by default. SVG Y-down coordinates
are converted once into centred, Y-up millimetres; pockets are not mirrored.

Open paths, touching/self-intersecting contours, text, images, nested viewports,
clipping/masks, external references and unsupported effects are rejected with
an error. Convert visible geometry to simple closed paths before importing.
The CLI/MCP file API limits SVG inputs to 2 MB and project inputs to 10 MB.
The browser SVG picker accepts files smaller than 5 MB.

## Browser import

In Bin, choose **Add → Import SVG pocket**, select a file, verify its displayed
artwork dimensions, enter a pocket depth and choose **Place in center**. An
optional object-width override calibrates an SVG without physical units. Each
import creates an independent editable pocket in the current project and keeps
the existing bin dimensions. Add or move finger access with the normal editor
controls, or import an automatically planned CLI/MCP project for its computed
bin size and access positions. SVG imports start with zero edge rounding to
preserve the supplied outline.

## Command-line use

Install dependencies with Node.js 22 and `npm ci`, then run the included generic
64 × 24 mm outline:

```sh
npm run export:bin -- --svg examples/svg-pocket/tool-outline.svg \
  --object-depth 9 --object-height 16 --finger-access sides --out exports/tool
```

`--object-depth` is required for SVGs and describes how much of the body should
sit in the pocket. `--object-height` describes the tallest part measured from
the pocket floor and defaults to the body depth. A protruding handle or button
can therefore sit above the pocket deck while still clearing the next bin.

The planner searches full 42 mm grid footprints, 0.5° orientations and the exact
oriented-bounding-box alignment, choosing the smallest feasible cell area among
those candidates. It uses whole 7 mm height units, lowers the solid-fill deck to
the requested depth, and validates wall and stacking-lip clearance. The nominal
Gridfinity mating plane determines object-height clearance. The printed lip's
additional height is not counted as usable space.

Defaults for this workflow:

| Setting | Default |
| --- | --- |
| Stacking lip | Standard Pocketry lip |
| Label tab / raised text | None |
| Magnet/screw holes | Off |
| Gridfinity feet | Standard native profile |
| XY pocket clearance | 0.3 mm per side |
| Depth clearance | 0.2 mm |
| Minimum stacking clearance | 0.8 mm |
| Pocket floor Z from base bottom | 7 mm native base top |
| Finger access | Two 18 mm round openings on the object's long sides |
| Extension past cleared silhouette | 4 mm |
| Finger depth | Pocket depth minus 1 mm, at least 1 mm, up to 120 mm |
| Pocket/finger edge fillets | 0 mm to preserve the supplied fit |

`--floor MM` can reduce the requested floor Z to 5.95 mm (4.75 mm base profile
plus 1.2 mm of material) or increase it. This is an absolute Z position, not a
wall thickness. A higher object, thicker floor or deeper pocket may increase the
required height. The reported summary gives actual floor, deck, object top and
stacking clearance.

Side finger openings can require a wider bin. They are included in sizing;
the planner preserves the wall and stacking lip instead of silently clipping
access openings. Select `--finger-access ends`, `both`, or `none` to compare.
Automatic sides/ends follow the object's oriented bounding box, not the final
bin axes. Openings are checked against the actual silhouette, including holes.

Inspect before exporting, with no filesystem writes:

```sh
npm run --silent export:bin -- --svg examples/svg-pocket/tool-outline.svg \
  --object-depth 9 --object-height 16 --finger-access sides --plan
```

For exact placement, custom centres are **bin-local millimetres, Y-up, with the
origin at the bin centre**. They remain fixed when the pocket rotates:

```sh
npm run export:bin -- --svg examples/svg-pocket/tool-outline.svg \
  --object-depth 9 --rotation 0 --finger-access custom \
  --finger-center 0,11 --finger-center 0,-11 --finger-diameter 12
```

Supply `GRIDXxGRIDYxUNITS` alongside the SVG to fix dimensions. Infeasible sizes
are rejected. Use `--rotation DEGREES` to set a CCW angle, or `--no-auto-rotate`
to retain the imported orientation. `--finger-extension`, `--finger-depth`,
`--clearance`, `--depth-clearance` and `--stacking-clearance` override their
corresponding millimetre values. Run `npm run export:bin -- --help` for syntax.

Outputs include a binary STL, millimetre 3MF and `.pocketry.json`. Import the
project into the browser to edit its pockets and independent finger access.
The normal editor supports multiple SVG imports/pockets; headless planning
creates one pocket object containing all filled silhouettes in one SVG.
To export an existing multi-pocket design, including its saved material and
text settings:

```sh
npm run export:bin -- --project path/to/design.pocketry.json --out exports/design
```

Use `--name STEM` to choose artifact filenames and `--json` for a machine-readable
result. The existing empty-bin command remains available:

```sh
npm run export:bin -- 2x3x6
```

## MCP server

Start the local server with:

```sh
npm run --silent mcp
```

The server uses stdio and writes protocol messages only to stdout. Add it to an
MCP client using an absolute checkout path:

```json
{
  "mcpServers": {
    "pocketry": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/pocketry", "run", "--silent", "mcp"]
    }
  }
}
```

| Tool | Action |
| --- | --- |
| `pocketry_inspect_svg` | Read/calibrate a local SVG and report its dimensions and outline |
| `pocketry_plan_svg_bin` | Return a validated editable project and sizing summary without writing files |
| `pocketry_export_svg_bin` | Build and write STL, 3MF and editable project files |
| `pocketry_export_project` | Export an existing Pocketry project through the same kernel |

SVG tools accept `svgPath`, optional artwork `widthMm`, and optional `name`.
Planning/export accept an `options` object using the shared planner schema:

```json
{
  "svgPath": "/absolute/path/to/tool-outline.svg",
  "options": {
    "objectDepthMm": 9,
    "objectHeightMm": 16,
    "fingerAccess": { "placement": "sides", "diameterMm": 12 }
  },
  "outDir": "/absolute/path/to/exports"
}
```

`pocketry_export_svg_bin` also accepts `exportName` for the filename stem.
Custom access uses `fingerAccess: {"placement":"custom","centers":[{"x":0,"y":11}]}`.
For asymmetric requirements the schema allows `gridX`, `gridY` and `heightUnits`
individually; omitted dimensions remain automatic. The tools report input and
geometry errors before writing export files. They operate locally and do not
slice models or control printers.

## Validation

```sh
npm run check
npm test
npm run build
```

Tests cover physical SVG scale, transforms, curve sampling, topology and
unsupported inputs; automatic sizing, side/end/custom grips, depth and stacking
clearance; real geometry exports and project round trips; and MCP protocol
discovery, tool calls and error handling. Printable export validates oriented
closed mesh topology at the Float32 boundary. Physical fit and gripping comfort
still require a test print with the selected nozzle, material and clearances.

The fork keeps `main` aligned with upstream and development on
`feature/svg-pocket-mcp`. Verification runs locally; GitHub Actions remains
disabled. The MCP SDK, XML parser and path normalizer are documented in `NOTICE`.
See the [verification record](svg-pocket-verification.md) for the completed
test, build, browser and real-export checks.
