# Blended finger-access joining chamfers

Select finger access in Bin and set **Joining chamfer**. This cuts back the
vertical material cusps where the access opening joins its pocket or another
access opening. It extends to the local floor; it does not taper the entire
circular wall. The independent **Top chamfer** still controls the opening's
45-degree entry bevel.

Set **Blend into walls** above zero to ease the two ends of the joining bevel
into adjacent wall curves. Both end tangents follow the actual neighboring
polygon edges; the centre retains a straight chamfer. A zero blend preserves
the planar bevel. Runout is limited to 40% of the available bevel length at
each end so the two blends cannot cross or erase the central section.

For example, 1.2 mm joining cutbacks with 0.5 mm runouts soften the abrupt ends
of the former triangular reliefs. Native geometry detects the actual cusps in
the union of the pocket and its access openings, rather than beveling every
small facet around a circle. Cutters overlap the existing empty cavity to
avoid zero-width contacts at the old cusp.

The same `edit:features` CLI accepts:

```json
{"fingerAccess":[{"id":"access-1","joiningChamferMm":1.2,"joiningBlendMm":0.5}]}
```

```sh
npm run edit:features -- --project bin.pocketry.json --operation joins.json --out blended.pocketry.json
```

Finger-access edits patch only these fields. They can be combined with pocket
spring replacements in one operation. Save, undo and linked copies preserve
the values. Older projects acquire neither a chamfer nor a blend.

Relief requires flat-bottom access next to an untilted blind pocket. Ramp
following uses the same native floor mask as the main pocket and finger
access, including the fixed minimum depth. Validation conservatively reserves
the cutback plus blend around the opening when checking the bin boundary and
stacking lip. Springs also avoid this larger access envelope. The protected
base checks still apply; native regression probes verify retained material
below the local ramp floor.

For old designs with explicit triangular auxiliary pockets, remove those
auxiliaries when enabling the new relief: an additional smooth cutter cannot
restore material that the old cutter has already removed. Keep unrelated
bridge rounding features as needed. The scissors evaluation follows this rule.
