import {mkdtemp,writeFile,readFile,readdir,rm} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,it,expect} from "vitest";
import {parseFeatureEditArgs,readFeatureOperation} from "./edit-features";
import {springShape,springSpec,springPocket} from "../../shared/gridfinity/fixtures/wall-springs";
import {PROJECT_SCHEMA_VERSION,projectDocSchema} from "../../shared/gridfinity/project";
describe("feature editing CLI boundary",()=>{
  it("requires explicit planning or a new output and rejects ambiguous options",()=>{
    const args=["--project","input","--operation","op","--plan"];
    expect(parseFeatureEditArgs(args).plan).toBe(true);
    expect(()=>parseFeatureEditArgs([...args,"--out","output"])).toThrow(/not both/);
    expect(()=>parseFeatureEditArgs([...args,"--plan"])).toThrow(/Duplicate/);
    expect(()=>parseFeatureEditArgs(args.slice(0,-1))).toThrow(/--out/);
    expect(()=>parseFeatureEditArgs([...args,"--unknown"])).toThrow(/Unknown/);
  });
  it("bounds operation reads and applies the shared schema",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"pocket-features-")),path=join(dir,"op.json");
    try {
      await writeFile(path,JSON.stringify({pockets:[{id:"p",springs:[{id:"s",atMm:40}]}]}));
      expect((await readFeatureOperation(path)).pockets?.[0].springs[0].heightMm).toBe(10);
      await writeFile(path," ".repeat(128*1024+1));await expect(readFeatureOperation(path)).rejects.toThrow(/128 KiB/);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it("plans and writes through the real CLI without overwriting existing files",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"feature-cli-")),input=join(dir,'input.json'),operation=join(dir,'op.json'),output=join(dir,'output.json');
    try {
      const original=JSON.stringify(projectDocSchema.parse({schemaVersion:PROJECT_SCHEMA_VERSION,spec:springSpec,shapes:[springShape],cutouts:[springPocket],fingerHoles:[]}));
      await writeFile(input,original);await writeFile(operation,JSON.stringify({pockets:[{id:'p',springs:[{id:'s',atMm:40}]}]}));
      const args=['--import','tsx','scripts/edit-features.ts','--project',input,'--operation',operation],run=promisify(execFile);
      const plan=JSON.parse((await run(process.execPath,[...args,'--plan'])).stdout);
      expect(plan.project.cutouts[0].springs[0].atMm).toBe(40);expect(await readdir(dir)).toEqual(['input.json','op.json']);
      await run(process.execPath,[...args,'--out',output]);const saved=await readFile(output,'utf8');
      await expect(run(process.execPath,[...args,'--out',output])).rejects.toThrow();expect(await readFile(output,'utf8')).toBe(saved);
      await expect(run(process.execPath,[...args,'--out',input])).rejects.toThrow(/input is preserved/);expect(await readFile(input,'utf8')).toBe(original);
    }finally{await rm(dir,{recursive:true,force:true});}
  },20000);
});
