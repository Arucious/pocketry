import {open} from "node:fs/promises";
import {localCurveOptionsSchema,type LocalCurveInput} from "../../shared/geometry/local-curve";

export const REFINE_CURVE_USAGE=`Usage: npm run refine:curve -- --project FILE --pocket ID --start INDEX --end INDEX
  [--method smooth|arc|ellipse] [--path forward|backward] [--max-change MM]
  [--strength 0..1] [--iterations N] [--shape-index N] [--ring-index N]
  [--outward-only] [--free-end-directions] --out NEW_PROJECT_FILE
Or use --operation FILE for a JSON local-curve operation instead of inline options.
--plan prints the preview project and report without writing files.
Indices are zero-based on the saved source ring; ring index -1 means outer.
Distances are source millimetres before pocket placement scaling.
Inputs are never overwritten. --help prints this message.`;
export function parseRefineCurveArgs(argv:readonly string[]) {
  let projectPath:string|undefined,pocketId:string|undefined,outPath:string|undefined,operationPath:string|undefined,plan=false;
  const operation:Record<string,unknown>={},seen=new Set<string>();
  const numbers:Record<string,string>={"--start":"startIndex","--end":"endIndex","--max-change":"maxDeviation","--strength":"strength","--iterations":"iterations","--shape-index":"shapeIndex","--ring-index":"ringIndex"};
  for(let i=0;i<argv.length;i++) {
    const flag=argv[i];if(seen.has(flag))throw new Error(`Duplicate argument: ${flag}`);seen.add(flag);
    const value=()=>{const next=argv[++i];if(next===undefined||next.startsWith("--")||!next.trim())throw new Error(`${flag} requires a value.`);return next;};
    if(flag==="--project")projectPath=value();else if(flag==="--pocket")pocketId=value();else if(flag==="--out")outPath=value();
    else if(flag==="--operation")operationPath=value();else if(flag==="--plan")plan=true;
    else if(flag==="--outward-only")operation.outwardOnly=true;else if(flag==="--free-end-directions")operation.preserveTangents=false;
    else if(flag==="--method")operation.method=value();else if(flag==="--path")operation.direction=value();
    else if(numbers[flag]){const n=Number(value());if(!Number.isFinite(n))throw new Error(`${flag} requires a finite number.`);operation[numbers[flag]]=n;}
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if(!projectPath||!pocketId)throw new Error("Provide --project FILE and --pocket ID.");
  if(plan&&outPath)throw new Error("Choose --plan or --out, not both.");
  if(!plan&&!outPath)throw new Error("Provide --out NEW_PROJECT_FILE or use --plan.");
  if(operationPath&&Object.keys(operation).length)throw new Error("Choose a JSON operation or inline curve options.");
  return{projectPath,pocketId,outPath,operationPath,plan,operation:operationPath?undefined:localCurveOptionsSchema.parse(operation)};
}
/** Bound reads from the opened handle, including when a file changes mid-read. */
export async function readCurveOperation(path:string):Promise<LocalCurveInput> {
  const file=await open(path,"r");
  try {
    if(!(await file.stat()).isFile())throw new Error("Curve operation must be a file.");
    const limit=128*1024,buffer=Buffer.alloc(limit+1);let count=0;
    while(count<buffer.length){const read=await file.read(buffer,count,buffer.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}
    if(count>limit)throw new Error("Curve operation exceeds 128 KiB.");
    return localCurveOptionsSchema.parse(JSON.parse(buffer.subarray(0,count).toString("utf8")));
  }finally{await file.close();}
}
