import {open,realpath} from "node:fs/promises";
import {resolve} from "node:path";
import {serializeProjectDoc} from "../shared/gridfinity/project";
import {editProjectFeatures} from "../shared/gridfinity/feature-edits";
import {readProjectFile} from "./lib/export-bin";
import {parseFeatureEditArgs,readFeatureOperation,EDIT_FEATURES_USAGE} from "./lib/edit-features";
async function main() {
  const argv=process.argv.slice(2);if(argv.length===1&&argv[0]==="--help"){console.log(EDIT_FEATURES_USAGE);return;}
  const args=parseFeatureEditArgs(argv),project=await readProjectFile(args.projectPath),operation=await readFeatureOperation(args.operationPath),edited=editProjectFeatures(project,operation);
  if(args.plan){console.log(JSON.stringify(edited,null,2));return;}
  const path=resolve(args.outPath!);if(path===await realpath(args.projectPath))throw new Error("Choose a new output file; the input is preserved.");
  const file=await open(path,"wx");try{await file.writeFile(JSON.stringify(serializeProjectDoc(edited.project),null,2)+"\n");}finally{await file.close();}
  console.log(JSON.stringify({path,issues:edited.issues},null,2));
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
