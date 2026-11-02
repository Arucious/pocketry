import {describe,expect,it} from "vitest";
import {curveSpanIndices,localCurveOptionsSchema,refineCurveSpan} from "./local-curve";
import {pointInRing,signedArea} from "./rings";
import type {Outline, Ring} from "./types";

const ellipse=(a=10,b=10,angle=0):Ring=>Array.from({length:80},(_,i)=>{
  const t=i*2*Math.PI/80,x=a*Math.cos(t),y=b*Math.sin(t);
  return{x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)};
});
const noisy=():Outline=>[{outer:ellipse().map((p,i)=>({x:p.x*(i%3===0?1.015:1),y:p.y*(i%3===0?1.015:1)})),holes:[]}];
const operation={startIndex:5,endIndex:37,maxDeviation:.08};

describe("localized curve refinement",()=>{
  it("selects either directed path, including across the ring seam",()=>{
    expect(curveSpanIndices(8,6,2,"forward")).toEqual([6,7,0,1,2]);
    expect(curveSpanIndices(8,6,2,"backward")).toEqual([6,5,4,3,2]);
    expect(()=>curveSpanIndices(8,2,2,"forward")).toThrow(/different/);
  });
  it.each(["smooth","arc","ellipse"] as const)("bounds %s, pins endpoints/tangents and preserves all unselected values",method=>{
    const source=noisy(),saved=JSON.stringify(source),result=refineCurveSpan(source,{...operation,method});
    expect(JSON.stringify(source)).toBe(saved);
    expect(result.maximumMove).toBeGreaterThan(0);
    expect(result.maximumMove).toBeLessThanOrEqual(.080000001);
    const pinned=new Set([5,6,36,37]);
    source[0].outer.forEach((p,i)=>{
      if(i<5||i>37||pinned.has(i))expect(result.outline[0].outer[i]).toEqual(p);
    });
    expect(signedArea(result.outline[0].outer)).toBeGreaterThan(0);
  });
  it("does not flatten an already circular arc",()=>{
    const source=[{outer:ellipse(),holes:[]}],result=refineCurveSpan(source,{...operation,method:"arc"});
    expect(result.fit?.radius).toBeCloseTo(10,8);
    expect(result.maximumMove).toBeLessThan(1e-10);
  });
  it.each([0,.71,1.9])("fits a rotated ellipse without making it a circle (angle=%s)",angle=>{
    const result=refineCurveSpan([{outer:ellipse(20,10,angle),holes:[]}],{startIndex:1,endIndex:77,method:"ellipse",maxDeviation:2});
    expect([result.fit!.axisA!,result.fit!.axisB!].sort((a,b)=>a-b)).toEqual([expect.closeTo(10,7),expect.closeTo(20,7)]);
    expect(result.maximumMove).toBeLessThan(1e-8);
  });
  it("enlarges a local inward dent without narrowing the rest of the pocket",()=>{
    const ring=ellipse();ring[20]={x:ring[20].x*.95,y:ring[20].y*.95};
    const result=refineCurveSpan([{outer:ring,holes:[]}],{startIndex:8,endIndex:32,method:"arc",maxDeviation:.3,outwardOnly:true});
    expect(result.outline[0].outer[20].y).toBeGreaterThan(ring[20].y);
    for(const p of ring)expect(pointInRing(result.outline[0].outer,p,1e-7)).toBe(true);
  });
  it("can refine a hole while retaining its winding and untouched shapes",()=>{
    const hole=ellipse(5,4).reverse(),source=[{outer:ellipse(20,20),holes:[hole]},{outer:ellipse(2,2).map(p=>({x:p.x+40,y:p.y})),holes:[]}];
    const result=refineCurveSpan(source,{...operation,ringIndex:0,method:"smooth"});
    expect(signedArea(result.outline[0].holes[0])).toBeLessThan(0);
    expect(result.outline[0].outer).toBe(source[0].outer);
    expect(result.outline[1]).toBe(source[1]);
  });
  it("handles reverse-path edits without reversing the ring",()=>{
    const source=noisy(),result=refineCurveSpan(source,{startIndex:8,endIndex:68,direction:"backward",maxDeviation:.1});
    expect(result.indices).toContain(0);
    expect(result.indices).not.toContain(40);
    expect(result.outline[0].outer[40]).toBe(source[0].outer[40]);
    expect(signedArea(result.outline[0].outer)).toBeGreaterThan(0);
  });
  it("refuses underdetermined arcs and invalid ranges/options",()=>{
    const outer=[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}];
    expect(()=>refineCurveSpan([{outer,holes:[]}],{startIndex:0,endIndex:4,method:"arc"})).toThrow(/straight/);
    expect(()=>refineCurveSpan(noisy(),{startIndex:0,endIndex:2})).toThrow(/five/);
    expect(()=>refineCurveSpan(noisy(),{...operation,shapeIndex:3})).toThrow(/existing/);
    expect(localCurveOptionsSchema.safeParse({...operation,maxDeviation:NaN}).success).toBe(false);
    expect(localCurveOptionsSchema.safeParse({...operation,strength:2}).success).toBe(false);
  });
  it("supports a true zero-strength no-op",()=>{
    const source=noisy(),result=refineCurveSpan(source,{...operation,strength:0});
    expect(result.outline).toEqual(source);
    expect(result.maximumMove).toBe(0);
  });
});
