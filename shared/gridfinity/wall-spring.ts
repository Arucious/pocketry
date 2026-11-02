import type {Point,Ring,Outline} from "../geometry/types";
import {distanceToSegment,pointInRing,ringPerimeter} from "../geometry/rings";
import {transformPointPlacement,transformOutlinePlacement,untransformPointPlacement,fingerHoleFootprintRing,resolvePlacedPocketDepth,
  type CutoutPlacement,type TracedShape,type FingerHole} from "./cutout";
import {depthProfileSegments,profileAxisBounds} from "./depth-profile";
import {hasPocketTilt} from "./pocket-orientation";
import {infillTopZ} from "./fill";
import {BASE_HEIGHT,binFootprintMm} from "./standard";
import {signedDistanceToFootprintRing,footprintOuterRingMm} from "./footprint";
import type {BinSpec} from "./types";
import {BACKED_LEAF as B,type WallSpring} from "./spring-schema";

export function springRing(shape:TracedShape,spring:Pick<WallSpring,"shapeIndex"|"ringIndex">):Ring|undefined {
  const part=shape.outlineMm[spring.shapeIndex];return spring.ringIndex===-1?part?.outer:part?.holes[spring.ringIndex];
}
export function pointAlongRing(ring:Ring,at:number):Point {
  const length=ringPerimeter(ring);let distance=((at%length)+length)%length;
  for(let i=0;i<ring.length;i++) {const a=ring[i],b=ring[(i+1)%ring.length],span=Math.hypot(b.x-a.x,b.y-a.y);
    if(distance<=span)return{x:a.x+(b.x-a.x)*distance/span,y:a.y+(b.y-a.y)*distance/span};distance-=span;}
  return ring[0];
}
/** Closest segment projection, not a nearest-vertex snap. Source arc distance
 * survives rotation/mirroring; nonuniform scale uses the actual world segment. */
export function nearestSpringAnchor(shape:TracedShape,pocket:CutoutPlacement,point:Point) {
  let best={shapeIndex:0,ringIndex:-1,atMm:0,distance:Infinity};
  shape.outlineMm.forEach((part,shapeIndex)=>[part.outer,...part.holes].forEach((ring,ri)=>{
    let walked=0;ring.forEach((a,i)=>{const b=ring[(i+1)%ring.length],aw=transformPointPlacement(a,pocket),bw=transformPointPlacement(b,pocket),dx=bw.x-aw.x,dy=bw.y-aw.y;
      const t=Math.max(0,Math.min(1,((point.x-aw.x)*dx+(point.y-aw.y)*dy)/(dx*dx+dy*dy)));
      const distance=Math.hypot(point.x-aw.x-t*dx,point.y-aw.y-t*dy),span=Math.hypot(b.x-a.x,b.y-a.y);
      if(distance<best.distance)best={shapeIndex,ringIndex:ri-1,atMm:walked+t*span,distance};walked+=span;
    });
  }));return best;
}
export function insideOutline(outline:Outline,p:Point) {return outline.some(s=>pointInRing(s.outer,p)&&!s.holes.some(h=>pointInRing(h,p)));}
function boundaryDistance(outline:Outline,p:Point) {return Math.min(...outline.flatMap(s=>[s.outer,...s.holes]).flatMap(r=>r.map((a,i)=>distanceToSegment(p,a,r[(i+1)%r.length]))));}
function profileFloor(spec:BinSpec,pocket:CutoutPlacement,shape:TracedShape,point:Point) {
  if(!pocket.depthProfile)return resolvePlacedPocketDepth(spec,pocket.depth,shape,pocket).floorZ;
  const profile=pocket.depthProfile,bounds=profileAxisBounds(shape.outlineMm,profile.axis),at=untransformPointPlacement(point,pocket)[profile.axis]-bounds.min;
  const segments=depthProfileSegments(profile,bounds.length),segment=segments.find(s=>at>=s.fromMm&&at<=s.toMm)??(at<0?segments[0]:segments.at(-1)!);
  const t=Math.max(0,Math.min(1,(at-segment.fromMm)/(segment.toMm-segment.fromMm))),depth=segment.fromDepthMm+t*(segment.toDepthMm-segment.fromDepthMm);
  const maximum=Math.max(...profile.stations.map(s=>s.depthMm));
  return resolvePlacedPocketDepth(spec,{mode:"mm",value:maximum},shape,pocket).floorZ!+maximum-depth;
}
export interface SpringPlan {spring:WallSpring;pocketId:string;center:Point;tangent:Point;outward:Point;rootZ:number;topZ:number;contactZ:number;localFloorZ:number;backStopMm:number;clearanceMm:number;housing:Ring;point:(u:number,v:number)=>Point}
export function planWallSpring(spec:BinSpec,pocket:CutoutPlacement,shape:TracedShape,spring:WallSpring):SpringPlan {
  if(hasPocketTilt(pocket)||pocket.profileBottom||Object.values(pocket.profileRotation??{}).some(x=>x!==0)||pocket.depth.mode==="through")throw new Error("Wall springs need an untilted blind pocket.");
  if(pocket.cornerRoundMm>0)throw new Error("Set pocket corner rounding to zero before anchoring springs to its traced wall.");
  const ring=springRing(shape,spring);if(!ring||ring.length<3||spring.atMm>=ringPerimeter(ring))throw new Error("Spring anchor is outside its source contour.");
  const local=pointAlongRing(ring,spring.atMm),a=transformPointPlacement(pointAlongRing(ring,spring.atMm-.25),pocket),b=transformPointPlacement(pointAlongRing(ring,spring.atMm+.25),pocket);
  const length=Math.hypot(b.x-a.x,b.y-a.y);if(length<1e-8)throw new Error("Choose a regular wall segment for the spring.");
  const tangent={x:(b.x-a.x)/length,y:(b.y-a.y)/length},sign=pocket.mirrored?-1:1,outward={x:tangent.y*sign,y:-tangent.x*sign};
  const anchor=transformPointPlacement(local,pocket),center={x:anchor.x+outward.x*pocket.clearanceMm,y:anchor.y+outward.y*pocket.clearanceMm};
  const point=(u:number,v:number)=>({x:center.x+tangent.x*u+outward.x*v,y:center.y+tangent.y*u+outward.y*v});
  const rootZ=spring.rootFloorMm,topZ=rootZ+spring.heightMm,contactZ=topZ-B.contactDropMm,backStopMm=B.setbackMm+B.beamMm+spring.travelMm;
  const safeFloor=spec.flatBottom?1.2:BASE_HEIGHT;
  if(rootZ<safeFloor-1e-8)throw new Error(`Keep the spring root at or above Z ${safeFloor} mm to protect the base.`);
  if(topZ>infillTopZ(spec)-.2)throw new Error("Not enough filled wall height for this leaf and its backing stop. Reduce root elevation or use a taller filled bin.");
  const outline=transformOutlinePlacement(shape.outlineMm,pocket),half=spring.widthMm/2+B.sideGapMm;
  const floorPoints=[-spring.widthMm/2,0,spring.widthMm/2].map(u=>profileFloor(spec,pocket,shape,point(u,-pocket.clearanceMm)));
  if(floorPoints.some(f=>f===null))throw new Error("Spring placement needs a retained pocket floor.");
  const localFloorZ=Math.max(...floorPoints as number[]);
  if(contactZ-B.contactRadiusMm<localFloorZ+.15)throw new Error("The contact sits below the local pocket floor. Increase spring height or move it to a deeper section.");
  if(pocket.clearanceMm+spring.interferenceMm>1.25||pocket.clearanceMm<0)throw new Error("This contact supports pocket clearances from 0 to 1.05 mm. Reduce clearance before adding a spring.");
  for(let u=-half;u<=half+.001;u+=.25) {
    const p=point(u,0),d=boundaryDistance(outline,p)*(insideOutline(outline,p)?-1:1);
    if(Math.abs(d-pocket.clearanceMm)>.3)throw new Error("This wall bends too sharply across the spring width. Choose a smoother span or reduce width.");
  }
  const housing=[point(-half,-.05),point(half,-.05),point(half,backStopMm+B.backingMm),point(-half,backStopMm+B.backingMm)];
  const boundary=spec.footprint.kind==="custom"?footprintOuterRingMm(spec):null;
  for(const p of housing) {
    const distance=boundary?signedDistanceToFootprintRing(p,boundary):Math.min(binFootprintMm(spec.gridX,spec.gridPitch)/2-Math.abs(p.x),binFootprintMm(spec.gridY,spec.gridPitch)/2-Math.abs(p.y));
    if(distance<.25)throw new Error("The spring needs more solid backing before the outside bin wall.");
  }
  return{spring,pocketId:pocket.id,center,tangent,outward,rootZ,topZ,contactZ,localFloorZ,backStopMm,clearanceMm:pocket.clearanceMm,housing,point};
}
function ringTouchesRing(a:Ring,b:Ring,allowance=0) {
  if(a.some(p=>pointInRing(b,p))||b.some(p=>pointInRing(a,p)))return true;
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  return a.some((p,i)=>b.some((q,j)=>{
    const pn=a[(i+1)%a.length],qn=b[(j+1)%b.length];
    return (cross(p,pn,q)*cross(p,pn,qn)<0&&cross(q,qn,p)*cross(q,qn,pn)<0)||Math.min(distanceToSegment(p,q,qn),distanceToSegment(pn,q,qn),distanceToSegment(q,p,pn),distanceToSegment(qn,p,pn))<=allowance+1e-8;
  }));
}
export function wallSpringIssues(spec:BinSpec,pockets:readonly CutoutPlacement[],shapes:ReadonlyMap<string,TracedShape>,holes:readonly FingerHole[]) {
  const issues:{code:string;severity:"error";message:string;cutoutIds:string[]}[]=[],plans:SpringPlan[]=[];
  for(const pocket of pockets)for(const spring of pocket.springs??[])try {
    const shape=shapes.get(pocket.shapeId);if(!shape)continue;
    const plan=planWallSpring(spec,pocket,shape,spring);
    // Reject the complete released housing/backing envelope, including flared
    // finger openings, rather than just checking the contact's centre point.
    for(const hole of holes) {
      const opening=fingerHoleFootprintRing(hole,
        {position:{x:0,y:0},rotationDeg:0,mirrored:false},128);
      if(ringTouchesRing(plan.housing,opening,.25+Math.max(hole.topChamferMm??0,hole.topFilletMm,(hole.joiningChamferMm??0)+(hole.joiningBlendMm??0))))throw new Error("Move the spring away from finger access; the opening removes its release space or backing.");
    }
    for(const other of pockets)if(other.id!==pocket.id) {
      const s=shapes.get(other.shapeId);if(!s)continue;
      const outline=transformOutlinePlacement(s.outlineMm,other),allowance=Math.max(0,other.clearanceMm)+Math.max(other.topFilletMm,other.cornerRoundMm);
      if(outline.some(part=>ringTouchesRing(plan.housing,part.outer,allowance)))throw new Error("Another pocket removes this spring's release space or backing.");
    }
    if(plans.some(p=>ringTouchesRing(plan.housing,p.housing,.25)))throw new Error("Spring housings overlap. Move them farther apart.");
    plans.push(plan);
  }catch(e){issues.push({code:"invalid-wall-spring",severity:"error",cutoutIds:[pocket.id],message:`Spring ${spring.id}: ${e instanceof Error?e.message:String(e)}`});}
  return{issues,plans};
}
