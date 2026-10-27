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
