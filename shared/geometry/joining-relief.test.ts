import {describe,it,expect} from "vitest";
import {joiningReliefPatch} from "./joining-relief";
import {signedArea} from "./rings";
const ring=[{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:0,y:10},{x:0,y:0},{x:-10,y:0}];
describe('joining bevel runouts',()=>{
  it('retains a planar chamfer at zero blend',()=>{
    const result=joiningReliefPatch(ring,4,1.2,0);expect(result.curve).toEqual([{x:0,y:1.2},{x:-1.2,y:0}]);expect(signedArea(result.outline[0].outer)).toBeGreaterThan(0);
  });
  it('approaches both adjacent walls tangentially and preserves a straight central bevel',()=>{
    const result=joiningReliefPatch(ring,4,1.2,.5),c=result.curve;
    expect(c[0]).toEqual({x:0,y:1.7});expect(c.at(-1)).toEqual({x:-1.7,y:0});
    const a={x:c[1].x-c[0].x,y:c[1].y-c[0].y},b={x:c.at(-1)!.x-c.at(-2)!.x,y:c.at(-1)!.y-c.at(-2)!.y};
    expect(Math.abs(a.x/a.y)).toBeLessThan(.1);expect(Math.abs(b.y/b.x)).toBeLessThan(.1);
    const middle={x:c[17].x-c[16].x,y:c[17].y-c[16].y};expect(middle.y/middle.x).toBeCloseTo(1,8);
    expect(result.blendMm).toBe(.5);expect(signedArea(result.outline[0].outer)).toBeGreaterThan(0);
  });
  it('limits long runouts before they consume the whole chamfer',()=>{expect(joiningReliefPatch(ring,4,.4,3).blendMm).toBeLessThan(.3);});
});
