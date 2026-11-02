import type {Point,Ring} from "./types";
import {normalizeOutline} from "./outline";
const unit=(a:Point,b:Point)=>{const d=Math.hypot(b.x-a.x,b.y-a.y);return{x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
function walk(ring:Ring,index:number,direction:1|-1,distance:number) {
  let at=index,current=ring[at];
  for(let i=0;i<ring.length;i++) {
    const next=(at+direction+ring.length)%ring.length,p=ring[next],length=Math.hypot(p.x-current.x,p.y-current.y);
    if(length>=distance&&length>1e-10) {
      const tangent=direction===1?unit(current,p):unit(p,current);
      return{point:{x:current.x+(p.x-current.x)*distance/length,y:current.y+(p.y-current.y)*distance/length},tangent};
    }
    distance-=length;current=p;at=next;
  }
  throw new Error("Joining relief extends beyond its contour.");
}
function cubic(a:Point,b:Point,c:Point,d:Point,count:number) {
  return Array.from({length:count},(_,i)=>{const t=(i+1)/count,q=1-t;return{x:q*q*q*a.x+3*q*q*t*b.x+3*q*t*t*c.x+t*t*t*d.x,y:q*q*q*a.y+3*q*q*t*b.y+3*q*t*t*c.y+t*t*t*d.y};});
}
/** Replace a material-side cusp with a bevel, optionally easing both joins.
 * End derivatives follow the actual adjacent polygon edges and the central
 * chamfer. The closing point extends into the already-empty cavity. */
export function joiningReliefPatch(ring:Ring,index:number,cutback:number,blend:number,samples=16) {
  if(!(cutback>0&&blend>=0))throw new Error("Use positive chamfer cutback and nonnegative blend.");
  const vertex=ring[index],a=walk(ring,index,-1,cutback).point,b=walk(ring,index,1,cutback).point;
  const flat=unit(a,b),available=Math.hypot(b.x-a.x,b.y-a.y),run=Math.min(blend,available*.4);
  let curve:Ring;
  if(run<1e-8)curve=[a,b];
  else {
    const pre=walk(ring,index,-1,cutback+run),post=walk(ring,index,1,cutback+run),h=run*.65;
    const endA={x:a.x+flat.x*run,y:a.y+flat.y*run},startB={x:b.x-flat.x*run,y:b.y-flat.y*run};
    curve=[pre.point,...cubic(pre.point,{x:pre.point.x+pre.tangent.x*h,y:pre.point.y+pre.tangent.y*h},{x:endA.x-flat.x*h,y:endA.y-flat.y*h},endA,samples),startB,
      ...cubic(startB,{x:startB.x+flat.x*h,y:startB.y+flat.y*h},{x:post.point.x-post.tangent.x*h,y:post.point.y-post.tangent.y*h},post.point,samples)];
  }
  const direction=unit({x:(a.x+b.x)/2,y:(a.y+b.y)/2},vertex),inside={x:vertex.x+.2*direction.x,y:vertex.y+.2*direction.y};
  return{outline:normalizeOutline([{outer:[...curve,inside],holes:[]}]),curve,blendMm:run};
}
