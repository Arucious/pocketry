import {open} from "node:fs/promises";
import {projectFeatureEditsSchema} from "../../shared/gridfinity/feature-edits";
export const EDIT_FEATURES_USAGE=`Usage: npm run edit:features -- --project FILE --operation JSON_FILE --out NEW_PROJECT_FILE
Use --plan instead of --out to print the edited project without writing it.
Operation: {"pockets":[{"id":"pocket-id","springs":[{"id":"spring-id","atMm":40}]}]}
Spring lists replace existing retainers. An empty list removes all springs.
Contour distance is source millimetres; other dimensions are physical millimetres.
Existing inputs and outputs are never overwritten.`;
export function parseFeatureEditArgs(argv:readonly string[]) {
  let projectPath:string|undefined,operationPath:string|undefined,outPath:string|undefined,plan=false;
  const seen=new Set<string>();
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];if(seen.has(flag))throw new Error(`Duplicate argument: ${flag}`);seen.add(flag);
    const value=()=>{const v=argv[++i];if(!v||v.startsWith("--"))throw new Error(`${flag} requires a value.`);return v;};
    if(flag==="--project")projectPath=value();else if(flag==="--operation")operationPath=value();else if(flag==="--out")outPath=value();else if(flag==="--plan")plan=true;else throw new Error(`Unknown argument: ${flag}`);
  }
  if(!projectPath||!operationPath)throw new Error("Provide --project and --operation.");
  if(plan&&outPath)throw new Error("Choose --plan or --out, not both.");
  if(!plan&&!outPath)throw new Error("Provide --out NEW_PROJECT_FILE or use --plan.");
  return{projectPath,operationPath,outPath,plan};
}
export async function readFeatureOperation(path:string) {
  const file=await open(path,"r");try {
    if(!(await file.stat()).isFile())throw new Error("Feature operation must be a file.");
    const limit=128*1024,buffer=Buffer.alloc(limit+1);let count=0;
    while(count<buffer.length){const r=await file.read(buffer,count,buffer.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
    if(count>limit)throw new Error("Feature operation exceeds 128 KiB.");
    return projectFeatureEditsSchema.parse(JSON.parse(buffer.subarray(0,count).toString("utf8")));
  }finally{await file.close();}
}
