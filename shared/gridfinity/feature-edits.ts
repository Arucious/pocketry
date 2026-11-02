import {z} from "zod";
import {wallSpringSchema} from "./spring-schema";
import {fingerHoleSchema} from "./cutout";
import {projectDocSchema,type ProjectDoc} from "./project";
import {applyLinkedEdits} from "./design-links";
import {validateLayout} from "./validate";
import {BIN_HISTORY_LIMIT} from "./history";
export const projectFeatureEditsSchema=z.object({
  pockets:z.array(z.object({id:z.string().min(1),springs:z.array(wallSpringSchema).max(32)}).strict()).max(64).optional(),
  fingerAccess:z.array(z.object({id:z.string().min(1),joiningChamferMm:z.number().finite().min(0).max(5),joiningBlendMm:z.number().finite().min(0).max(3).default(0)}).strict()).max(64).optional(),
}).strict().refine(v=>(v.pockets?.length??0)+(v.fingerAccess?.length??0)>0,"Provide at least one pocket or finger-access feature edit.");
/** Complete spring lists are replacements; an empty list removes all leaves.
 * Linked designs and portable undo use the same path as interactive edits. */
export function editProjectFeatures(input:ProjectDoc,operation:unknown) {
  const project=projectDocSchema.parse(input),edit=projectFeatureEditsSchema.parse(operation),ids=edit.pockets?.map(p=>p.id)??[];
  if(new Set(ids).size!==ids.length)throw new Error("A pocket may only appear once in a feature edit.");
  for(const id of ids)if(!project.cutouts.some(p=>p.id===id))throw new Error(`Pocket ${id} does not exist.`);
  const fingers=edit.fingerAccess?.map(h=>h.id)??[];
  if(new Set(fingers).size!==fingers.length)throw new Error("Finger access may only appear once in a feature edit.");
  for(const id of fingers)if(!project.fingerHoles.some(h=>h.id===id))throw new Error(`Finger access ${id} does not exist.`);
  const next=applyLinkedEdits(project,{cutouts:project.cutouts.map(p=>{const e=edit.pockets?.find(x=>x.id===p.id);return e?{...p,springs:e.springs}:p;}),fingerHoles:project.fingerHoles.map(h=>{const e=edit.fingerAccess?.find(x=>x.id===h.id);return e?{...h,joiningChamferMm:e.joiningChamferMm,joiningBlendMm:e.joiningBlendMm}:h;})});
  if(next)next.fingerHoles=next.fingerHoles.map(h=>fingerHoleSchema.parse(h));
  if(!next)throw new Error("Linked features contain conflicting edits.");
  const issues=validateLayout(project.spec,next.cutouts,new Map(project.shapes.map(s=>[s.id,s])),next.fingerHoles),errors=issues.filter(i=>i.severity==="error");
  if(errors.length)throw new Error(errors.map(i=>i.message).join("\n"));
  const before={spec:project.spec,cutouts:project.cutouts,fingerHoles:project.fingerHoles},after={spec:project.spec,...next};
  const stack=[...(project.history?.stack.slice(0,project.history.index+1)??[{doc:before,label:"Before pocket feature edit"}]),{doc:after,label:"Edit pocket features"}].slice(-BIN_HISTORY_LIMIT);
  return{project:projectDocSchema.parse({...project,...next,history:{stack,index:stack.length-1}}),issues};
}
