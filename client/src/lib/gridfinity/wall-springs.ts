import type {Manifold} from "manifold-3d";
import type {Kernel} from "../manifold/runtime";
import {wallSpringIssues,type SpringPlan} from "@shared/gridfinity/wall-spring";
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
  const {arena,Manifold:M,CrossSection}=kernel,{spring:s,rootZ,topZ,contactZ}=plan,front=B.setbackMm;
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
  const leaf=place(kernel,arena.track(M.union([beam,middle,...caps])),plan);
  const half=s.widthMm/2+B.sideGapMm;
  const release=box(kernel,plan,-half,half,-.05,plan.backStopMm,rootZ,Math.max(topZ+1,releaseTopZ));
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
    if(arena.track(backing.subtract(result)).volume()>.001)throw new Error(`Spring ${plan.spring.id} has incomplete backing through its height.`);
    if(arena.track(root.subtract(result)).volume()>.00001)throw new Error(`Spring ${plan.spring.id} has no continuous floor root.`);
    result=arena.track(arena.track(result.subtract(release)).add(leaf));
    if(result.status()!=="NoError")throw new Error(`Spring ${plan.spring.id} did not produce a valid connected leaf.`);
  }
  return result;
}
