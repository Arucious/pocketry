import type {Manifold,CrossSection as CS} from "manifold-3d";
import type {Kernel} from "../manifold/runtime";
import {toCrossSection,polygonsToOutline} from "../geometry/offset";
import {joiningReliefPatch} from "@shared/geometry/joining-relief";
import {fingerJoiningOwner} from "@shared/gridfinity/finger-joining";
import {resolveFingerAccessDepth} from "@shared/gridfinity/finger-access-depth";
import {distanceToSegment} from "@shared/geometry/rings";
import {transformOutlinePlacement,fingerHoleCircularSegments,fingerHoleFootprintRing,resolvePocketDepth,resolvePlacedPocketDepth,effectiveFingerHoleDepthMm,hasFlatFingerHoleBottom,
  type CutoutPlacement,type FingerHole,type TracedShape} from "@shared/gridfinity/cutout";
import type {BinSpec} from "@shared/gridfinity/types";
import {depthProfileMask} from "./depth-profile-cutter";
import {budgetOutline} from "./cutouts";
import type {BuildQuality} from "./bin";

/** Native union locates the real joining cusps, including paired access circles.
 * Patches follow the same owner floor mask used by the pocket and access. */
export function buildFingerJoiningCutters(kernel:Kernel,holes:readonly FingerHole[],spec:BinSpec,quality:BuildQuality,
  layout:{cutouts:readonly CutoutPlacement[];shapesById:ReadonlyMap<string,TracedShape>}) {
  const {arena}=kernel,result:Manifold[]=[],groups=new Map<string,{owner:CutoutPlacement;shape:TracedShape;holes:FingerHole[]}>();
  for(const hole of holes) {
    if((hole.joiningChamferMm??0)>0&&!hasFlatFingerHoleBottom(hole))throw new Error("Joining relief requires flat-bottom finger access.");
    const match=fingerJoiningOwner(hole,layout.cutouts,layout.shapesById);if(!match) {if((hole.joiningChamferMm??0)>0)throw new Error("Joining relief needs finger access beside an untilted blind pocket.");continue;}
    const group=groups.get(match.owner.id)??{owner:match.owner,shape:match.shape,holes:[]};group.holes.push(hole);groups.set(match.owner.id,group);
  }
  for(const {owner,shape,holes:members} of groups.values()) {
    if(!members.some(h=>(h.joiningChamferMm??0)>0))continue;
    let section=toCrossSection(kernel,transformOutlinePlacement(budgetOutline(shape.outlineMm,quality.cutoutVertexBudget??150),owner));
    if(owner.clearanceMm!==0)section=arena.track(section.offset(owner.clearanceMm,'Round',2,quality.circularSegments));
    if(owner.cornerRoundMm>0)section=arena.track(arena.track(section.offset(-owner.cornerRoundMm,'Round',2,quality.circularSegments)).offset(owner.cornerRoundMm,'Round',2,quality.circularSegments));
    const mouths=members.map(hole=>{
      const count=fingerHoleCircularSegments(hole,quality.circularSegments,quality.fingerHoleChordToleranceMm??.01),ring=fingerHoleFootprintRing(hole,{position:{x:0,y:0},rotationDeg:0,mirrored:false},count);
      return{hole,ring,section:toCrossSection(kernel,[{outer:ring,holes:[]}])};
    });
    const union=arena.track(kernel.CrossSection.union([section,...mouths.map(m=>m.section)]));
    const patches=new Map<string,CS[]>();
    for(const part of polygonsToOutline(union.toPolygons()))for(const ring of [part.outer,...part.holes])for(let i=0;i<ring.length;i++) {
      const a=ring[(i+ring.length-1)%ring.length],v=ring[i],b=ring[(i+1)%ring.length],ux=v.x-a.x,uy=v.y-a.y,vx=b.x-v.x,vy=b.y-v.y;
      if(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy)*180/Math.PI>=-8)continue;
      const related=mouths.filter(m=>(m.hole.joiningChamferMm??0)>0&&Math.min(...m.ring.map((p,j)=>distanceToSegment(v,p,m.ring[(j+1)%m.ring.length])))<.025)
        .sort((a,b)=>(b.hole.joiningChamferMm??0)-(a.hole.joiningChamferMm??0));
      if(!related.length)continue;
      const hole=related[0].hole,patch=joiningReliefPatch(ring,i,hole.joiningChamferMm!,hole.joiningBlendMm??0,quality.circularSegments>=64?16:8);
      const cs=toCrossSection(kernel,patch.outline);if(arena.track(cs.subtract(union)).area()<.001)continue;
      const list=patches.get(hole.id)??[];list.push(cs);patches.set(hole.id,list);
    }
    for(const {hole} of mouths) {
      const parts=patches.get(hole.id);if(!parts?.length)continue;
      const patch=arena.track(kernel.CrossSection.union(parts)),resolved=resolvePocketDepth(spec,{mode:'mm',value:effectiveFingerHoleDepthMm(hole)});
      const follow=resolveFingerAccessDepth(spec,hole,layout.cutouts,layout.shapesById);if(follow.error)throw new Error(follow.error);
      const ownerFloor=resolvePlacedPocketDepth(spec,owner.depth,shape,owner).floorZ??resolved.floorZ!;
      const bottom=Math.min(resolved.floorZ!,ownerFloor)-.01,full=arena.track(arena.track(patch.extrude(resolved.cutterTopZ-bottom)).translate([0,0,bottom]));
      let cutter:Manifold;
      if(follow.match) {
        const mask=depthProfileMask(kernel,follow.match.shape,follow.match.cutout,follow.match.profileTopZ,resolved.cutterTopZ+1,0,follow.match.paddingMm);
        cutter=arena.track(arena.track(full.intersect(mask)).add(arena.track(full.trimByPlane([0,0,1],resolved.floorZ!))));
      }else cutter=arena.track(full.trimByPlane([0,0,1],resolved.floorZ!));
      result.push(cutter);
    }
  }
  return result;
}
