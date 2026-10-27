# Refined magnets and notched stacking lip

In **Construction**, choose **Refined magnets + notched lip** to apply an
explicit preset. Existing projects and generic new-bin defaults are preserved.
The preset keeps the standard native Gridfinity feet, stacking height and
lower lip support. Per-cell receiving relief leaves webs at grid boundaries
so smaller native bins can stack on the rim. Full 42 mm pitch is required.

The base uses corner-only side-entry pockets for 6 × 2 mm magnets:

| Setting | Preset |
| --- | --- |
| Nominal pocket diameter | 6.25 mm |
| Magnet thickness | 2.1 mm |
| Height allowance | 0.1 mm |
| Retaining skin | 0.4 mm |
| Side entry | Right, rotated around each corner |
| Removal relief | Auto |
| Friction crush depth | 0 mm |
| Screws, labels, standard crush ribs | Off |

The Construction controls expose diameter, thickness, skin, crush depth, side,
corner-only placement and removal relief. Settings persist in projects, history
and exports. Standard bottom-entry bores remain available independently.
Flat-bottom mode ignores all socket features. A solid base disables magnets.

The preset's dimensions are provisional. The cavity's bottom skin prevents
downward escape; sideways retention relies on fit and friction. Optional crush
depth adds eight friction contacts on the retained part of the bore. It is not
a snap latch. Confirm insertion, complete seating, retention and polarity
correction with the actual magnets before production use.

## Validation and geometry

- Invalid dimensions are rejected by shared schemas.
- Refined magnets reject fractional pitch, screw bores and standard crush ribs.
- At least 1.2 mm remains between the cavity ceiling and the top of the native
  4.75 mm foot. The 0.1 mm allowance and retaining skin count toward this check.
- Tool pockets with refined magnets and ramp-following access must stay above
  the 7 mm native base. Export blocks unsafe cuts rather than changing depth.
- Corner-only placement uses exposed convex corners, including custom connected
  footprints. Other sockets stay solid. The entries rotate toward exposed sides.
- Geometry tests probe the skin, cavity, side passages, extraction opening and
  untouched middle sockets. Stacking tests check every native foot against the
  notched rim. Float32 mesh checks run on final printable exports.

The native Manifold port adapts Gridfinity Extended at
`94d5a3e2d39e0b90894c042a255fc487cfcc9197`; see `NOTICE` for source and licence
provenance. Pocketry retains its existing foot/profile dimensions and lip height.
The removal relief preserves the skin centre and has a sloped roof. It is not
an exact copy of Extended's complete bin geometry or rounded removal roof.

## CLI and MCP

```sh
# Empty bin with the full preset.
npm run export:bin -- 6x2x3 --preset refined --out exports/scissors

# SVG pocket, with the same preset and a tuned diameter.
npm run export:bin -- --svg tool.svg --object-depth 11 \
  --preset refined --magnet-diameter 6.3 --out exports/tool

# Select the base and rim independently.
npm run export:bin -- 2x1x3 --base-style refined-magnets --lip-notches
```

`--base-style` also accepts `solid`, `standard-magnets` and `flat`. Refined tuning
flags are `--magnet-diameter`, `--magnet-thickness`, `--magnet-skin`,
`--magnet-crush-depth`, `--magnet-side left|right`, `--magnet-release auto|off`
and `--magnet-placement corners|all`. Use these with a refined base. Exporting
`--project` uses its saved settings and rejects construction overrides.

The shared MCP SVG planner/exporter accepts `options.baseStyle`,
`options.lipNotches` and `options.refinedMagnet`, with keys `diameterMm`,
`thicknessMm`, `captiveHeightMm`, `crushDepthMm`, `sideAccess`, `easyRelease`
and `cornerOnly`. Omitted refined values use the preset above. Saved-project
exports preserve the same schema and use the same native geometry.
