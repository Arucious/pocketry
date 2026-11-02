import {createHash} from "node:crypto";
import {open,realpath} from "node:fs/promises";
import {resolve} from "node:path";
import {refineProjectPocket} from "../shared/gridfinity/local-curve";
import {serializeProjectDoc} from "../shared/gridfinity/project";
import {readProjectFile} from "./lib/export-bin";
import {parseRefineCurveArgs,readCurveOperation,REFINE_CURVE_USAGE} from "./lib/refine-curve";

async function main() {
  const argv=process.argv.slice(2);if(argv.length===1&&argv[0]==="--help"){console.log(REFINE_CURVE_USAGE);return;}
  const args=parseRefineCurveArgs(argv),project=await readProjectFile(args.projectPath),operation=args.operation??await readCurveOperation(args.operationPath!);
  const source=project.cutouts.find(c=>c.id===args.pocketId)?.shapeId??"missing";
  const id=`curve-${createHash("sha256").update(source).update(JSON.stringify(operation)).digest("hex")}`;
  const edited=refineProjectPocket(project,args.pocketId,operation,id);
  const report={pocketId:args.pocketId,operation,maximumMoveMm:edited.result.maximumMove,rmsMoveMm:edited.result.rmsMove,limited:edited.result.limited,fit:edited.result.fit,issues:edited.issues};
  if(args.plan){console.log(JSON.stringify({report,project:edited.project},null,2));return;}
  const path=resolve(args.outPath!);
  if(path===(await realpath(args.projectPath)))throw new Error("Choose a new output file; the input is preserved.");
  // Exclusive creation also protects pre-existing files and symlink aliases.
  const file=await open(path,"wx");try{await file.writeFile(JSON.stringify(serializeProjectDoc(edited.project),null,2)+"\n");}finally{await file.close();}
  console.log(JSON.stringify({path,report},null,2));
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
