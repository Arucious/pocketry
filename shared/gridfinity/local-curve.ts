import {refineCurveSpan,type LocalCurveInput} from "../geometry/local-curve";
import {outlineBounds,outlinePointCount} from "../geometry/outline";
import {applyLinkedEdits} from "./design-links";
import {BIN_HISTORY_LIMIT} from "./history";
import {projectDocSchema,type ProjectDoc} from "./project";
import {validateLayout} from "./validate";

/** Headless edits use the same immutable outlines, design links and undo data
 * as the editor. Existing shape ids remain available to history and origins. */
export function refineProjectPocket(input:ProjectDoc,pocketId:string,operation:LocalCurveInput,newShapeId:string) {
  const project=projectDocSchema.parse(input),pocket=project.cutouts.find(c=>c.id===pocketId);
  if(!pocket)throw new Error("Pocket id does not exist in the project.");
  const source=project.shapes.find(s=>s.id===pocket.shapeId);
  if(!source)throw new Error("Pocket source shape is missing.");
  if(!newShapeId||project.shapes.some(s=>s.id===newShapeId))throw new Error("Choose a new immutable shape id.");
  const result=refineCurveSpan(source.outlineMm,operation);
  if(result.maximumMove<1e-10)return {project:input,result,issues:validateLayout(project.spec,project.cutouts,new Map(project.shapes.map(s=>[s.id,s])),project.fingerHoles)};
  const shape={...source,id:newShapeId,outlineMm:result.outline,bboxMm:outlineBounds(result.outline)!,pointCount:outlinePointCount(result.outline)};
  const edits=applyLinkedEdits(project,{cutouts:project.cutouts.map(c=>c.id===pocketId?{...c,shapeId:newShapeId}:c),fingerHoles:project.fingerHoles});
  if(!edits)throw new Error("Linked copies cannot accept conflicting curve edits.");
  const shapes=[...project.shapes,shape],issues=validateLayout(project.spec,edits.cutouts,new Map(shapes.map(s=>[s.id,s])),edits.fingerHoles);
  const errors=issues.filter(i=>i.severity==="error");if(errors.length)throw new Error(errors.map(i=>i.message).join("\n"));
  const before={spec:project.spec,cutouts:project.cutouts,fingerHoles:project.fingerHoles},after={spec:project.spec,...edits};
  const stack=[...(project.history?.stack.slice(0,project.history.index+1)??[{doc:before,label:"Before local curve refinement"}]),{doc:after,label:"Refine local curve"}].slice(-BIN_HISTORY_LIMIT);
  return {project:projectDocSchema.parse({...project,shapes,...edits,history:{stack,index:stack.length-1}}),result,issues};
}
