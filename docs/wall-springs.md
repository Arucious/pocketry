# Backed wall springs

In Bin, select a pocket and open **Spring retainers → Add wall spring**. Click
any regular contour span to position the anchor; the numeric source-contour
distance provides the same control from the keyboard. Zoom to the spring to
inspect the housing. Red circles mark finger-access exclusions. Apply commits
one undoable edit; Cancel leaves the project untouched. Existing leaves can be
edited or removed from the same section.

For the CLI, write an operation JSON file containing complete spring lists:

```json
{"pockets":[{"id":"scissors-2","springs":[{"id":"blade-retainer","atMm":240}]}]}
```

```sh
npm run edit:features -- --project bin.pocketry.json --operation springs.json --plan
npm run edit:features -- --project bin.pocketry.json --operation springs.json --out retained.pocketry.json
npm run export:bin -- --project retained.pocketry.json --out exports/retained
```

`--plan` prints the resulting project and validation issues without creating
files. Output creation is exclusive: existing files and the input cannot be
overwritten. An empty spring list removes the pocket's retainers. The saved
project can then be exported normally or opened in the UI.

Optional retainers belong to a pocket's `springs` list. Each anchor names a
shape, outer/hole ring and arc distance from its first vertex. Distances along
the source ring are measured before scaling; width, height, backing gap and
contact overlap remain physical millimetres. Rotating or mirroring a pocket
also moves its springs. Linked pockets share the list; project save and undo
retain it. Old projects acquire no springs.

```json
{"id":"blade-retainer","shapeIndex":0,"ringIndex":-1,"atMm":40,
 "widthMm":5,"heightMm":10,"rootFloorMm":7,
 "travelMm":0.4,"interferenceMm":0.1}
```

The preset follows the owner's successful lighter **side** leaves: 1.2 mm
beam, 1.6 mm reinforced root, 1 mm root band, a taper finishing 2 mm above
the root, a 0.3 mm entry bevel and a 0.8 mm rounded capsule contact. It is an
independent Manifold implementation of those dimensions and mechanical
arrangement, rather than a port of the other project's Python/OpenSCAD code.
Reference: [side-leaf observations and design dimensions](https://github.com/Arucious/gridfinity-bins/blob/d2f0baa1170cecec54ea9218bb2e284e47dea52b/docs/spring-fingers.md).
The short unbacked end fingers broke in that project; they are not the preset.

The beam starts 0.2 mm behind the clearance-adjusted wall. Its capsule reaches
past the *nominal* tool outline by the requested overlap, compensating for the
pocket's fit clearance. One-millimetre side gaps release the beam. A nearby
solid wall through the entire leaf height limits outward motion. The backing
gap is a geometric distance, not a force or calibrated maximum deflection.

The release slot can extend below the tool's seating floor. This allows a
full-length leaf beside a shallow blade without deepening the blade seat or
using a short stiff finger. `rootFloorMm` is absolute Z above the bin underside;
the default retains the whole 7 mm Gridfinity base. The default contact centre
is Z 15.5 mm (1.5 mm below the leaf top), which must be above the local floor.
The UI reports contact height above that floor; match it to the actual device.

Validation rejects inadequate filled-wall height, roots inside the protected
base, contacts below a ramp, sharply bending wall spans, tilted/through/profile
objects, nonzero plan corner rounding, insufficient external-wall backing,
overlapping housings and other pockets. Finger access is excluded using its
entire opening, entry flare and a 0.25 mm margin, not just the anchor point.
Native CAD additionally checks the actual backing and the floor attachment
before adding a leaf. Preview, STL and 3MF use the same builder.

The minimum 10 mm total leaf height preserves 8 mm above the root taper.
It is not automatically shortened to fit an unsuitable pocket. These checks
establish geometry and print continuity; contact force, repeated use and the
fit on a new device still need a physical trial. Keep the established PETG,
0.6 mm nozzle and two-wall slicing preferences when evaluating this preset;
the generator does not set a slicer's toolpaths.
