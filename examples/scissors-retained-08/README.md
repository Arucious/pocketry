# Combined scissors 08: exposed spring leaves

One complete 6 × 2 × 3u bin for both scissors. This revises the spring wall
integration from revision 07; its contact points and central seating profiles
are retained. The larger pocket remains mirrored for logo-up storage. Both
pockets retain 0.60 mm edge clearance, the notched stacking lip, refined
magnets, bridge rounding and blended finger-access joins.

The old spring stem sat 0.2 mm behind the finished pocket wall. The rounded
nose reached the nominal blade side, but the stem was buried in a sharp
rectangular housing with only 0.25 mm front clearance below the seat. Each
stem now sits 0.6 mm farther toward the opening: its face protrudes 0.4 mm
past the finished wall, remaining 0.2 mm behind the nominal blade side.
The nose stays at its previous contact position with 0.10 mm nominal overlap.

The release well has at least 0.80 mm front clearance, rounded rear corners,
flared side returns and a shallow entry bevel. The rounded nose is clipped
flush to the beam at the rear, preserving the full 0.40 mm gap to its solid
backing stop. Local edge relief exposes the lower leaf beside the shallow
blade seat; the central blade supports remain at their previous heights.
This relief changes a small strip of the pocket floor near each spring.

Both leaves retain the backed preset: 5 mm width, 10 mm height, 1.2 mm beam,
1.6 mm tapered root and 0.8 mm contact radius. Roots stay at Z 7, tops at Z 17
and contact centres at Z 15.5, approximately 1.99 mm above the local blade floor.
The rear stops extend through the leaf height; the top bevel starts above it.

## Reproduce

With the existing Node 22 dependencies, run from the repository root:

```sh
npx tsx examples/scissors-retained-08/build.ts
```

The recipe applies `operation.json` to the committed revision 06, replacing
its old triangular joining cutters. It produces full-bin STL, single-object
3MF, editable project, CAD section views and verification report under
`exports/scissors-retained-08/`. The committed editable result is
`revision-08.pocketry.json`. Revision 07 remains a historical artifact; its
original builder is available at commit `e1fea39`.

The ordinary `export:bin` CLI was also exercised with this saved project.
The STL and 3MF contain model geometry, not a sliced printer job. Use either
at 100% scale, feet down, with the established PETG and 0.6 mm nozzle preset.

## Verification

The recipe checks one connected solid, 47,852 triangles, consistent winding
and exactly two opposite incidences per serialized STL coordinate edge.
The single-object 3MF uses millimetres and matches the STL triangle count.
The whole protected base below Z 7 and stacking lip remain intact.

Thirty-four spring probes check the beam, root, side and rear gaps, open tops,
backing, front relief and contact reach. Twelve central-floor probes check
both blade seats. Severing the model above both root tapers yields three
components: the body and two independent leaves. A 0.3 mm outward warp clears
fixed material above the roots; this is a geometric proxy, not a force model.

General placement remains available through the [UI and CLI spring controls](../../docs/wall-springs.md).
The wall picker shows the actual rounded release outline and beam footprint.
Physical contact, insertion feel and fatigue life still need checking with
the scissors. Bead `pocketry-70c` tracks this correction; `pocketry-8it` tracks
the physical follow-up, including the mirrored large-scissors seat.
