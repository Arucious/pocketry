/** Complete scissors bin with backed retention; run from repo root with tsx. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import sharp from 'sharp';
import {unzipSync,strFromU8} from 'fflate';
import {readProjectFile} from '../../scripts/lib/export-bin';
import {editProjectFeatures} from '../../shared/gridfinity/feature-edits';
import {serializeProjectDoc} from '../../shared/gridfinity/project';
import {wallSpringIssues} from '../../shared/gridfinity/wall-spring';
import {transformPointPlacement} from '../../shared/gridfinity/cutout';
import {infillTopZ} from '../../shared/gridfinity/fill';
import {profileAxisBounds,depthProfileSegments} from '../../shared/gridfinity/depth-profile';
import {buildBinWithCutouts,EXPORT_QUALITY} from '../../client/src/lib/gridfinity/bin';
import {buildWallSpring} from '../../client/src/lib/gridfinity/wall-springs';
import {Arena} from '../../client/src/lib/manifold/arena';
import type {Kernel} from '../../client/src/lib/manifold/runtime';
import {extractPrintableMeshData} from '../../client/src/lib/mesh/mesh-data';
import {writeBinarySTL} from '../../client/src/lib/export/stl-writer';
import {writeThreeMf} from '../../client/src/lib/mesh/threemf';
import operation from './operation.json';
const dir=dirname(fileURLToPath(import.meta.url)),out=resolve('exports/scissors-retained-08');await mkdir(out,{recursive:true});
const previous=await readProjectFile(resolve(dir,'../scissors-combined/revision-06.pocketry.json'));
// Smooth relief must replace the old triangular cutters, rather than cutting
// again over material those triangles already removed. Bridge rounding stays.
const input={...previous,cutouts:previous.cutouts.filter(p=>!p.id.includes('finger-join-bevel')),history:undefined};
const edited=editProjectFeatures(input,operation),project={...edited.project,name:'Combined scissors 08 · backed springs'},shapes=new Map(project.shapes.map(s=>[s.id,s]));
for(let i=0;i<2;i++) {
  const {springs:ignored,...p}=project.cutouts[i];assert.deepEqual(p,previous.cutouts[i]);
}
assert.deepEqual(project.spec,previous.spec);
const planning=wallSpringIssues(project.spec,project.cutouts,shapes,project.fingerHoles);assert.deepEqual(planning.issues,[]);assert.equal(planning.plans.length,2);
assert(!edited.issues.some(i=>i.severity==='error'||i.code.includes('lip-collision')));
const wasm=await Module({locateFile:()=>createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm')});wasm.setup();
const arena=new Arena();let report:Record<string,unknown>={};
try {
  const kernel:Kernel={Manifold:wasm.Manifold,CrossSection:wasm.CrossSection,triangulate:wasm.triangulate,arena};
  const layout={shapesById:shapes,cutouts:project.cutouts,fingerHoles:project.fingerHoles},built=buildBinWithCutouts(kernel,project.spec,layout,EXPORT_QUALITY);
  const solid=built.solid;assert.equal(solid.status(),'NoError');
  assert.equal(solid.decompose().map(s=>arena.track(s)).length,1);
  const blank=buildBinWithCutouts(kernel,project.spec,{...layout,cutouts:[],fingerHoles:[]},EXPORT_QUALITY);
  const mask=arena.track(arena.track(wasm.Manifold.cube([300,150,6.99999])).translate([-150,-75,0]));
  const baseRemoved=arena.track(arena.track(blank.solid.subtract(solid)).intersect(mask)).volume(),lipRemoved=arena.track(built.parts.lip!.subtract(solid)).volume();
  assert(baseRemoved<.001);assert(lipRemoved<.001);
  let probes=0;const springReports=[];
  for(const plan of planning.plans) {
    const probe=(u:number,v:number,z:number,filled:boolean)=>{
      const p=plan.point(u,v),cube=arena.track(arena.track(wasm.Manifold.cube([.01,.01,.01])).translate([p.x-.005,p.y-.005,z-.005]));
      const volume=arena.track(solid.intersect(cube)).volume();assert(Math.abs(volume-(filled?1e-6:0))<1e-9,JSON.stringify({id:plan.spring.id,u,v,z,filled,volume}));probes++;
    };
    const beamMiddle=plan.beamFrontMm+.6,rearGap=plan.beamFrontMm+1.2+plan.spring.travelMm/2;
    for(const z of [9.5,12,16.5]){probe(0,beamMiddle,z,true);probe(0,rearGap,z,false);probe(0,plan.backStopMm+.2,z,true);probe(3,beamMiddle,z,false);}
    probe(0,rearGap,infillTopZ(project.spec)-.03,false);probe(0,beamMiddle,6.96,true);probe(0,-.65,15.5,true);probe(0,-.75,15.5,false);
    probe(0,plan.beamFrontMm-.4,12,false);
    const leaf=buildWallSpring(kernel,plan,64).leaf,fixed=arena.track(solid.subtract(leaf));
    const released=arena.track(leaf.warp(p=>{const t=Math.max(0,Math.min(1,(p[2]-9)/8)),d=.3*t*t*(3-t)/2;p[0]+=plan.outward.x*d;p[1]+=plan.outward.y*d;}));
    const collision=arena.track(arena.track(released.trimByPlane([0,0,1],9.05)).intersect(fixed)).volume();assert(collision<.001);
    springReports.push({id:plan.spring.id,anchor:plan.center,rootZ:plan.rootZ,topZ:plan.topZ,contactZ:plan.contactZ,aboveToolFloorMm:plan.contactZ-plan.localFloorZ,
      stemIntoOpeningMm:-plan.beamFrontMm,frontReleaseGapMm:plan.beamFrontMm-plan.releaseFrontMm,backingGapMm:plan.spring.travelMm,entryBevelMm:plan.entryChamferMm,releaseProxyTipMm:.3,releaseProxyCollisionMm3:collision});
  }
  const severed=arena.track(solid.trimByPlane([0,0,1],9.05)).decompose().map(p=>arena.track(p));assert.equal(severed.length,3,'Both leaves must separate from the body after their roots are severed');
  // Both previously approved seating profiles remain real floor geometry.
  let floorProbes=0;
  for(const owner of project.cutouts.slice(0,2)) {
    const shape=shapes.get(owner.shapeId)!,bounds=profileAxisBounds(shape.outlineMm,'y'),segments=depthProfileSegments(owner.depthProfile!,bounds.length);
    for(const y of [20,45,73]) {
      const xs:number[]=[];for(const part of shape.outlineMm)for(let i=0;i<part.outer.length;i++){
        const a=part.outer[i],b=part.outer[(i+1)%part.outer.length];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y));
      }
      xs.sort((a,b)=>a-b);assert(xs.length>=2);const p=transformPointPlacement({x:(xs[0]+xs[1])/2,y},owner),at=y-bounds.min,s=segments.find(s=>at>=s.fromMm&&at<=s.toMm)!;
      const floor=infillTopZ(project.spec)-(s.fromDepthMm+(s.toDepthMm-s.fromDepthMm)*(at-s.fromMm)/(s.toMm-s.fromMm));
      for(const dz of [-.04,.04]){const cube=arena.track(arena.track(wasm.Manifold.cube([.01,.01,.01])).translate([p.x-.005,p.y-.005,floor+dz-.005]));assert(Math.abs(arena.track(solid.intersect(cube)).volume()-(dz<0?1e-6:0))<1e-9);floorProbes++;}
    }
  }
  const mesh=extractPrintableMeshData(kernel,solid),stl=Buffer.from(writeBinarySTL(mesh)),threeMf=writeThreeMf([{name:'Combined scissors 08',mesh}],{title:project.name});
  const triangles=stl.readUInt32LE(80),edges=new Map<string,{count:number;winding:number}>();let volume=0;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],key=(p:number[])=>p.map(v=>v===0?'0':String(v)).join(',');
  for(let i=0;i<triangles;i++) {
    const p=[0,1,2].map(j=>[0,1,2].map(k=>stl.readFloatLE(84+i*50+12+j*12+k*4)));
    for(const q of p)for(let k=0;k<3;k++){assert(Number.isFinite(q[k]));min[k]=Math.min(min[k],q[k]);max[k]=Math.max(max[k],q[k]);}
    volume+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;
    for(let j=0;j<3;j++){const a=key(p[j]),b=key(p[(j+1)%3]);assert(a!==b);const k=a<b?`${a}|${b}`:`${b}|${a}`,e=edges.get(k)??{count:0,winding:0};e.count++;e.winding+=a<b?1:-1;edges.set(k,e);}
  }
  const bad=[...edges].filter(([,e])=>e.count!==2||e.winding!==0);assert.deepEqual(bad.slice(0,8),[],'Serialized STL is not coordinate watertight');assert(volume>0);
  const model=strFromU8(unzipSync(threeMf)['3D/3dmodel.model']);assert(model.includes('unit="millimeter"'));assert.equal((model.match(/<object /g)??[]).length,1);assert.equal((model.match(/<triangle /g)??[]).length,triangles);
  const dimensions=max.map((v,i)=>v-min[i]);assert(dimensions.every((v,i)=>Math.abs(v-[251.5,83.5,24.551471862576143][i])<.0001));
  await writeFile(resolve(out,'scissors-retained-08.stl'),stl);await writeFile(resolve(out,'scissors-retained-08.3mf'),threeMf);
  await writeFile(resolve(out,'scissors-retained-08.pocketry.json'),JSON.stringify(serializeProjectDoc(project),null,2)+'\n');
  report={name:project.name,operation,verification:{connectedSolid:true,rootSeveredComponents:severed.length,watertightSerializedStl:true,consistentWinding:true,triangles,volumeCm3:volume/1000,dimensionsMm:dimensions,protectedBaseRemovedMm3:baseRemoved,stackingLipRemovedMm3:lipRemoved,springProbes:probes,floorProbes,springs:springReports,
    stlSha256:createHash('sha256').update(stl).digest('hex'),threeMfSha256:createHash('sha256').update(threeMf).digest('hex')},issues:edited.issues,
    notes:['One complete bin for both opposing scissors.','Clearance, central seating profiles, spring anchors, root heights and contact positions are unchanged.','The stems now stand 0.4 mm into the finished pocket, with 0.8 mm front release gaps and rounded flared release wells. Local edge relief exposes the lower leaf without changing the central blade floor.','Nose rears are clipped flush to the beam so the 0.4 mm rear deflection gap remains unobstructed. The backing remains full-height and the well mouths have shallow entry bevels.','Two opposing rounded contacts retain the nominal 0.10 mm overlap; physical force and contact height remain unverified.','The complete protected base and whole stacking lip are retained.','The 0.3 mm outward warp is a geometric proxy, not a force or endurance simulation.','These STL/3MF files contain complete model geometry, not a sliced print job.']};
  // Actual CAD sections: a plan slice through the contacts and a vertical
  // cut through one leaf show the release gap, reinforced root and backing.
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="920"><rect width="1260" height="920" fill="#f5f8fa"/><g font-family="Segoe UI,Arial,sans-serif" fill="#193d52"><text x="30" y="35" font-size="25" font-weight="600">Combined scissors 08 · backed spring retention</text><text x="30" y="62" font-size="16">Complete 6 × 2 bin · central seating retained · two opposing small-blade contacts</text>';
  const draw=(section:ReturnType<typeof solid.slice>,cx:number,cy:number,scale:number,focus={x:0,y:0})=>section.toPolygons().map(r=>r.map((p,i)=>`${i?'L':'M'}${cx+(p[0]-focus.x)*scale},${cy-(p[1]-focus.y)*scale}`).join(' ')+' Z').join(' ');
  const section=arena.track(solid.slice(15.5));svg+=`<path d="${draw(section,630,285,4.65)}" fill="#719ab0" fill-rule="evenodd" stroke="#355f78" stroke-width=".5"/>`;
  for(const plan of planning.plans)svg+=`<circle cx="${630+plan.center.x*4.65}" cy="${285-plan.center.y*4.65}" r="15" fill="none" stroke="#e78c28" stroke-width="2"/>`;
  const plan=planning.plans[0],origin=plan.point(0,0),angle=-Math.atan2(plan.tangent.y,plan.tangent.x)*180/Math.PI;
  let local=arena.track(arena.track(solid.translate([-origin.x,-origin.y,0])).rotate([0,0,angle]));
  if(plan.tangent.x*plan.outward.y-plan.tangent.y*plan.outward.x<0)local=arena.track(local.scale([1,-1,1]));
  const focus={x:0,y:1},window=arena.track(arena.track(wasm.CrossSection.square([12,7])).translate([-6,-3]));
  const close=arena.track(arena.track(local.slice(15.5)).intersect(window));
  svg+=`<text x="30" y="530" font-size="20" font-weight="600">At contact height Z 15.5 mm</text><path d="${draw(close,270,700,40,focus)}" fill="#719ab0" fill-rule="evenodd" stroke="#355f78" stroke-width="1"/>`;
  svg+='<text x="30" y="910" font-size="15">Orange circles above mark the two opposing contacts.</text>';
  // A YZ section through local U=0, transformed into a standard XY slice.
  const rotated=arena.track(arena.track(local.rotate([0,0,-90])).rotate([-90,0,0])),vertical=arena.track(rotated.slice(0));
  const crop=arena.track(arena.track(wasm.CrossSection.square([8,12.5])).translate([-3,6]));
  const v=arena.track(vertical.intersect(crop));
  svg+=`<text x="650" y="530" font-size="20" font-weight="600">Vertical section · leaf and backing stop</text><path d="${draw(v,900,710,25,{x:1,y:13})}" fill="#719ab0" fill-rule="evenodd" stroke="#355f78" stroke-width=".8"/>`;
  svg+='<text x="650" y="910" font-size="15">Full-length leaf · root at Z 7 · 0.4 mm backing gap</text></g></svg>';
  await writeFile(resolve(out,'retention-sections.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(resolve(out,'retention-sections.png'));
}finally{arena.dispose();}
await writeFile(resolve(out,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
