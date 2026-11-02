import type {Manifold} from "manifold-3d";
import type {Kernel} from "../manifold/runtime";
import {wallSpringIssues,springReleaseRing,type SpringPlan} from "@shared/gridfinity/wall-spring";
import {BACKED_LEAF as B} from "@shared/gridfinity/spring-schema";
import type {BinSpec} from "@shared/gridfinity/types";
import {infillTopZ} from "@shared/gridfinity/fill";
import type {CutoutPlacement,FingerHole,TracedShape} from "@shared/gridfinity/cutout";

function place(kernel:Kernel,solid:Manifold,plan:SpringPlan) {
  const {arena}=kernel,side=plan.tangent.x*plan.outward.y-plan.tangent.y*plan.outward.x;
  return arena.track(arena.track(arena.track(solid.scale([1,side,1])).rotate([0,0,Math.atan2(plan.tangent.y,plan.tangent.x)*180/Math.PI])).translate([plan.center.x,plan.center.y,0]));
}
function box(kernel:Kernel,plan:SpringPlan,u0:number,u1:number,v0:number,v1:number,z0:number,z1:number) {
  return place(kernel,kernel.arena.track(kernel.arena.track(kernel.Manifold.cube([u1-u0,v1-v0,z1-z0])).translate([u0,v0,z0])),plan);
}
export function buildWallSpring(kernel:Kernel,plan:SpringPlan,circularSegments:number,releaseTopZ=plan.topZ+1) {
  const {arena,Manifold:M,CrossSection}=kernel,{spring:s,rootZ,topZ,contactZ}=plan,front=plan.beamFrontMm;
  const profile=arena.track(new CrossSection([[
    [front,rootZ-.05],[front+B.rootMm,rootZ-.05],[front+B.rootMm,rootZ+B.bandMm],
    [front+B.beamMm,rootZ+B.taperMm],[front+B.beamMm,topZ-B.bevelMm],
    [front+B.beamMm-B.bevelMm,topZ],[front+B.bevelMm,topZ],[front,topZ-B.bevelMm],
  ]]));
  let beam=arena.track(profile.extrude(s.widthMm));
  beam=arena.track(arena.track(beam.rotate([90,0,90])).translate([-s.widthMm/2,0,0]));
  const radius=B.contactRadiusMm;
  // Interference is relative to the nominal source wall, before fit clearance.
  // The planner stores that distance explicitly for the contact builder.
  const contactV=radius-plan.clearanceMm-s.interferenceMm;
  const span=s.widthMm-2*radius;
  const middle=arena.track(arena.track(arena.track(M.cylinder(span,radius,radius,circularSegments)).rotate([0,90,0])).translate([-span/2,contactV,contactZ]));
  const caps=[-span/2,span/2].map(u=>arena.track(arena.track(M.sphere(radius,circularSegments)).translate([u,contactV,contactZ])));
  // Keep the rounded nose on the tool-facing side. Its rear must not bulge
  // past the beam and consume the specified deflection gap.
  const nose=arena.track(arena.track(M.union([middle,...caps])).trimByPlane([0,-1,0],-(front+B.beamMm)));
  const leaf=place(kernel,arena.track(M.union([beam,nose])),plan);
  const half=s.widthMm/2+B.sideGapMm;
  const ring=springReleaseRing(s.widthMm,plan.backStopMm,plan.releaseFrontMm,circularSegments>=64?16:8);
  const section=arena.track(new CrossSection([ring.map(p=>[p.x,p.y] as [number,number])]));
  const ceiling=Math.max(topZ+1,releaseTopZ,plan.surfaceZ+.1);
  let localRelease=arena.track(arena.track(section.extrude(ceiling-rootZ)).translate([0,0,rootZ]));
  // A shallow homothetic entry bevel is made from the same concave polygon,
  // preserving its rounded mouth rather than replacing it with a convex hull.
  // Scale is bounded by the planned envelope; the backing stays intact below
  // the top bevel, through the complete leaf height.
  const bevel=plan.entryChamferMm;
  if(bevel>1e-6) {
    const centerV=(plan.backStopMm+plan.releaseFrontMm)/2;
    const width=2*(half+Math.min(B.mouthBlendMm,plan.backStopMm*.45)),depth=plan.backStopMm-plan.releaseFrontMm;
    const centered=arena.track(section.translate([0,-centerV]));
    const flare=arena.track(arena.track(centered.extrude(bevel,0,0,[1+2*bevel/width,1+2*bevel/depth])).translate([0,centerV,plan.surfaceZ-bevel]));
    localRelease=arena.track(localRelease.add(flare));
    const top=arena.track(arena.track(arena.track(centered.scale([1+2*bevel/width,1+2*bevel/depth])).extrude(ceiling-plan.surfaceZ+.01)).translate([0,centerV,plan.surfaceZ-.01]));
    localRelease=arena.track(localRelease.add(top));
  }
  const release=place(kernel,localRelease,plan);
  const backing=box(kernel,plan,-half,half,plan.backStopMm+.001,plan.backStopMm+B.backingMm,rootZ+.02,topZ);
  const root=box(kernel,plan,-s.widthMm/2,s.widthMm/2,front,front+B.rootMm,rootZ-.045,rootZ-.005);
  return{leaf,release,backing,root};
}
/** Subtract release housings from the already-cut body, then attach leaves.
 * A deep release can run below the tool floor while retaining the entire base. */
export function applyWallSprings(kernel:Kernel,solid:Manifold,spec:BinSpec,layout:{cutouts:readonly CutoutPlacement[];shapesById:ReadonlyMap<string,TracedShape>;fingerHoles:readonly FingerHole[]},segments:number) {
  const {issues,plans}=wallSpringIssues(spec,layout.cutouts,layout.shapesById,layout.fingerHoles);
  if(issues.length)throw new Error(issues.map(i=>i.message).join("\n"));
  let result=solid;
  for(const plan of plans) {
    const {leaf,release,backing,root}=buildWallSpring(kernel,plan,segments,infillTopZ(spec)+.1),{arena}=kernel;
    if(arena.track(root.subtract(result)).volume()>.00001)throw new Error(`Spring ${plan.spring.id} has no continuous floor root.`);
    const carved=arena.track(result.subtract(release));
    if(arena.track(backing.subtract(carved)).volume()>.001)throw new Error(`Spring ${plan.spring.id} has incomplete backing through its height.`);
    result=arena.track(carved.add(leaf));
    if(result.status()!=="NoError")throw new Error(`Spring ${plan.spring.id} did not produce a valid connected leaf.`);
  }
  return result;
}
