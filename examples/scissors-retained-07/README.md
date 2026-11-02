# Combined scissors 07: backed retainers and blended joins

One complete 6 × 2 × 3u bin for both scissors. Revision 06's logo-up large
pocket, 0.60 mm edge clearances, both seating profiles, notched stacking lip,
refined magnets and full-height bridge rounding are retained.

Two opposing spring contacts act on the small blade around source Y 45 mm.
Each uses the backed-leaf preset: 5 mm width, 10 mm height, 1.2 mm free beam,
1.6 mm tapered root, a rounded 0.8 mm contact and 0.10 mm nominal overlap.
The root remains at Z 7, the leaf top at Z 17 and the contact centre at
Z 15.5, approximately 1.99 mm above the blade's local floor. Neither seat is
deepened. The released housing extends down behind the wall to Z 7, allowing
the full leaf length beside the shallow blade pocket. Side slots and the
0.4 mm rear gap stay open to the deck. Solid backing remains through the leaf
height; these are not unrestricted short end fingers.

The old eight triangular joining pockets are removed. Generated 1.2 mm
joining chamfers with 0.5 mm tangent runouts replace them, following the same
local floors. The central chamfer stays straight; both ends ease into the
neighboring wall curves. [General spring controls](../../docs/wall-springs.md)
and [joining controls](../../docs/joining-chamfers.md) are documented separately.

## Reproduce

From the repository root with the existing Node 22 dependencies:

```sh
npx tsx examples/scissors-retained-07/build.ts
```

This reads the previous committed project, removes only its old joining
auxiliaries, applies `operation.json` through the shared feature editor and
writes the full STL, single-object 3MF, editable project, native section diagram
and verification report under `exports/scissors-retained-07/`.
`revision-07.pocketry.json` is the committed editable result. The 3MF contains
geometry, not a sliced printer job. Print STL or 3MF at 100% scale, feet down.

The ordinary CLI was also exercised end to end: `edit:features` followed by
`export:bin`. Its serialized STL has two oppositely wound incidences at every
coordinate edge. The recipe checks this independently, plus one connected
solid, matching 3MF triangles, unchanged base below Z 7 and intact whole lip.
It probes root attachment, beam material, side/rear release gaps, open tops,
backing and contact reach on both leaves, and checks the retained blade floors.
A 0.3 mm cantilever-shaped outward warp clears fixed material above the roots.

## Physical follow-up

Geometry checks do not establish PETG force or fatigue life. The other
project's positive feedback concerned side leaves with wall backing; its
shorter end fingers broke. This bin preserves that backing mechanism, but
its actual contact height and insertion feel still need checking on the small
scissors. No small-blade thickness reading was supplied. Confirm that both
rounded noses touch the blade's side, allow full seating, release comfortably
and do not fuse to their backing. The large scissors' mirrored underside
seating still needs the revision 06 recheck.

Use the established 0.6 mm nozzle, PETG preset and two wall loops for the
physical evaluation. These files do not impose slicer settings or send a job
to a printer. Bead `pocketry-fhm` tracks the implementation; the physical
follow-up is recorded separately in beads.
