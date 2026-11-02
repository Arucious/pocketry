import { z } from "zod";
import { distanceToSegment, pointInRing, signedArea } from "./rings";
import { OUTER_RING, type Outline, type Point, type Ring } from "./types";

/** One directed span of one ring. Distances use the outline's own units. */
export const localCurveOptionsSchema = z.object({
  shapeIndex: z.number().int().nonnegative().default(0),
  ringIndex: z.number().int().min(OUTER_RING).default(OUTER_RING),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative(),
  direction: z.enum(["forward", "backward"]).default("forward"),
  method: z.enum(["smooth", "arc", "ellipse"]).default("smooth"),
  strength: z.number().finite().min(0).max(1).default(1),
  iterations: z.number().int().min(1).max(100).default(12),
  maxDeviation: z.number().finite().positive().default(.25),
  preserveTangents: z.boolean().default(true),
  outwardOnly: z.boolean().default(false),
}).strict();
export type LocalCurveOptions = z.infer<typeof localCurveOptionsSchema>;
export type LocalCurveInput = z.input<typeof localCurveOptionsSchema>;
export interface LocalCurveResult {
  outline: Outline;
  indices: number[];
  maximumMove: number;
  rmsMove: number;
  limited: boolean;
  fit?: { radius?: number; axisA?: number; axisB?: number };
}
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
const mix = (a: Point,b: Point,t: number): Point => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

export function curveSpanIndices(length: number, start: number, end: number, direction: "forward"|"backward"): number[] {
  if(start===end||start>=length||end>=length||start<0||end<0)throw new Error("Choose two different existing contour points.");
  const result=[start],step=direction==="forward"?1:-1;
  while(result.at(-1)!==end)result.push((result.at(-1)!+step+length)%length);
  return result;
}

/** Small normalized least-squares systems; singular fits reject instead of guessing. */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n=rhs.length,a=matrix.map((r,i)=>[...r,rhs[i]]);
  for(let i=0;i<n;i++) {
    let pivot=i;
    for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
    if(Math.abs(a[pivot][i])<1e-10)throw new Error("Select a longer curved span for a reliable fit.");
    [a[i],a[pivot]]=[a[pivot],a[i]];
    const value=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=value;
    for(let j=0;j<n;j++)if(j!==i){const weight=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=weight*a[i][k];}
  }
  return a.map(r=>r[n]);
}
function parameters(chain: Ring): number[] {
  const lengths=[0];
  for(let i=1;i<chain.length;i++)lengths.push(lengths.at(-1)!+distance(chain[i-1],chain[i]));
  const length=lengths.at(-1)!;
  if(length<1e-8)throw new Error("The selected span has no usable length.");
  return lengths.map(x=>x/length);
}
function interpolate(chain: Ring, ts: number[], t: number): Point {
  const i=Math.max(1,ts.findIndex(x=>x>=t));
  return mix(chain[i-1],chain[i],(t-ts[i-1])/(ts[i]-ts[i-1]||1));
}
function smooth(chain: Ring, ts: number[], iterations: number): Ring {
  // Uniform arc-length samples avoid over-smoothing densely traced sections.
  const count=Math.min(1024,Math.max(16,chain.length));
  let samples=Array.from({length:count},(_,i)=>interpolate(chain,ts,i/(count-1)));
  for(let k=0;k<iterations;k++)for(const weight of [.5,-.53]) {
    const before=samples;
    samples=before.map((p,i)=>i===0||i===count-1?p:{
      x:p.x+weight*((before[i-1].x+before[i+1].x)/2-p.x),
      y:p.y+weight*((before[i-1].y+before[i+1].y)/2-p.y),
    });
  }
  const uniform=Array.from({length:count},(_,i)=>i/(count-1));
  return ts.map(t=>interpolate(samples,uniform,t));
}
function unwrap(angles: number[]): number {
  let sweep=0;
  for(let i=1;i<angles.length;i++)sweep+=Math.atan2(Math.sin(angles[i]-angles[i-1]),Math.cos(angles[i]-angles[i-1]));
  if(Math.abs(sweep)<.03||Math.abs(sweep)>2*Math.PI+.01)throw new Error("Select one continuous curved arc.");
  return sweep;
}
function circle(chain: Ring, ts: number[]): {points: Ring; fit: LocalCurveResult["fit"]} {
  const first=chain[0],last=chain.at(-1)!,length=distance(first,last);
  if(length<1e-8)throw new Error("Arc endpoints are too close together.");
  const midpoint=mix(first,last,.5),normal={x:-(last.y-first.y)/length,y:(last.x-first.x)/length};
  let numerator=0,denominator=0;
  for(const p of chain){const x=(p.x-midpoint.x)/length,y=(p.y-midpoint.y)/length,d=x*normal.x+y*normal.y;numerator+=d*(x*x+y*y-.25);denominator+=2*d*d;}
  if(denominator<1e-9)throw new Error("This span is too straight to fit a circular arc.");
  const h=numerator/denominator*length,center={x:midpoint.x+normal.x*h,y:midpoint.y+normal.y*h};
  const radius=distance(first,center),angles=chain.map(p=>Math.atan2(p.y-center.y,p.x-center.x)),sweep=unwrap(angles);
  return {fit:{radius},points:ts.map((_,i)=>({x:center.x+radius*Math.cos(angles[i]),y:center.y+radius*Math.sin(angles[i])}))};
}
function ellipse(chain: Ring, ts: number[]): {points: Ring; fit: LocalCurveResult["fit"]} {
  // Fit a normalized conic. Non-elliptic or ill-conditioned data is refused;
  // a short arc cannot reliably determine an ellipse's complete geometry.
  const mean={x:chain.reduce((n,p)=>n+p.x,0)/chain.length,y:chain.reduce((n,p)=>n+p.y,0)/chain.length};
  const scale=Math.max(...chain.map(p=>distance(p,mean)));
  const rows=chain.map(p=>{const x=(p.x-mean.x)/scale,y=(p.y-mean.y)/scale;return[x*x,x*y,y*y,x,y];});
  const coefficients=solve(Array.from({length:5},(_,i)=>Array.from({length:5},(_,j)=>rows.reduce((sum,r)=>sum+r[i]*r[j],0))),Array.from({length:5},(_,i)=>rows.reduce((sum,r)=>sum+r[i],0)));
  const [a,b,c,d,e]=coefficients,det=a*c-b*b/4;
  if(det<=1e-9)throw new Error("The selected span does not define a reliable ellipse. Try smoothing or an arc.");
  const cx=-(c*d-b*e/2)/(2*det),cy=-(a*e-b*d/2)/(2*det),k=1+a*cx*cx+b*cx*cy+c*cy*cy;
  const angle=.5*Math.atan2(b,a-c),cs=Math.cos(angle),sn=Math.sin(angle);
  const l1=a*cs*cs+b*cs*sn+c*sn*sn,l2=a*sn*sn-b*cs*sn+c*cs*cs;
  if(k/l1<=0||k/l2<=0)throw new Error("The selected points do not fit an ellipse.");
  const axisA=Math.sqrt(k/l1),axisB=Math.sqrt(k/l2);
  if(Math.max(axisA,axisB)/Math.min(axisA,axisB)>30||Math.max(axisA,axisB)>50)throw new Error("Ellipse fit is unstable; select more of the curve.");
  const angles=chain.map(p=>{const x=(p.x-mean.x)/scale-cx,y=(p.y-mean.y)/scale-cy;return Math.atan2((-sn*x+cs*y)/axisB,(cs*x+sn*y)/axisA);});
  const sweep=unwrap(angles);
  return {fit:{axisA:axisA*scale,axisB:axisB*scale},points:ts.map((_,i)=>{const q=angles[i],x=axisA*Math.cos(q),y=axisB*Math.sin(q);return{x:mean.x+scale*(cx+cs*x-sn*y),y:mean.y+scale*(cy+sn*x+cs*y)};})};
}
function crosses(a: Point,b: Point,c: Point,d: Point): boolean {
  const turn=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))return false;
  return turn(a,b,c)*turn(a,b,d)<-1e-14&&turn(c,d,a)*turn(c,d,b)<-1e-14;
}
function simple(ring: Ring): boolean {
  for(let i=0;i<ring.length;i++) {
    if(distance(ring[i],ring[(i+1)%ring.length])<1e-9)return false;
    for(let j=i+2;j<ring.length;j++)if(!(i===0&&j===ring.length-1)) {
      const a=ring[i],b=ring[(i+1)%ring.length],c=ring[j],d=ring[(j+1)%ring.length];
      if(crosses(a,b,c,d)||distanceToSegment(a,c,d)<1e-9||distanceToSegment(b,c,d)<1e-9||distanceToSegment(c,a,b)<1e-9||distanceToSegment(d,a,b)<1e-9)return false;
    }
  }
  return true;
}
function containsRing(outer: Ring,inner: Ring): boolean {
  for(let i=0;i<inner.length;i++) {
    if(!pointInRing(outer,inner[i],1e-7)||!pointInRing(outer,mix(inner[i],inner[(i+1)%inner.length],.5),1e-7))return false;
    for(let j=0;j<outer.length;j++)if(crosses(inner[i],inner[(i+1)%inner.length],outer[j],outer[(j+1)%outer.length]))return false;
  }
  return true;
}

/** Preview and CLI share one bounded edit; untouched vertices retain exact values.
 * Endpoints and, optionally, their adjacent vertices stay pinned. No topology,
 * coordinate-frame, calibration, placement or depth changes are performed here. */
export function refineCurveSpan(outline: Outline,input: LocalCurveInput): LocalCurveResult {
  const o=localCurveOptionsSchema.parse(input),shape=outline[o.shapeIndex],ring=o.ringIndex===OUTER_RING?shape?.outer:shape?.holes[o.ringIndex];
  if(!ring||!ring.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))throw new Error("Choose an existing finite contour.");
  const indices=curveSpanIndices(ring.length,o.startIndex,o.endIndex,o.direction);
  if(indices.length<5)throw new Error("Select a span containing at least five points.");
  const chain=indices.map(i=>ring[i]),ts=parameters(chain);
  const candidate=o.method==="smooth"?{points:smooth(chain,ts,o.iterations),fit:undefined}:o.method==="arc"?circle(chain,ts):ellipse(chain,ts);
  let limited=false;
  const next=[...ring],moves:number[]=[];
  indices.forEach((index,j)=>{
    if(j===0||j===indices.length-1||(o.preserveTangents&&(j===1||j===indices.length-2)))return;
    const t=Math.min(1,Math.min(ts[j],1-ts[j])/.15),blend=t*t*(3-2*t)*o.strength;
    let point=mix(ring[index],candidate.points[j],blend),move=distance(point,ring[index]);
    if(move>o.maxDeviation){point=mix(ring[index],point,o.maxDeviation/move);limited=true;}
    if(o.outwardOnly) {
      const a=ring[(index+ring.length-1)%ring.length],b=ring[(index+1)%ring.length];
      const nx=b.y-a.y,ny=a.x-b.x;
      if((point.x-ring[index].x)*nx+(point.y-ring[index].y)*ny<0)point=ring[index];
    }
    move=distance(point,ring[index]);moves.push(move);next[index]=point;
  });
  if(!simple(next)||signedArea(next)*signedArea(ring)<=0)throw new Error("This edit crosses or collapses the contour. Reduce the strength or movement limit.");
  if(o.outwardOnly&&!(signedArea(ring)>0?containsRing(next,ring):containsRing(ring,next)))throw new Error("This edit would narrow part of the pocket. Reduce strength or choose another span.");
  const rings=outline.flatMap((s,si)=>[s.outer,...s.holes].filter((_,ri)=>!(si===o.shapeIndex&&ri===o.ringIndex+1)));
  for(const other of rings)for(let i=0;i<next.length;i++)for(let j=0;j<other.length;j++)if(crosses(next[i],next[(i+1)%next.length],other[j],other[(j+1)%other.length]))throw new Error("This edit crosses another contour.");
  const updated=outline.map((s,i)=>i!==o.shapeIndex?s:o.ringIndex===OUTER_RING?{...s,outer:next}:{...s,holes:s.holes.map((h,j)=>j===o.ringIndex?next:h)});
  for(const s of updated)for(const hole of s.holes)if(!pointInRing(s.outer,hole[0]))throw new Error("This edit would move a hole outside its contour.");
  return {outline:updated,indices,maximumMove:Math.max(0,...moves),rmsMove:Math.sqrt(moves.reduce((n,m)=>n+m*m,0)/(moves.length||1)),limited,fit:candidate.fit};
}
