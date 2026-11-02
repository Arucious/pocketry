import {distanceToSegment,pointInRing} from "../geometry/rings";
import {transformOutlinePlacement,fingerHoleFootprintRing,type CutoutPlacement,type FingerHole,type TracedShape} from "./cutout";
import {hasPocketTilt} from "./pocket-orientation";
export function fingerJoiningOwner(hole:FingerHole,cutouts:readonly CutoutPlacement[],shapes:ReadonlyMap<string,TracedShape>) {
  const candidates=cutouts.flatMap(owner=>{
    const shape=shapes.get(owner.shapeId);if(!shape||hasPocketTilt(owner)||owner.profileBottom||Object.values(owner.profileRotation??{}).some(v=>v!==0)||owner.depth.mode==="through")return[];
    const outline=transformOutlinePlacement(shape.outlineMm,owner),inside=outline.some(s=>pointInRing(s.outer,hole.center)&&!s.holes.some(h=>pointInRing(h,hole.center)));
    const distance=inside?0:Math.min(...outline.flatMap(s=>[s.outer,...s.holes]).flatMap(r=>r.map((p,i)=>distanceToSegment(hole.center,p,r[(i+1)%r.length]))));
    return[{owner,shape,distance:Math.max(0,distance-Math.max(0,owner.clearanceMm))}];
  }).sort((a,b)=>a.distance-b.distance);
  const nearest=candidates[0];if(!nearest)return null;
  const ring=fingerHoleFootprintRing(hole,{position:{x:0,y:0},rotationDeg:0,mirrored:false},128),reach=Math.max(...ring.map(p=>Math.hypot(p.x-hole.center.x,p.y-hole.center.y)));
  return nearest.distance<=reach?nearest:null;
}
