# Local curve refinement

Use **Edit contour → Refine curve** in Bin, or **Refine curve** while editing a
selected Trace contour. Click two points, or enter their zero-based indices.
Forward/backward chooses either path between them, including across the contour
seam. The orange outline is the original; blue is the preview. **Zoom to span**
shows the selected region. Cancel changes nothing; Apply creates one undoable edit.

- **Smooth existing curve** reduces local tracing noise with uniformly spaced
  arc-length samples and paired shrink/expand passes.
- **Fit circular arc** finds a circle through both endpoints using the selected
  data. **Fit ellipse arc** fits a rotated ellipse; short or ill-conditioned
  spans can be refused rather than inventing an unreliable curve.
- Maximum movement limits displacement of every vertex. Strength blends the
  candidate with the original. Consequently a limited/blended fit need not be a
  mathematically exact circle or ellipse. Fitted ellipse axes are semi-axis lengths.
- Endpoints stay fixed. **Keep endpoint directions** also pins the adjacent point
  at each end; the transition fades into the untouched contour.
- **Only enlarge pocket** allows outward movement of outer boundaries and inward
  movement of hole boundaries. A final containment check rejects edits that would
  narrow any part of the selected pocket. Crossed/collapsed contours are rejected.

Distances in Bin and project CLI operations are source millimetres, before pocket
scaling. Trace converts calibrated pixels to millimetres; an uncalibrated trace
shows pixel units. The bin preview blocks existing layout validation errors,
including wall breaches and depth stations extending beyond the edited outline.
This feature stores ordinary immutable outline revisions; no project-format
change or new geometry dependency is needed.

## CLI

```powershell
npm run refine:curve -- --project original.pocketry.json --pocket scissors-1 --start 120 --end 165 --method arc --max-change 0.25 --outward-only --plan
npm run refine:curve -- --project original.pocketry.json --pocket scissors-1 --start 120 --end 165 --method arc --max-change 0.25 --outward-only --out revised.pocketry.json
```

These indices are illustrative: inspect the actual saved ring in the preview.
`--shape-index` selects a component; `--ring-index -1` means its outer boundary,
and `0` means its first hole. `--free-end-directions` releases the adjacent-point
pins while keeping both endpoints fixed. `--strength` and `--iterations` match the
preview. `--path backward` selects the other direction around the ring.

Alternatively pass `--operation edit.json` containing the shared options:

```json
{"shapeIndex":0,"ringIndex":-1,"startIndex":120,"endIndex":165,"direction":"forward","method":"smooth","iterations":16,"strength":1,"maxDeviation":0.25,"preserveTangents":true,"outwardOnly":true}
```

Plan mode writes no files. Write mode requires a new output path and preserves
the input, old immutable shapes, calibration, placements, depths, linked copies,
and undo history. Export the revised project with the existing `export:bin` CLI.
