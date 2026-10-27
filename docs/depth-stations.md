# Multiple pocket depths and transitions

Use **Depth stations** in a selected pocket's properties to support a tool with
several thicknesses. Choose X (left to right) or Y (bottom to top), then add
stations with a position and a depth. The side diagram shows the floor; dashed
guides in Layout show station positions on the selected, untilted pocket.

Positions are millimetres from the minimum edge of the original outline, before
resizing. Rotation and mirroring carry the entire profile with the pocket.
The first station is always at 0 mm. Positions must increase and stay within
the outline. Up to 64 stations can be stored per pocket. The final station's
depth continues to the end of the outline.

Each station's **To next** control describes the interval to the next station:

- **Sharp step** holds its depth throughout the interval and jumps at the next
  station. There is no dividing wall.
- **Straight ramp** changes depth at a constant slope.
- **Smooth blend** changes depth with a smoothstep curve, flat at both ends and
  without overshooting either depth.

For example, to hold an 11 mm handle seat until 25 mm, smoothly reach a 5 mm
blade seat at 45 mm, and make a sharp change to 3 mm at 60 mm:

| Position | Depth | To next |
| --- | --- | --- |
| 0 mm | 11 mm | Sharp step |
| 25 mm | 11 mm | Smooth blend |
| 45 mm | 5 mm | Sharp step |
| 60 mm | 3 mm | To end |

Add equal-depth stations to specify exactly where a flat section ends and a
ramp begins. **Add station** inserts in the largest existing interval; edit its
position afterward. Remove intermediate stations with ×. **Use one depth**
removes the profile and keeps the deepest fixed depth. Edits support undo,
redo, linked copies, project saves and backups.

Depth profiles use fixed depths from the pocket top, not cumulative cuts. A
rigid pocket retains its authored thickness and lowest-point elevation during
movement and rotation. Profiles can be tilted and use insertion clearance.
Existing two-section splits remain available; remove a split before adding
stations. Bottom-edge fillets are disabled for profiles: use station transitions
to shape the floor. Outline corner rounding, fit clearance and top rounding
still apply. Contour edits never silently move stations; if an outline becomes
shorter than its last station, validation asks you to move that station inward.

## Saved projects and geometry

Project schema 37 adds optional `CutoutPlacement.depthProfile`. Older projects,
including two-depth splits, load without changing their geometry. Profiles are
preserved in history, project libraries, linked designs, and transform origins.
STL and 3MF encode the actual stepped or ramped floor. SVG/DXF remain top-down
templates. Smooth blends use linear facets with at most 0.01 mm vertical chord
error, identically in previews, rigid placement and exports.

## CLI

Inline stations use `POSITION:DEPTH[:TRANSITION]`. The transition defaults to
`step`; available names are `step`, `linear`, and `smooth`. X is the default axis.
The following outline is 64 mm long, so the stations fit its X dimension:

```sh
npm run export:bin -- --svg examples/svg-pocket/tool-outline.svg \
  --object-depth 11 --depth-axis x \
  --depth-station 0:11:step --depth-station 25:11:smooth \
  --depth-station 45:5:step --depth-station 60:3 \
  --out exports/stepped-tool
```

Alternatively save this as `profile.json`:

```json
{
  "axis": "x",
  "stations": [
    { "atMm": 0, "depthMm": 11, "transition": "step" },
    { "atMm": 25, "depthMm": 11, "transition": "smooth" },
    { "atMm": 45, "depthMm": 5, "transition": "step" },
    { "atMm": 60, "depthMm": 3, "transition": "step" }
  ]
}
```

```sh
npm run export:bin -- --svg examples/svg-pocket/tool-outline.svg \
  --object-depth 11 --depth-profile profile.json --plan
```

Choose either a file or inline stations. The JSON file is limited to 128 KiB.
`--object-depth` must include the deepest station; `--object-height` can separately
reserve stacking clearance for a taller feature. `--depth-clearance` is added
once to every station when planning from an SVG. An existing `.pocketry.json`
already contains final depths, so `--project` exports it unchanged.

## MCP

`pocketry_plan_svg_bin` and `pocketry_export_svg_bin` accept the identical JSON
object as `options.depthProfile`, alongside `objectDepthMm`. Their shared schema
validates stations before planning. The returned summary reports the actual
profile including depth clearance. `pocketry_export_project` reads profiles from
saved projects; no separate geometry implementation is used.

## Finger access at a ramp

Enable **Follow nearest ramp** in a flat-bottom finger access feature. Its floor
follows the closest profiled pocket across the opening instead of leaving a
constant-height ledge. The requested depth is a minimum: a deeper ramp extends
the cut. The reported range and floor check include the entire opening, its
placement, scaling and the pocket's vertical offset. Tilted pockets, missing
profiles and distant openings are rejected. Curved access bottoms must first
be changed to flat bottoms.

**Top chamfer** adds a continuous 45° entry bevel and replaces top-edge rounding.
Ramp-following cuts must retain the entire 7 mm Gridfinity base, or at least
1.2 mm on a flat-bottom bin; unsafe exports are blocked rather than clipped.
Existing fixed-depth finger access remains unchanged.

CLI SVG planning accepts `--finger-follow-ramp --finger-chamfer 0.5` alongside a
depth profile. MCP uses `options.fingerAccess.depthMode: "nearest-profile"` and
`topChamferMm`. Both settings also round-trip in editable projects and history.
