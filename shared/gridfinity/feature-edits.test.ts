import {describe,it,expect} from "vitest";
import {editProjectFeatures} from "./feature-edits";
import {projectDocSchema,PROJECT_SCHEMA_VERSION,parseProjectDoc} from "./project";
import {springShape,springSpec,springPocket,leaf} from "./fixtures/wall-springs";
import {fingerHoleSchema} from "./cutout";
const project=()=>projectDocSchema.parse({schemaVersion:PROJECT_SCHEMA_VERSION,spec:springSpec,shapes:[springShape],cutouts:[springPocket],fingerHoles:[]});
describe("project feature edits",()=>{
  it("preserves sources, uses complete lists and adds portable undo",()=>{
    const before=project(),snapshot=JSON.stringify(before),after=editProjectFeatures(before,{pockets:[{id:"p",springs:[leaf]}]}).project;
    expect(JSON.stringify(before)).toBe(snapshot);expect(after.shapes).toEqual(before.shapes);
    expect(after.history?.stack[0].doc.cutouts[0].springs).toBeUndefined();
    expect(parseProjectDoc(JSON.parse(JSON.stringify(after)))).toEqual(after);
    expect(editProjectFeatures(after,{pockets:[{id:"p",springs:[]}]}).project.cutouts[0].springs).toEqual([]);
  });
  it("rejects duplicate or missing targets and unsafe placements before mutating",()=>{
    expect(()=>editProjectFeatures(project(),{pockets:[{id:"missing",springs:[leaf]}]})).toThrow(/does not exist/);
    expect(()=>editProjectFeatures(project(),{pockets:[{id:"p",springs:[]},{id:"p",springs:[]}]})).toThrow(/once/);
    expect(()=>editProjectFeatures(project(),{pockets:[{id:"p",springs:[{...leaf,rootFloorMm:6}]}]})).toThrow(/protect.*base/);
  });
  it("applies joining relief through the same validated CLI operation and preserves it in history",()=>{
    const p=project(),hole=fingerHoleSchema.parse({id:'h',center:{x:0,y:19},diameterMm:20,depthMm:8});
    p.fingerHoles=[hole];const edited=editProjectFeatures(p,{fingerAccess:[{id:'h',joiningChamferMm:1.2,joiningBlendMm:.5}]}).project;
    expect(edited.fingerHoles[0]).toMatchObject({joiningChamferMm:1.2,joiningBlendMm:.5});
    expect(edited.history?.stack[0].doc.fingerHoles[0].joiningBlendMm).toBeUndefined();
    expect(()=>editProjectFeatures(p,{fingerAccess:[{id:'h',joiningChamferMm:0,joiningBlendMm:.5}]})).toThrow(/positive joining/);
    expect(()=>editProjectFeatures(p,{fingerAccess:[{id:'missing',joiningChamferMm:1.2}]})).toThrow(/does not exist/);
  });
});
