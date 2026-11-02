import {afterEach,beforeAll,beforeEach,describe,it,expect} from "vitest";
import {Arena} from "../manifold/arena";
import {createKernel,loadManifold,type Kernel,type ManifoldToplevel} from "../manifold/runtime";
import {springShape,springSpec,springPocket,leaf} from "@shared/gridfinity/fixtures/wall-springs";
import {planWallSpring} from "@shared/gridfinity/wall-spring";
import {BACKED_LEAF as B} from "@shared/gridfinity/spring-schema";
import {buildWallSpring} from "./wall-springs";
import {buildBinWithCutouts,EXPORT_QUALITY,PREVIEW_QUALITY} from "./bin";
import {extractPrintableMeshData} from "../mesh/mesh-data";
import {expectPrintableTopology} from "../mesh/mesh-contract.test-helpers";
let wasm:ManifoldToplevel,arena:Arena,kernel:Kernel;
beforeAll(async()=>{wasm=await loadManifold();});beforeEach(()=>{arena=new Arena();kernel=createKernel(wasm,arena);});afterEach(()=>arena.dispose());
describe("native backed leaves",()=>{
  it.each([0,1])("keeps the leaf released and backed at clearance %s",clearanceMm=>{
    const cutout={...springPocket,clearanceMm,springs:[leaf]},layout={cutouts:[cutout],shapesById:new Map([[springShape.id,springShape]]),fingerHoles:[]};
    const built=buildBinWithCutouts(kernel,springSpec,layout,EXPORT_QUALITY);
    expect(arena.track(built.solid.trimByPlane([0,0,1],9.05)).decompose().map(s=>arena.track(s))).toHaveLength(2);
    expectPrintableTopology(extractPrintableMeshData(kernel,built.solid));
  });
  it("exposes a complete leaf face beside a shallow seat, instead of trapping it behind a front wall",()=>{
    const cutout={...springPocket,depth:{mode:"remaining" as const,floorThicknessMm:13.5},springs:[leaf]};
    const built=buildBinWithCutouts(kernel,springSpec,{cutouts:[cutout],shapesById:new Map([[springShape.id,springShape]]),fingerHoles:[]},EXPORT_QUALITY);
    const plan=planWallSpring(springSpec,cutout,springShape,leaf),p=plan.point(0,plan.beamFrontMm-.4);
    const frontGap=arena.track(arena.track(wasm.Manifold.cube([.02,.02,3])).translate([p.x-.01,p.y-.01,10]));
    expect(arena.track(built.solid.intersect(frontGap)).volume()).toBeLessThan(1e-9);
    expect(plan.beamFrontMm).toBeLessThan(0);
    expect(arena.track(built.solid.trimByPlane([0,0,1],9.05)).decompose().map(s=>arena.track(s))).toHaveLength(2);
  });
  it.each([{quality:PREVIEW_QUALITY,mirrored:false,rotationDeg:0},{quality:EXPORT_QUALITY,mirrored:true,rotationDeg:-75.75}])("releases the beam, retains its root and backing, and exports a connected solid (%j)",({quality,mirrored,rotationDeg})=>{
    const cutout={...springPocket,mirrored,rotationDeg,springs:[leaf]},layout={cutouts:[cutout],shapesById:new Map([[springShape.id,springShape]]),fingerHoles:[]};
    const built=buildBinWithCutouts(kernel,springSpec,layout,quality),plan=planWallSpring(springSpec,cutout,springShape,leaf);
    const sample=(u:number,v:number,z:number)=>{
      const p=plan.point(u,v),cube=arena.track(arena.track(wasm.Manifold.cube([.01,.01,.01])).translate([p.x-.005,p.y-.005,z-.005]));return arena.track(built.solid.intersect(cube)).volume();
    };
    const beamMiddle=plan.beamFrontMm+B.beamMm/2,gap=plan.beamFrontMm+B.beamMm+leaf.travelMm/2;
    expect(sample(0,beamMiddle,12)).toBeCloseTo(1e-6,9); // exposed leaf
    expect(sample(0,gap,12)).toBeLessThan(1e-9); // real outward release
    expect(sample(0,gap,17.4)).toBeLessThan(1e-9); // no roof fusing the leaf tip
    expect(sample(0,plan.backStopMm+.2,16.5)).toBeCloseTo(1e-6,9); // full-height stop
    expect(sample(0,beamMiddle,6.96)).toBeCloseTo(1e-6,9); // floor/root
    expect(sample(3,beamMiddle,12)).toBeLessThan(1e-9); // side slot
    expect(sample(0,-.65,15.5)).toBeCloseTo(1e-6,9); // rounded nominal contact
    expect(sample(0,-.75,15.5)).toBeLessThan(1e-9);
    expect(built.solid.decompose().map(x=>arena.track(x))).toHaveLength(1);
    expectPrintableTopology(extractPrintableMeshData(kernel,built.solid));
    // Sever the root: an actually released spring must become a separate
    // component. Occupancy probes or a displaced-leaf test alone can miss a
    // contact shoulder fused to the pocket wall.
    expect(arena.track(built.solid.trimByPlane([0,0,1],9.05)).decompose().map(s=>arena.track(s))).toHaveLength(2);
    const {leaf:free}=buildWallSpring(kernel,plan,quality.circularSegments);
    const displaced=arena.track(free.warp(p=>{const t=Math.max(0,Math.min(1,(p[2]-9)/8)),d=.3*t*t*(3-t)/2;p[0]+=plan.outward.x*d;p[1]+=plan.outward.y*d;}));
    const fixed=arena.track(built.solid.subtract(free)),upper=arena.track(displaced.trimByPlane([0,0,1],9.05));
    expect(arena.track(upper.intersect(fixed)).volume()).toBeLessThan(.001);
  });
});
