import {describe,expect,it} from "vitest";
import {refineProjectPocket} from "./local-curve";
import {parseCutoutPlacement,type TracedShape} from "./cutout";
import {parseBinSpec} from "./types";
import {PROJECT_SCHEMA_VERSION,parseProjectDoc,projectDocSchema} from "./project";
import {outlineBounds} from "../geometry/outline";
const outlineMm=[{outer:Array.from({length:60},(_,i)=>{const t=i*2*Math.PI/60,r=i%4===0?10.2:10;return{x:r*Math.cos(t),y:r*Math.sin(t)};}),holes:[]}];
const shape:TracedShape={id:"source",name:"Loop",outlineMm,bboxMm:outlineBounds(outlineMm)!,pointCount:60,sourceMmPerPx:.1};
const pocket=parseCutoutPlacement({id:"a",shapeId:shape.id,position:{x:-15,y:0},depth:{mode:"mm",value:8},clearanceMm:.6,cornerRoundMm:0});
export const curveTestProject=()=>projectDocSchema.parse({schemaVersion:PROJECT_SCHEMA_VERSION,name:"Curve fixture",spec:parseBinSpec({gridX:3,gridY:3,heightUnits:3,fill:"solid"}),shapes:[shape],cutouts:[pocket],fingerHoles:[]});
const operation={startIndex:5,endIndex:30,maxDeviation:.2};
describe("portable project curve edits",()=>{
  it("retains immutable sources, calibration and placement while adding one undo step",()=>{
    const project=curveTestProject(),saved=JSON.stringify(project),edited=refineProjectPocket(project,"a",operation,"revision");
    expect(JSON.stringify(project)).toBe(saved);
    expect(edited.project.shapes[0]).toEqual(shape);
    expect(edited.project.shapes[1].sourceMmPerPx).toBe(.1);
    expect(edited.project.cutouts[0]).toEqual({...project.cutouts[0],shapeId:"revision"});
    expect(edited.project.history?.stack.map(s=>s.doc.cutouts[0].shapeId)).toEqual(["source","revision"]);
    expect(parseProjectDoc(JSON.parse(JSON.stringify(edited.project)))).toEqual(edited.project);
  });
  it("updates linked copies together while leaving independent copies alone",()=>{
    const project=curveTestProject(),link={id:"group",tilt:false};
    project.cutouts=[{...pocket,designLink:link},{...pocket,id:"b",position:{x:15,y:0},designLink:link},{...pocket,id:"c",position:{x:0,y:30}}];
    const edited=refineProjectPocket(project,"a",operation,"revision");
    expect(edited.project.cutouts.map(c=>c.shapeId)).toEqual(["revision","revision","source"]);
    expect(edited.project.cutouts.map(c=>c.position)).toEqual(project.cutouts.map(c=>c.position));
  });
  it("does not create a revision for a no-op or reuse an existing id",()=>{
    const project=curveTestProject();
    expect(refineProjectPocket(project,"a",{...operation,strength:0},"revision").project).toBe(project);
    expect(()=>refineProjectPocket(project,"a",operation,"source")).toThrow(/immutable/);
    expect(()=>refineProjectPocket(project,"missing",operation,"revision")).toThrow(/exist/);
  });
});
