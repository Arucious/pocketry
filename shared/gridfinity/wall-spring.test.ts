import {describe,it,expect} from "vitest";
import {planWallSpring,wallSpringIssues,nearestSpringAnchor,springReleaseRing} from "./wall-spring";
import {BACKED_LEAF as B} from "./spring-schema";
import {signedArea} from "../geometry/rings";
import {parseCutoutPlacement,fingerHoleSchema,transformPointPlacement} from "./cutout";
import {parseProjectDoc,projectDocSchema,PROJECT_SCHEMA_VERSION} from "./project";
import {applyLinkedEdits} from "./design-links";
import {springShape,springSpec,springPocket,leaf} from "./fixtures/wall-springs";
const shapes=new Map([[springShape.id,springShape]]);
describe("backed spring placement",()=>{
  it.each([false,true])("retains source anchors through mirrored=%s rotation and independent scaling",mirrored=>{
    const pocket={...springPocket,mirrored,scaleX:1.2,scaleY:.8,rotationDeg:31,position:{x:4,y:7}};
    const p=transformPointPlacement({x:0,y:-15},pocket),anchor=nearestSpringAnchor(springShape,pocket,p);
    expect(anchor.atMm).toBeCloseTo(40);expect(anchor.ringIndex).toBe(-1);
    const plan=planWallSpring(springSpec,pocket,springShape,{...leaf,...anchor});
    expect(Math.hypot(plan.center.x-p.x,plan.center.y-p.y)).toBeCloseTo(.6);
    expect(plan.rootZ).toBe(7);expect(plan.topZ).toBe(17);expect(plan.contactZ).toBe(15.5);
  });
  it("blocks finger access across the full housing, including flared or elongated mouths",()=>{
    const hole=fingerHoleSchema.parse({id:"grip",center:{x:4,y:-13},diameterMm:6,topChamferMm:1});
    expect(wallSpringIssues(springSpec,[{...springPocket,springs:[leaf]}],shapes,[hole]).issues[0].message).toMatch(/finger access/);
    const slot=fingerHoleSchema.parse({...hole,kind:"oblong-straight",lengthMm:30,center:{x:14,y:-14}});
    expect(wallSpringIssues(springSpec,[{...springPocket,springs:[leaf]}],shapes,[slot]).issues[0].message).toMatch(/finger access/);
  });
  it.each([0,.6,1])("locates the stem from the nominal tool, preserving rear travel with clearance %s",clearanceMm=>{
    const plan=planWallSpring(springSpec,{...springPocket,clearanceMm},springShape,leaf);
    expect(plan.beamFrontMm).toBeCloseTo(.2-clearanceMm);
    expect(plan.beamFrontMm+clearanceMm).toBeCloseTo(.2);
    expect(plan.backStopMm-plan.beamFrontMm-B.beamMm).toBeCloseTo(.4);
    expect(plan.beamFrontMm-plan.releaseFrontMm).toBeGreaterThanOrEqual(.8-1e-8);
    expect(plan.surfaceZ-plan.entryChamferMm).toBeGreaterThan(plan.topZ);
    const ring=springReleaseRing(5,plan.backStopMm,plan.releaseFrontMm);
    expect(signedArea(ring)).toBeGreaterThan(0);expect(ring.length).toBeGreaterThan(30);
  });
  it("blocks shallow contact, base cuts, insufficient backing, sharp corners, foreign pockets and duplicate housings",()=>{
    const plan=(p=springPocket,s=leaf,spec=springSpec)=>()=>planWallSpring(spec,p,springShape,s);
    expect(plan({...springPocket,depth:{mode:"remaining",floorThicknessMm:15}})).toThrow(/below.*floor/);
    expect(plan(springPocket,{...leaf,rootFloorMm:6.9})).toThrow(/protect.*base/);
    expect(plan(springPocket,leaf,{...springSpec,heightUnits:2})).toThrow(/filled wall height/);
    expect(plan(springPocket,{...leaf,atMm:0})).toThrow(/bends too sharply/);
    const neighbor={...springPocket,id:"other",position:{x:0,y:-31}};
    expect(wallSpringIssues(springSpec,[{...springPocket,springs:[leaf]},neighbor],shapes,[]).issues[0].message).toMatch(/Another pocket/);
    expect(wallSpringIssues(springSpec,[{...springPocket,springs:[leaf,{...leaf,id:"second",atMm:42}]}],shapes,[]).issues[0].message).toMatch(/housings overlap/);
  });
  it("keeps optional data in saved designs, undo snapshots and linked copies, without inventing springs in old files",()=>{
    const p={...springPocket,springs:[leaf],designLink:{id:"pair",tilt:false}},q={...p,id:"copy",position:{x:0,y:30}};
    const edits=applyLinkedEdits({cutouts:[p,q],fingerHoles:[]},{cutouts:[{...p,springs:[{...leaf,atMm:50}]},q],fingerHoles:[]})!;
    expect(edits.cutouts[1].springs?.[0].atMm).toBe(50);
    const doc=projectDocSchema.parse({schemaVersion:PROJECT_SCHEMA_VERSION,spec:springSpec,shapes:[springShape],...edits});
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc)))?.cutouts[0].springs).toEqual(edits.cutouts[0].springs);
    expect(parseProjectDoc({...doc,schemaVersion:39,cutouts:[springPocket]})?.cutouts[0].springs).toBeUndefined();
    expect(()=>parseCutoutPlacement({...springPocket,springs:[leaf,leaf]})).toThrow(/unique/);
  });
});
