import {afterEach,beforeAll,beforeEach,describe,it,expect} from "vitest";
import {Arena} from "../manifold/arena";
import {createKernel,loadManifold,type Kernel,type ManifoldToplevel} from "../manifold/runtime";
import {springShape,springSpec,springPocket} from "@shared/gridfinity/fixtures/wall-springs";
import {fingerHoleSchema,parseCutoutPlacement,transformOutlinePlacement} from "@shared/gridfinity/cutout";
import {infillTopZ} from "@shared/gridfinity/fill";
import {ringCentroid} from "@shared/geometry/rings";
import {buildBinWithCutouts,EXPORT_QUALITY} from "./bin";
import {buildFingerJoiningCutters} from "./finger-joining";
import {buildCutoutCutters,buildFingerHoleCutters} from "./cutouts";
import {polygonsToOutline} from "../geometry/offset";
import {extractPrintableMeshData} from "../mesh/mesh-data";
import {expectPrintableTopology} from "../mesh/mesh-contract.test-helpers";
let wasm:ManifoldToplevel,arena:Arena,kernel:Kernel;
beforeAll(async()=>{wasm=await loadManifold();});beforeEach(()=>{arena=new Arena();kernel=createKernel(wasm,arena);});afterEach(()=>arena.dispose());
describe('native blended joining bevels',()=>{
  it('reaches the exact ramp floor and preserves the protected base in a printable solid',()=>{
    const top=infillTopZ(springSpec),pocket=parseCutoutPlacement({...springPocket,depth:{mode:'mm',value:12},depthProfile:{axis:'x',stations:[{atMm:0,depthMm:12,transition:'linear'},{atMm:80,depthMm:5.5}]}});
    const hole=fingerHoleSchema.parse({id:'h',center:{x:0,y:19},diameterMm:20,depthMm:1,depthMode:'nearest-profile',joiningChamferMm:1.2,joiningBlendMm:.5});
    const layout={cutouts:[pocket],shapesById:new Map([[springShape.id,springShape]]),fingerHoles:[hole]},quality=EXPORT_QUALITY;
    const built=buildBinWithCutouts(kernel,springSpec,layout,quality);
    const plain=buildBinWithCutouts(kernel,springSpec,{...layout,fingerHoles:[{...hole,joiningChamferMm:0,joiningBlendMm:0}]},quality);
    expect(arena.track(plain.solid.subtract(built.solid)).volume()).toBeGreaterThan(.01);
    const cutters=buildFingerJoiningCutters(kernel,[hole],springSpec,quality,layout);expect(cutters.length).toBeGreaterThan(0);
    const original=arena.track(wasm.Manifold.union([...buildCutoutCutters(kernel,layout.shapesById,[pocket],springSpec,quality).cutters,...buildFingerHoleCutters(kernel,[{...hole,joiningChamferMm:0,joiningBlendMm:0}],springSpec,quality,layout)]));
    const removed=arena.track(arena.track(wasm.Manifold.union(cutters)).subtract(original)),slice=arena.track(removed.slice(top-.1));
    const largest=slice.decompose().map(x=>arena.track(x)).sort((a,b)=>b.area()-a.area())[0];
    const sample=ringCentroid(polygonsToOutline(largest.toPolygons())[0].outer)!,depth=12+(5.5-12)*(sample.x+40)/80,floor=top-depth;
    for(const dz of [-.04,.04]){
      const cube=arena.track(arena.track(wasm.Manifold.cube([.01,.01,.01])).translate([sample.x-.005,sample.y-.005,floor+dz-.005]));
      expect(arena.track(built.solid.intersect(cube)).volume()).toBeCloseTo(dz<0?1e-6:0,9);
    }
    const base=arena.track(arena.track(wasm.Manifold.cube([180,140,6.999])).translate([-90,-70,0]));
    expect(arena.track(arena.track(plain.solid.subtract(built.solid)).intersect(base)).volume()).toBeLessThan(.001);
    expect(built.solid.decompose().map(x=>arena.track(x))).toHaveLength(1);
    const mesh=extractPrintableMeshData(kernel,built.solid);expectPrintableTopology(mesh);
    const edges=new Map<string,{count:number;winding:number}>(),key=(index:number)=>Array.from(mesh.positions.slice(index*3,index*3+3)).map(v=>v===0?'0':String(v)).join(',');
    for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){
      const a=key(mesh.indices[i+j]),b=key(mesh.indices[i+(j+1)%3]),k=a<b?`${a}|${b}`:`${b}|${a}`,e=edges.get(k)??{count:0,winding:0};e.count++;e.winding+=a<b?1:-1;edges.set(k,e);
    }
    expect([...edges.values()].filter(e=>e.count!==2||e.winding!==0)).toEqual([]);
  });
});
