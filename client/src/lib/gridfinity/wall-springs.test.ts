import {afterEach,beforeAll,beforeEach,describe,it,expect} from "vitest";
import {Arena} from "../manifold/arena";
import {createKernel,loadManifold,type Kernel,type ManifoldToplevel} from "../manifold/runtime";
import {springShape,springSpec,springPocket,leaf} from "@shared/gridfinity/fixtures/wall-springs";
import {planWallSpring} from "@shared/gridfinity/wall-spring";
import {buildWallSpring} from "./wall-springs";
import {buildBinWithCutouts,EXPORT_QUALITY,PREVIEW_QUALITY} from "./bin";
import {extractPrintableMeshData} from "../mesh/mesh-data";
import {expectPrintableTopology} from "../mesh/mesh-contract.test-helpers";
let wasm:ManifoldToplevel,arena:Arena,kernel:Kernel;
beforeAll(async()=>{wasm=await loadManifold();});beforeEach(()=>{arena=new Arena();kernel=createKernel(wasm,arena);});afterEach(()=>arena.dispose());
describe("native backed leaves",()=>{
  it.each([{quality:PREVIEW_QUALITY,mirrored:false,rotationDeg:0},{quality:EXPORT_QUALITY,mirrored:true,rotationDeg:-75.75}])("releases the beam, retains its root and backing, and exports a connected solid (%j)",({quality,mirrored,rotationDeg})=>{
    const cutout={...springPocket,mirrored,rotationDeg,springs:[leaf]},layout={cutouts:[cutout],shapesById:new Map([[springShape.id,springShape]]),fingerHoles:[]};
    const built=buildBinWithCutouts(kernel,springSpec,layout,quality),plan=planWallSpring(springSpec,cutout,springShape,leaf);
    const sample=(u:number,v:number,z:number)=>{
      const p=plan.point(u,v),cube=arena.track(arena.track(wasm.Manifold.cube([.01,.01,.01])).translate([p.x-.005,p.y-.005,z-.005]));return arena.track(built.solid.intersect(cube)).volume();
    };
    expect(sample(0,.8,12)).toBeCloseTo(1e-6,9); // free leaf
    expect(sample(0,1.6,12)).toBeLessThan(1e-9); // real outward release
    expect(sample(0,1.6,17.4)).toBeLessThan(1e-9); // no roof fusing the leaf tip
    expect(sample(0,2,16.5)).toBeCloseTo(1e-6,9); // full-height stop
    expect(sample(0,.8,6.96)).toBeCloseTo(1e-6,9); // floor/root
    expect(sample(3,1,12)).toBeLessThan(1e-9); // side slot
    expect(sample(0,-.65,15.5)).toBeCloseTo(1e-6,9); // rounded nominal contact
    expect(sample(0,-.75,15.5)).toBeLessThan(1e-9);
    expect(built.solid.decompose().map(x=>arena.track(x))).toHaveLength(1);
    expectPrintableTopology(extractPrintableMeshData(kernel,built.solid));
    const {leaf:free}=buildWallSpring(kernel,plan,quality.circularSegments);
    const displaced=arena.track(free.warp(p=>{const t=Math.max(0,Math.min(1,(p[2]-9)/8)),d=.3*t*t*(3-t)/2;p[0]+=plan.outward.x*d;p[1]+=plan.outward.y*d;}));
    const fixed=arena.track(built.solid.subtract(free)),upper=arena.track(displaced.trimByPlane([0,0,1],9.05));
    expect(arena.track(upper.intersect(fixed)).volume()).toBeLessThan(.001);
  });
});
