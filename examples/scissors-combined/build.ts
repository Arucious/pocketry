/** Reproduce this particular measured bin; deliberately separate from general features.
 * Run from the repo root: npx tsx examples/scissors-combined/build.ts [--small-lower MM] [--out DIR]
 * Native probes below are the acceptance checks for the generated design. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import sharp from 'sharp';
import {unzipSync,strFromU8} from 'fflate';
import {readProjectFile} from '../../scripts/lib/export-bin';
import {projectDocSchema,serializeProjectDoc} from '../../shared/gridfinity/project';
import {refineProjectPocket} from '../../shared/gridfinity/local-curve';
import {depthProfileSchema,depthProfileSegments,profileAxisBounds,maximumProfileDepth,minimumProfileDepth,type DepthProfile} from '../../shared/gridfinity/depth-profile';
import {parseCutoutPlacement,transformPointPlacement,untransformPointPlacement,transformOutlinePlacement,type CutoutPlacement} from '../../shared/gridfinity/cutout';
import {infillTopZ} from '../../shared/gridfinity/fill';
import {validateLayout,validateBinSpec} from '../../shared/gridfinity/validate';
import {resolveFingerAccessDepth} from '../../shared/gridfinity/finger-access-depth';
import {ringCentroid} from '../../shared/geometry/rings';
import type {Outline,Point} from '../../shared/geometry/types';
import {buildBinWithCutouts,EXPORT_QUALITY} from '../../client/src/lib/gridfinity/bin';
import {Arena} from '../../client/src/lib/manifold/arena';
import type {Kernel} from '../../client/src/lib/manifold/runtime';
import {extractPrintableMeshData} from '../../client/src/lib/mesh/mesh-data';
import {writeBinarySTL} from '../../client/src/lib/export/stl-writer';
import {writeThreeMf} from '../../client/src/lib/mesh/threemf';
import {toCrossSection} from '../../client/src/lib/geometry/offset';
import settings from './settings.json';

const dir=dirname(fileURLToPath(import.meta.url));
let lower=settings.smallPocketLowerMm,out=resolve('exports/scissors-combined-06');
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++) {
  if(args[i]==='--small-lower')lower=Number(args[++i]);
  else if(args[i]==='--out'&&args[i+1])out=resolve(args[++i]);
  else throw new Error('Use --small-lower MM and/or --out DIR.');
}
assert(Number.isFinite(lower)&&lower>=0&&lower<=10,'Small pocket lowering must be between 0 and 10 mm.');
await mkdir(out,{recursive:true});
const original=await readProjectFile(resolve(dir,'baseline-05.pocketry.json'));
const deck=infillTopZ(original.spec),curveReports=[];
let edited=original;
for(const [i,{pocketId,...operation}] of settings.curves.entries()) {
  const result=refineProjectPocket(edited,pocketId,operation as Parameters<typeof refineProjectPocket>[2],`scissors-curve-06-${i}`);
  curveReports.push({pocketId,operation,maximumMoveMm:result.result.maximumMove,limited:result.result.limited,fit:result.result.fit});
  edited=result.project;
}
const sourceShapes=new Map(edited.shapes.map(s=>[s.id,s]));
const owners=edited.cutouts.slice(0,2),sourceBounds=owners.map(p=>profileAxisBounds(sourceShapes.get(p.shapeId)!.outlineMm,'y'));
/** Evaluate the exact facets used by native CAD, rather than resampling a different curve. */
function depthAt(profile:DepthProfile,length:number,at:number) {
  const segments=depthProfileSegments(profile,length),a=segments[0],b=segments.at(-1)!;
  if(at<=a.fromMm)return a.fromDepthMm;if(at>=b.toMm)return b.toDepthMm;
  const segment=segments.find(s=>at>=s.fromMm-1e-8&&at<=s.toMm+1e-8)!;
  return segment.fromDepthMm+(segment.toDepthMm-segment.fromDepthMm)*(at-segment.fromMm)/(segment.toMm-segment.fromMm);
}
function sampledProfile(profile:DepthProfile,length:number,positions:number[],adjust:(at:number)=>number) {
  const facets=depthProfileSegments(profile,length);
  const points=[0,length,...facets.flatMap(s=>[s.fromMm,s.toMm]),...positions].sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>1e-7);
  return depthProfileSchema.parse({axis:profile.axis,stations:points.map(at=>({atMm:at,depthMm:depthAt(profile,length,at)+adjust(at),transition:'linear'}))});
}
const large=owners[0],small=owners[1],largeLength=sourceBounds[0].length,smallLength=sourceBounds[1].length;
const main=[
  parseCutoutPlacement({...large,mirrored:!large.mirrored,position:{x:large.position.x+settings.largePlacementDelta.x,y:large.position.y+settings.largePlacementDelta.y},rotationDeg:large.rotationDeg+settings.largePlacementDelta.angleDeg,
    depthProfile:sampledProfile(large.depthProfile!,largeLength,[],at=>-settings.largeTipPitchRiseMm*at/largeLength)}),
  parseCutoutPlacement({...small,position:{x:small.position.x+settings.smallPlacementDelta.x,y:small.position.y+settings.smallPlacementDelta.y},
    depthProfile:sampledProfile(small.depthProfile!,smallLength,[smallLength-settings.smallTipRampLengthMm],at=>lower-settings.smallTipRiseMm*Math.max(0,(at-(smallLength-settings.smallTipRampLengthMm))/settings.smallTipRampLengthMm))}),
];
// All auxiliary cutters use their owner's exact floor, including the new pitch.
// Transform each entire group, so access and full-height bevels mirror together.
const auxiliaries=edited.cutouts.slice(2).map(p=>{
  const i=p.id.startsWith('scissors-1-')?0:1,before=owners[i],after=main[i],bounds=sourceBounds[i];
  assert(Math.abs(p.rotationDeg-before.rotationDeg)<1e-8&&!p.mirrored,'Recipe expects axis-aligned owner-local auxiliary cutters.');
  const center=untransformPointPlacement(p.position,before),shape=sourceShapes.get(p.shapeId)!,local=profileAxisBounds(shape.outlineMm,'y');
  const low=center.y+local.min-bounds.min,high=center.y+local.max-bounds.min;
  const facets=depthProfileSegments(after.depthProfile!,bounds.length);
  const positions=[low,high,...facets.flatMap(s=>[s.fromMm,s.toMm]).filter(at=>at>low+1e-8&&at<high-1e-8)].sort((a,b)=>a-b).filter((v,j,a)=>j===0||v-a[j-1]>1e-8);
  const depthProfile=depthProfileSchema.parse({axis:'y',stations:positions.map(at=>({atMm:at-low,depthMm:depthAt(after.depthProfile!,bounds.length,at),transition:'linear'}))});
  return parseCutoutPlacement({...p,position:transformPointPlacement(center,after),rotationDeg:after.rotationDeg,mirrored:after.mirrored,depthProfile,depth:{mode:'mm',value:maximumProfileDepth(depthProfile)},bottomFilletMm:0});
});
const holes=edited.fingerHoles.map((h,index)=>{
  const i=Math.floor(index/2);
  return {...h,center:transformPointPlacement(untransformPointPlacement(h.center,owners[i]),main[i]),depthMm:minimumProfileDepth(main[i].depthProfile!)};
});
const project=projectDocSchema.parse({...edited,name:lower?`Combined scissors 06 lower ${lower} mm`:'Combined scissors 06',cutouts:[...main,...auxiliaries],fingerHoles:holes,history:undefined,transformOrigins:undefined});
assert.deepEqual(project.spec,original.spec);
const shapes=new Map(project.shapes.map(s=>[s.id,s]));
const issues=[...validateBinSpec(project.spec).issues,...validateLayout(project.spec,project.cutouts,shapes,holes)];
assert.deepEqual(issues.filter(i=>i.severity==='error'),[],'Blocking layout validation');
assert.deepEqual(issues.filter(i=>i.code==='lip-collision'),[],'The new openings must preserve the whole stacking lip');
const access=holes.map((h,i)=>{
  const result=resolveFingerAccessDepth(project.spec,h,project.cutouts,shapes);
  assert(!result.error&&result.match?.cutout.id===main[Math.floor(i/2)].id,'Finger-access owner changed');
  return{id:h.id,owner:result.match.cutout.id,minFloorZ:result.floorZ,minimumDepthMm:result.minimumDepthMm,maximumDepthMm:result.maximumDepthMm};
});
const wasm=await Module({locateFile:()=>createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm')});wasm.setup();
const arena=new Arena(),verification:Record<string,unknown>={};
const measurements=[{label:'A1',x:-30,y:-82,thickness:9.85},{label:'A2',x:32,y:-70,thickness:9.85},{label:'B (approx lower gap)',x:-3,y:-25,thickness:4.95},{label:'C',x:-7,y:17,thickness:10.4},{label:'D',x:-10,y:56,thickness:6.7},{label:'E',x:-11,y:91,thickness:4.25}];
const measuredEnvelope=measurements.map(p=>{
  const floorZ=deck-depthAt(main[0].depthProfile!,largeLength,p.y-sourceBounds[0].min),toolTopZ=floorZ+p.thickness;
  assert(toolTopZ<21-.8,'Measured large tool envelope reaches the rim');
  return{...p,floorZ,estimatedToolTopZ:toolTopZ,clearanceBelowWallTopMm:21-toolTopZ};
});
try {
  const kernel:Kernel={Manifold:wasm.Manifold,CrossSection:wasm.CrossSection,triangulate:wasm.triangulate,arena};
  const built=buildBinWithCutouts(kernel,project.spec,{shapesById:shapes,cutouts:project.cutouts,fingerHoles:holes},EXPORT_QUALITY);
  assert.deepEqual(built.validationIssues.filter(i=>i.severity==='error'),[]);
  const solid=arena.track(built.solid.simplify(.000001));
  assert.equal(solid.status(),'NoError');assert(solid.volume()>0);
  assert(Math.abs(solid.volume()-built.solid.volume())<.001,'Cleanup changed solid geometry');
  assert.equal(solid.decompose().map(s=>arena.track(s)).length,1,'Bin must be connected');
  const lipRemoved=built.parts.lip?arena.track(built.parts.lip.subtract(solid)).volume():0;
  assert(lipRemoved<.001,'A cavity intersects the stacking lip');
  const blank=buildBinWithCutouts(kernel,project.spec,{shapesById:shapes,cutouts:[],fingerHoles:[]},EXPORT_QUALITY);
  const protectedBase=arena.track(arena.track(wasm.Manifold.cube([300,150,6.99999])).translate([-150,-75,0]));
  const removedBase=arena.track(arena.track(blank.solid.subtract(solid)).intersect(protectedBase)).volume();
  assert(removedBase<.001,'A pocket cut into the protected base');
  const removedGroups=main.map((owner,i)=>{
    const group=buildBinWithCutouts(kernel,project.spec,{shapesById:shapes,
      cutouts:project.cutouts.filter(p=>p.id===owner.id||p.id.startsWith(owner.id+'-')),fingerHoles:holes.slice(i*2,i*2+2)},EXPORT_QUALITY);
    return arena.track(blank.solid.subtract(group.solid));
  });
  const cavityGroupOverlap=arena.track(removedGroups[0].intersect(removedGroups[1])).volume();
  assert(cavityGroupOverlap<.001,'Scissor cavities overlap, including auxiliary cutters');
  // Include clearance and the flared finger mouths, plus a 0.5 mm reserve on
  // each group: no intersection proves at least 1 mm of separation in plan.
  const groupSections=main.map((p,i)=>{
    let section=arena.track(toCrossSection(kernel,transformOutlinePlacement(shapes.get(p.shapeId)!.outlineMm,p)).offset(1.1,'Round',2,96));
    for(const h of holes.slice(i*2,i*2+2))section=arena.track(section.add(arena.track(arena.track(wasm.CrossSection.circle(h.diameterMm/2+1.7,128)).translate([h.center.x,h.center.y]))));
    return section;
  });
  const overlap=arena.track(groupSections[0].intersect(groupSections[1])).area();assert(overlap<1e-6,'Mirrored groups overlap their 1 mm separation reserve');
  let floorProbes=0,auxiliaryProbes=0;
  const probe=(point:Point,z:number,filled:boolean)=>{
    const cube=arena.track(arena.track(wasm.Manifold.cube([.01,.01,.01])).translate([point.x-.005,point.y-.005,z-.005]));
    const volume=arena.track(solid.intersect(cube)).volume();
    assert(Math.abs(volume-(filled?.000001:0))<1e-9,`Floor probe failed: ${JSON.stringify({point,z,filled,volume})}`);
  };
  const samplePoints:Point[][]=[measurements.map(p=>({x:p.x,y:p.y})),[{x:-30,y:-66},{x:30,y:-66},{x:-1,y:-6},{x:-2,y:15},{x:0,y:45},{x:1,y:73}]];
  for(let i=0;i<2;i++) {
    const p=main[i],shape=shapes.get(p.shapeId)!,bounds=sourceBounds[i];
    for(const back of [2,1,.5]) {
      const y=bounds.max-back,xs:number[]=[];
      for(const part of shape.outlineMm)for(let j=0;j<part.outer.length;j++){
        const a=part.outer[j],b=part.outer[(j+1)%part.outer.length];
        if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y));
      }
      xs.sort((a,b)=>a-b);assert(xs.length>=2&&xs.length%2===0);
      const intervals=xs.filter((_,j)=>j%2===0).map((x,j)=>({a:x,b:xs[2*j+1]})).sort((a,b)=>(b.b-b.a)-(a.b-a.a));
      samplePoints[i].push({x:(intervals[0].a+intervals[0].b)/2,y});
    }
    for(const point of samplePoints[i]) {
      const floor=deck-depthAt(p.depthProfile!,bounds.length,point.y-bounds.min),world=transformPointPlacement(point,p);
      probe(world,floor-.03,true);probe(world,floor+.03,false);floorProbes+=2;
    }
  }
  for(const p of auxiliaries) {
    const shape=shapes.get(p.shapeId)!,point=ringCentroid(shape.outlineMm[0].outer)!,bounds=profileAxisBounds(shape.outlineMm,'y');
    const floor=deck-depthAt(p.depthProfile!,bounds.length,point.y-bounds.min),world=transformPointPlacement(point,p);
    probe(world,floor-.035,true);
    for(const z of [floor+.035,(floor+deck)/2,deck-.035])probe(world,z,false);
    auxiliaryProbes+=4;
  }
  const mesh=extractPrintableMeshData(kernel,solid),stl=Buffer.from(writeBinarySTL(mesh));
  const threeMf=writeThreeMf([{name:'Combined scissors bin',mesh}],{title:project.name});
  // Check serialized Float32 coordinates, rather than relying on native topology alone.
  const triangles=stl.readUInt32LE(80),edges=new Map<string,{count:number;winding:number}>();
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let volume=0;
  assert.equal(stl.length,84+50*triangles);
  const key=(p:number[])=>p.map(v=>v===0?'0':String(v)).join(',');
  for(let i=0;i<triangles;i++) {
    const p=[0,1,2].map(j=>[0,1,2].map(k=>stl.readFloatLE(84+i*50+12+j*12+k*4)));
    for(const q of p)for(let k=0;k<3;k++){assert(Number.isFinite(q[k]));min[k]=Math.min(min[k],q[k]);max[k]=Math.max(max[k],q[k]);}
    volume+=(p[0][0]*(p[1][1]*p[2][2]-p[1][2]*p[2][1])+p[0][1]*(p[1][2]*p[2][0]-p[1][0]*p[2][2])+p[0][2]*(p[1][0]*p[2][1]-p[1][1]*p[2][0]))/6;
    for(let j=0;j<3;j++){const a=key(p[j]),b=key(p[(j+1)%3]);assert(a!==b,'Degenerate edge');const edge=a<b?`${a}|${b}`:`${b}|${a}`,e=edges.get(edge)??{count:0,winding:0};e.count++;e.winding+=a<b?1:-1;edges.set(edge,e);}
  }
  const bad=[...edges].filter(([,e])=>e.count!==2||e.winding!==0); assert.deepEqual(bad.slice(0,8),[],'Nonmanifold serialized STL edges');assert(volume>0);
  const model=strFromU8(unzipSync(threeMf)['3D/3dmodel.model']);
  assert(model.includes('unit="millimeter"'));assert.equal((model.match(/<object /g)??[]).length,1);assert.equal((model.match(/<triangle /g)??[]).length,triangles);
  const dimensions=max.map((v,i)=>v-min[i]);assert(dimensions.every((v,i)=>Math.abs(v-[251.5,83.5,24.551471862576143][i])<.0001));
  await writeFile(resolve(out,'scissors-combined-06.stl'),stl);
  await writeFile(resolve(out,'scissors-combined-06.3mf'),threeMf);
  await writeFile(resolve(out,'scissors-combined-06.pocketry.json'),JSON.stringify(serializeProjectDoc(project),null,2)+'\n');
  Object.assign(verification,{connectedSolid:true,watertightSerializedStl:true,consistentWinding:true,triangles,volumeCm3:volume/1000,dimensionsMm:dimensions,floorProbes,auxiliaryProbes,stackingLipRemovedMm3:lipRemoved,protectedBaseRemovedMm3:removedBase,cavityGroupOverlapMm3:cavityGroupOverlap,groupOverlapIncludingOneMmReserveMm2:overlap,cleanupToleranceMm:.000001,cleanupVolumeChangeMm3:solid.volume()-built.solid.volume(),
    stlSha256:createHash('sha256').update(stl).digest('hex'),threeMfSha256:createHash('sha256').update(threeMf).digest('hex')});
  // Actual CAD horizontal sections provide a useful lightweight preview even
  // on machines where the interactive WebGL viewer is unavailable.
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="740"><rect width="1300" height="740" fill="#f5f8fa"/><g font-family="Segoe UI,Arial,sans-serif" fill="#193d52"><text x="30" y="36" font-size="26" font-weight="600">Combined scissors 06 · logo-up large pocket</text><text x="30" y="64" font-size="17">Same 6 × 2 bin · 0.60 mm edge clearance · whole stacking lip retained</text>';
  const path=(outline:Outline,scale:number,cx:number,cy:number)=>outline.flatMap(s=>[s.outer,...s.holes]).map(r=>r.map((p,k)=>`${k?'L':'M'}${cx+p.x*scale},${cy-p.y*scale}`).join(' ')+' Z').join(' ');
  const section=arena.track(solid.slice(deck-.01));
  const sectionOutline=section.toPolygons().map(r=>({outer:r.map(p=>({x:p[0],y:p[1]})),holes:[]}));
  svg+=`<path d="${path(sectionOutline,4.7,650,292)}" fill="#6692aa" fill-rule="evenodd" stroke="#355f78" stroke-width=".6"/>`;
  for(let i=0;i<2;i++){
    svg+=`<text x="${i?940:350}" y="535" font-size="19" font-weight="600">${i?'Small':'Large'} pocket floor · side profile</text>`;
    const x0=i?730:60,width=510,baseY=681,bounds=sourceBounds[i];
    svg+=`<path d="M${x0},${baseY-21*5}h${width}" stroke="#91a1ab" stroke-dasharray="5 4" fill="none"/><text x="${x0}" y="${baseY-21*5-5}" font-size="12">Wall top Z 21</text>`;
    for(const [profile,isNew] of [[owners[i].depthProfile!,false],[main[i].depthProfile!,true]] as const){
      const points=depthProfileSegments(profile,bounds.length).flatMap(s=>[[s.fromMm,s.fromDepthMm],[s.toMm,s.toDepthMm]]);
      const d=points.map(([at,depth],j)=>`${j?'L':'M'}${x0+width*at/bounds.length},${baseY-(deck-depth)*5}`).join(' ');
      svg+=`<path d="${d}" stroke="${isNew?'#216897':'#c88a38'}" stroke-width="${isNew?3:2}" ${isNew?'':'stroke-dasharray="5 4"'} fill="none"/>`;
    }
    svg+=`<text x="${x0}" y="714" font-size="14">Handle → blade tip · blue revised / dashed previous</text>`;
  }
  svg+='</g></svg>';await writeFile(resolve(out,'layout-and-seating.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(resolve(out,'layout-and-seating.png'));
  let curvesSvg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560"><rect width="1000" height="560" fill="#f5f8fa"/><defs><clipPath id="left"><rect x="30" y="115" width="440" height="395"/></clipPath><clipPath id="right"><rect x="530" y="115" width="440" height="395"/></clipPath></defs><g font-family="Segoe UI,Arial,sans-serif" fill="#193d52"><text x="30" y="35" font-size="24" font-weight="600">Localized curve corrections</text><text x="30" y="63" font-size="16">Orange: original · Blue: revised · Source orientation, blade pointing up</text>';
  for(let i=0;i<2;i++) {
    const old=original.shapes.find(s=>s.id===original.cutouts[i].shapeId)!,next=shapes.get(main[i].shapeId)!;
    const cx=i?756:250,cy=i?356:310,zoom=i?24:10,focus=i?{x:0,y:81}:{x:28,y:-56};
    curvesSvg+=`<text x="${i?530:30}" y="99" font-size="17" font-weight="600">${i?'Small blade tip · max 0.10 mm':'Large handle, 1–2 o’clock · max 0.25 mm'}</text><g clip-path="url(#${i?'right':'left'})">`;
    for(const [outline,isNew] of [[old.outlineMm,false],[next.outlineMm,true]] as const) {
      curvesSvg+=`<path d="${path(outline,zoom,cx-focus.x*zoom,cy+focus.y*zoom)}" stroke="${isNew?'#146eac':'#d78b2f'}" stroke-width="${isNew?2:3}" fill="none"/>`;
    }
    curvesSvg+='</g>';
  }
  curvesSvg+='</g></svg>';await writeFile(resolve(out,'curve-comparison.svg'),curvesSvg);await sharp(Buffer.from(curvesSvg)).png().toFile(resolve(out,'curve-comparison.png'));
}finally{arena.dispose();}
const report={name:project.name,settings:{...settings,smallPocketLowerMm:lower},curveReports,largeSeatPitchDegrees:Math.atan(settings.largeTipPitchRiseMm/largeLength)*180/Math.PI,measuredLargeEnvelope:measuredEnvelope,access,issues,verification,
  notes:['Full combined bin, not a coupon.','Large is mirrored to show the logo; old underside-gap data came from the opposite face and needs a physical recheck.','The large seat adds a 4 mm end-to-end linear rise (about 1.1 degrees), retaining old local underside relief. Vertical shear approximates this shallow rigid tilt.','Small gets +0.2 mm support over the last 35 mm. No measured small thickness was supplied; rim clearance cannot be inferred from the photo.','--small-lower MM deepens the entire small group, access floors and bevels together, preserving the tip correction. Zero is the default until interference is confirmed.','Native checks require the complete stacking lip and base below Z 7 to remain unchanged.','These are model-only STL/3MF files, not sliced printer jobs.']};
await writeFile(resolve(out,'fit-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
