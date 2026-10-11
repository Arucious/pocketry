# SVG pocket and MCP verification

Local verification on 2026-10-11, using Node.js 22.23.3 and npm 10.9.9.
The implementation builds on upstream commit
`8146b250206b5411327f32adecbbe0d0c2bc05a9`.

## Required gates

| Command | Result |
| --- | --- |
| `npm ci` | Clean installation succeeded |
| `npm run check` | TypeScript check passed |
| `npm test -- --maxWorkers=4 --testTimeout=30000` | 179 files, 3,122 tests passed |
| `npm run build` | Production client and server build passed |

The production build retains Vite's existing large-chunk advisory. Tests use a
bounded worker count and a 30-second per-test limit for the geometry cases.
GitHub Actions remains disabled; these checks ran locally.

## End-to-end checks

- The committed generic 64 × 24 mm outline, with a 9 mm body depth, 16 mm
  maximum object height and default side access, exports a 2 × 1 × 4 bin.
  Its dimensions are 83.5 × 41.5 × 31.5515 mm, with 5 mm clearance below the
  nominal stacking plane. STL, 3MF and editable project files were generated.
- A compound-path outline with an interior hole exports a 2 × 1 × 4 bin with
  end access. Import reports one component and one hole; the exporter accepts
  the geometry. Automated importer and planner tests cover hole preservation
  and finger-access overlap with the actual silhouette.
- An actual stdio MCP client discovers all four tools, exports the generic
  outline with two custom access centres, and re-exports its saved project.
  The original and re-exported STL and 3MF files are byte-identical.
- The browser SVG picker reads the generic artwork as 64 × 24 mm despite its
  canvas margins and creates an editable pocket at the entered depth. Importing
  the MCP-generated project displays its 2 × 1 × 4 bin, one pocket, two finger
  access objects, no labels, and an export-ready state.
- Independent `trimesh` checks of the generic side-access, compound-path and
  MCP custom-access STL files confirm watertight topology, consistent winding,
  a single connected component, positive volume and expected outer dimensions.

Generated validation artifacts and browser screenshots remain local under the
ignored `exports/` directory. The repository fixture and examples are generic;
there are no object-specific dimensions, filename checks or geometry branches.

These checks validate software and exported geometry. They do not establish
physical fit, finger comfort or print quality for a particular printer.

See [SVG pockets and local automation](svg-pockets-and-mcp.md) for options and
MCP client configuration.
See [upstream compatibility validation](upstream-compatibility.md) for the
subsequent baseline comparison, permanent legacy-export regressions and limits.
