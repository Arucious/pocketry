import {useState} from "react";
import {wallSpringSchema,type WallSpring,BACKED_LEAF} from "@shared/gridfinity/spring-schema";
import {nearestSpringAnchor,planWallSpring,springRing} from "@shared/gridfinity/wall-spring";
import {transformOutlinePlacement,type CutoutPlacement,type TracedShape} from "@shared/gridfinity/cutout";
import {outlineBounds} from "@shared/geometry/outline";
import {ringPerimeter} from "@shared/geometry/rings";
import {applyLinkedEdits} from "@shared/gridfinity/design-links";
import {validateLayout} from "@shared/gridfinity/validate";
import {useBin} from "@/state/bin-store";
import {Button} from "@/components/ui/button";
import {DraftNumberInput} from "@/components/ui/draft-number-input";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";

export function PocketSpringControls({cutout,shape,shapes}:{cutout:CutoutPlacement;shape:TracedShape;shapes:readonly TracedShape[]}) {
  const {dispatch}=useBin(),[edit,setEdit]=useState<WallSpring|null>(null),[source,setSource]=useState(cutout);
  const open=(spring:WallSpring)=>{setSource(cutout);setEdit(spring);};
  return <details className="border-t pt-1 text-xs" open={!!cutout.springs?.length||undefined}>
    <summary className="cursor-pointer py-2 font-medium">Spring retainers{cutout.springs?.length?` (${cutout.springs.length})`:""}</summary>
    <div className="space-y-2 pb-3">
      <p className="text-muted-foreground">Released leaves with reinforced floor roots, rounded contacts and solid backing stops.</p>
      {cutout.springs?.map(s=><div key={s.id} className="flex items-center gap-2"><span className="flex-1">Wall at {s.atMm.toFixed(1)} mm · {s.widthMm} × {s.heightMm} mm</span>
        <Button size="sm" variant="outline" onClick={()=>open(s)}>Edit spring</Button><Button size="sm" variant="ghost" aria-label={`Remove spring ${s.id}`} onClick={()=>dispatch({type:"UPDATE_CUTOUT",id:cutout.id,patch:{springs:cutout.springs!.filter(x=>x.id!==s.id)},historyLabel:"Remove wall spring"})}>×</Button></div>)}
      <Button size="sm" variant="outline" disabled={(cutout.springs?.length??0)>=32} onClick={()=>open(wallSpringSchema.parse({id:crypto.randomUUID(),atMm:ringPerimeter(shape.outlineMm[0].outer)*.25}))}>Add wall spring</Button>
    </div>
    <Dialog open={edit!==null} onOpenChange={value=>{if(!value)setEdit(null);}}>{edit&&<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto"><SpringEditor initial={edit} source={source} current={cutout} shape={shape} shapes={shapes} onCancel={()=>setEdit(null)} onApply={spring=>{
      const springs=[...(cutout.springs??[]).filter(x=>x.id!==spring.id),spring];dispatch({type:"UPDATE_CUTOUT",id:cutout.id,patch:{springs},historyLabel:"Place wall spring"});setEdit(null);
    }}/></DialogContent>}</Dialog>
  </details>;
}
function SpringEditor({initial,source,current,shape,shapes,onApply,onCancel}:{initial:WallSpring;source:CutoutPlacement;current:CutoutPlacement;shape:TracedShape;shapes:readonly TracedShape[];onApply:(s:WallSpring)=>void;onCancel:()=>void}) {
  const {spec,cutouts,fingerHoles}=useBin(),[draft,setDraft]=useState(initial),[zoom,setZoom]=useState(false);
  const parsed=wallSpringSchema.safeParse(draft),stale=source!==current;
  let plan:ReturnType<typeof planWallSpring>|null=null,error:string|null=null;
  try {
    if(!parsed.success)throw new Error(parsed.error.issues[0].message);
    plan=planWallSpring(spec,current,shape,parsed.data);
    const next=applyLinkedEdits({cutouts,fingerHoles},{cutouts:cutouts.map(p=>p.id===current.id?{...p,springs:[...(p.springs??[]).filter(s=>s.id!==draft.id),parsed.data]}:p),fingerHoles});
    if(!next)throw new Error("Linked pockets cannot accept conflicting spring edits.");
    const issues=validateLayout(spec,next.cutouts,new Map(shapes.map(s=>[s.id,s])),next.fingerHoles);
    error=issues.filter(i=>i.severity==="error").map(i=>i.message).join("\n")||null;
  }catch(e){error=e instanceof Error?e.message:String(e);}
  const outline=transformOutlinePlacement(shape.outlineMm,current),bounds=outlineBounds(outline)!;
  const span=Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY),pad=span*.06;
  const box=zoom&&plan?`${plan.center.x-12} ${-plan.center.y-12} 24 24`:`${bounds.minX-pad} ${-bounds.maxY-pad} ${bounds.maxX-bounds.minX+2*pad} ${bounds.maxY-bounds.minY+2*pad}`;
  const path=(ring:{x:number;y:number}[])=>ring.map((p,i)=>`${i?"L":"M"}${p.x},${-p.y}`).join(" ")+" Z";
  const ring=springRing(shape,draft),length=ring?ringPerimeter(ring):0;
  return <><DialogHeader><DialogTitle>Place a backed wall spring</DialogTitle><DialogDescription>Click the pocket wall or enter its contour distance. The contact reaches past fit clearance; a released beam and backing stop allow it to yield.</DialogDescription></DialogHeader>
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]"><div className="min-w-0"><Button variant="outline" size="sm" disabled={!plan} onClick={()=>setZoom(v=>!v)}>{zoom?"Fit pocket":"Zoom to spring"}</Button>
      <svg role="img" aria-label="Spring wall placement" className="h-80 w-full touch-none rounded border bg-muted/20" viewBox={box} onPointerDown={event=>{
        const svg=event.currentTarget,matrix=svg.getScreenCTM();if(!matrix)return;
        const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const q=p.matrixTransform(matrix.inverse()),anchor=nearestSpringAnchor(shape,current,{x:q.x,y:-q.y});
        setDraft({...draft,shapeIndex:anchor.shapeIndex,ringIndex:anchor.ringIndex,atMm:anchor.atMm});
      }}>
        {outline.flatMap((s,i)=>[s.outer,...s.holes].map((r,j)=><path key={`${i}:${j}`} d={path(r)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>))}
        {fingerHoles.map(h=><circle key={h.id} cx={h.center.x} cy={-h.center.y} r={h.diameterMm/2+(h.topChamferMm??0)} fill="#dc2626" fillOpacity=".12" stroke="#dc2626" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
        {plan&&<><path d={path(plan.housing)} fill={error?"#d97706":"#16a34a"} fillOpacity=".3" stroke={error?"#d97706":"#15803d"} strokeWidth="1" vectorEffect="non-scaling-stroke"/><circle cx={plan.center.x} cy={-plan.center.y} r={.65} fill="#0369a1"/></>}
      </svg><p className="pt-2 text-xs text-muted-foreground">Green: spring housing and backing · Red: finger access exclusion · Blue: wall anchor</p></div>
      <div className="space-y-3 text-xs"><label className="grid gap-1">Contour<select aria-label="Spring contour" className="h-8 rounded border bg-background" value={`${draft.shapeIndex}:${draft.ringIndex}`} onChange={e=>{const [shapeIndex,ringIndex]=e.target.value.split(":").map(Number);setDraft({...draft,shapeIndex,ringIndex,atMm:0});}}>{shape.outlineMm.flatMap((s,i)=>[s.outer,...s.holes].map((_,j)=><option key={`${i}:${j}`} value={`${i}:${j-1}`}>Shape {i+1} · {j?`Hole ${j}`:"Outer wall"}</option>))}</select></label>
      {([['atMm','Contour distance',0,length,.5],['heightMm','Leaf height',10,30,.5],['rootFloorMm','Root above bin underside',spec.flatBottom?1.2:7,280,.5],['widthMm','Leaf width',4,10,.5],['travelMm','Backing gap',.3,.5,.05],['interferenceMm','Contact overlap',.02,.2,.02]] as const).map(([key,label,min,max,step])=><label key={key} className="grid gap-1">{label} (mm)<DraftNumberInput aria-label={label} value={draft[key]} min={min} max={max} step={step} displayPrecision={2} onValueChange={value=>setDraft({...draft,[key]:value})}/></label>)}
      <p className="text-muted-foreground">{BACKED_LEAF.beamMm} mm beam · {BACKED_LEAF.rootMm} mm tapered root · {BACKED_LEAF.contactRadiusMm} mm rounded contact</p>
      {plan&&<p role="status">Contact at Z {plan.contactZ.toFixed(2)} · {(plan.contactZ-plan.localFloorZ).toFixed(2)} mm above local floor</p>}
      {(error||stale)&&<p role="alert" className="whitespace-pre-line text-destructive">{stale?"Pocket changed. Reopen this spring preview.":error}</p>}</div></div>
    <DialogFooter><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={!parsed.success||!!error||stale} onClick={()=>{if(parsed.success)onApply(parsed.data);}}>Apply spring</Button></DialogFooter></>;
}
