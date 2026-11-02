import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {parseRefineCurveArgs,readCurveOperation} from "./refine-curve";
import {parseBinSpec} from "../../shared/gridfinity/types";
import {parseCutoutPlacement} from "../../shared/gridfinity/cutout";
import {PROJECT_SCHEMA_VERSION,projectDocSchema} from "../../shared/gridfinity/project";
import {outlineBounds} from "../../shared/geometry/outline";
import {readProjectFile} from "./export-bin";
const directories:string[]=[];
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
const args=["--project","input.json","--pocket","p","--start","5","--end","30","--plan"];
describe("local curve CLI",()=>{
  it("parses bounded region/method flags and rejects ambiguous operations",()=>{
    expect(parseRefineCurveArgs([...args,"--method","ellipse","--path","backward","--outward-only"]).operation).toMatchObject({method:"ellipse",direction:"backward",outwardOnly:true,startIndex:5,endIndex:30});
    expect(()=>parseRefineCurveArgs([...args,"--start","6"])).toThrow(/Duplicate/);
    expect(()=>parseRefineCurveArgs([...args,"--out","file"])).toThrow(/not both/);
    expect(()=>parseRefineCurveArgs([...args,"--operation","edit.json"])).toThrow(/JSON operation/);
    expect(()=>parseRefineCurveArgs([...args,"--max-change","NaN"])).toThrow(/finite/);
    expect(()=>parseRefineCurveArgs(args.slice(0,-1))).toThrow(/--out/);
  });
  it("bounds and validates operation files",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"curve-options-"));directories.push(dir);const path=join(dir,"operation.json");
    await writeFile(path,JSON.stringify({startIndex:5,endIndex:30,method:"arc",maxDeviation:.2}));
    expect(await readCurveOperation(path)).toMatchObject({method:"arc",maxDeviation:.2});
    await writeFile(path," ".repeat(128*1024+1));await expect(readCurveOperation(path)).rejects.toThrow(/128/);
  });
  it("runs plan/write modes through the real CLI and preserves the input and prior outputs",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"curve-cli-"));directories.push(dir);
    const outlineMm=[{outer:Array.from({length:60},(_,i)=>{const t=i*2*Math.PI/60,r=i%4===0?10.2:10;return{x:r*Math.cos(t),y:r*Math.sin(t)};}),holes:[]}];
    const input=join(dir,"input.json"),output=join(dir,"output.json");
    const project=projectDocSchema.parse({schemaVersion:PROJECT_SCHEMA_VERSION,spec:parseBinSpec({gridX:3,gridY:3,heightUnits:3,fill:"solid"}),shapes:[{id:"s",name:"Loop",outlineMm,bboxMm:outlineBounds(outlineMm)!,pointCount:60,sourceMmPerPx:.1}],cutouts:[parseCutoutPlacement({id:"p",shapeId:"s",position:{x:0,y:0},depth:{mode:"mm",value:8}})],fingerHoles:[]});
    const original=JSON.stringify(project);await writeFile(input,original);
    const base=["--import","tsx","scripts/refine-curve.ts","--project",input,"--pocket","p","--start","5","--end","30"];
    const plan=JSON.parse((await promisify(execFile)(process.execPath,[...base,"--plan"])).stdout);
    expect(plan.report.maximumMoveMm).toBeGreaterThan(0);expect(await readdir(dir)).toEqual(["input.json"]);
    await promisify(execFile)(process.execPath,[...base,"--out",output]);
    expect((await readProjectFile(output)).history?.stack).toHaveLength(2);
    expect(await readFile(input,"utf8")).toBe(original);
    const saved=await readFile(output,"utf8");
    await expect(promisify(execFile)(process.execPath,[...base,"--out",output])).rejects.toThrow();
    expect(await readFile(output,"utf8")).toBe(saved);
    await expect(promisify(execFile)(process.execPath,[...base,"--out",input])).rejects.toThrow(/input is preserved/);
    expect(await readFile(input,"utf8")).toBe(original);
  },20000);
});
