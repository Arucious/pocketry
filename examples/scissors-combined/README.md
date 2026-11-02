# Combined scissors bin, revision 06

This is one complete 6 × 2 × 3u bin for both scissors, with the large pocket
mirrored to put its logo upward. It retains 0.60 mm clearance per edge, 32 mm
finger access, full-height bridge rounding and joining bevels, the notched
stacking lip, and refined side-entry magnets. Overall dimensions are
251.5 × 83.5 × 24.5515 mm.

The general curve tools live in separate commits. This directory contains only
the particular scissors design and its reproducible recipe, so an upstream
feature cherry-pick does not need these project files. `baseline-05.pocketry.json`
is the last physically evaluated bin; `settings.json` records the new operations.

## Reproduce

From the repository root with the existing Node 22 dependencies installed:

```sh
npx tsx examples/scissors-combined/build.ts
```

Outputs go to `exports/scissors-combined-06/`: editable project, full STL,
single-object 3MF, fit report, layout/profile diagram and curve comparison.
The 3MF contains model geometry, not a sliced printer job. Export directories
are ignored by Git. `revision-06.pocketry.json` is the committed editable result.

To lower the whole small seat by a measured amount while preserving its ramps:

```sh
npx tsx examples/scissors-combined/build.ts --small-lower 0.5 --out exports/scissors-combined-06-lower-05
```

`--small-lower` moves the small pocket floor, finger-access floor and all
auxiliary corner/bridge floors together. It does not alter the plan clearance or
large pocket. Zero is the default: the possible small-tool/rim interference has
not been measured yet. The existing UI's **Pocket → Rotate pocket → Elevation**
also moves a profiled pocket without flattening its ramps; custom auxiliary
pockets need the same vertical movement, which this recipe handles as a group.

## Changes and measurement limits

- Large loop: bounded circle fitting on source vertices 52–83 around the reported
  1–2 o'clock dip. Maximum movement 0.25 mm, enlargement only, pinned endpoints
  and adjacent points. The fitted radius is 28.51 mm, but blending and movement
  limits deliberately preserve a general curve rather than impose a perfect circle.
- Small tip: localized smoothing on 147–165 and 165–182, maximum movement
  0.10 mm, enlargement only. The actual apex remains fixed.
- Large seating: add a linear 4 mm rise over its 207.096 mm source length
  (approximately 1.11°), retaining the former local underside relief. This brings
  the blade up as part of the whole seat, rather than lifting a single contact
  that would pivot the tool. It is a shallow vertical-shear approximation to a
  pitched rigid tool, within the existing plan clearance. The tightest estimated
  measured top is C at Z 19.724, leaving 1.276 mm below the Z 21 wall top.
- Small seating: add 0.20 mm support over its last 35 mm. The blade floor no
  longer remains perfectly level at the far end. The handle seat remains at Z 11.
- Mirroring required renesting: large group shifts (−3, +8) mm and rotates
  +6.5°; small group shifts (−0.25, +0.25) mm. Both still fit the original 6 × 2
  bin, including a 1 mm separation reserve around the clearance-expanded tool
  outlines and flared finger-access openings.

Large closed-tool thickness readings were A1/A2 9.85, B 4.95, C 10.40,
D 6.70, E 4.25 mm. A1 was copied from A2 at the owner's request. Previous
underside gaps were approximately 1.90 mm below B and 0.90 mm near E; C/D
were confirmed zero. These underside gaps were taken with the logo facing
the other way. **Recheck seating on the logo-up face before treating this as a
physically verified fit.** Total thickness remains useful after a flip; underside
gaps can change. No small-tool total-thickness readings are available. Its old
blade gap was 2.71 mm; the 0.20 mm terminal correction removes the former
nominal support clearance at the tip.

## Verification

The recipe blocks shared validation errors and stacking-lip warnings, then
checks the actual native solid: the entire stacking lip and base below Z 7
remain intact, floor/cavity probes pass at 18 measured or near-tip locations,
and all ten auxiliary cutters retain material below their local floors. The
serialized STL must have two oppositely wound incidences at every coordinate
edge, form one connected solid, and match a single-object millimetre 3MF.
The fit report records results and SHA-256 hashes. The default and 0.5 mm
lowering variants were both checked. Over-deep lowering is rejected by the
protected-base check. Expected auxiliary/main overlap warnings describe the
intentional subtractive bevels; the two scissor groups do not overlap.
