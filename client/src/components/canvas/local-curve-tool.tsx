import {useMemo,useState,type KeyboardEvent} from "react";
import {refineCurveSpan,type LocalCurveInput,type LocalCurveResult} from "@shared/geometry/local-curve";
import {OUTER_RING,type Outline,type Point,type RingRef} from "@shared/geometry/types";
import {outlineBounds} from "@/lib/geometry/outline";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "@/components/ui/dialog";

interface Props {
  outline: Outline;
  initialRing?: RingRef;
  /** Physical millimetres per source unit; uncalibrated traces display pixels. */
  mmPerUnit?: number;
  yUp?: boolean;
  enlargeOnlyDefault?: boolean;
  validate?: (outline: Outline)=>string|null;
  onApply: (outline: Outline)=>void;
}
/** Preview owns no document mutations. Apply is one existing undoable contour edit. */
export function LocalCurveTool(props: Props) {
  const [session,setSession]=useState<Outline|null>(null);
  return <>
    <Button type="button" size="sm" variant="outline" onClick={()=>setSession(props.outline)}>Refine curve</Button>
    <Dialog open={session!==null} onOpenChange={open=>{if(!open)setSession(null);}}>
      {session&&<DialogContent className="max-w-5xl overflow-y-auto"><CurveEditor key={session===props.outline?"current":"stale"} {...props}
        source={session} stale={props.outline!==session} onCancel={()=>setSession(null)}
        onApply={outline=>{props.onApply(outline);setSession(null);}} /></DialogContent>}
    </Dialog>
  </>;
}
function CurveEditor({source,initialRing,mmPerUnit,yUp=false,enlargeOnlyDefault=false,validate,stale,onApply,onCancel}:Props&{
  source: Outline;stale:boolean;onCancel:()=>void;
}) {
  const [ref,setRef]=useState(initialRing??{shapeIndex:0,ringIndex:OUTER_RING});
  const [start,setStart]=useState<number|null>(null),[end,setEnd]=useState<number|null>(null);
  const [target,setTarget]=useState<"start"|"end">("start");
  const [method,setMethod]=useState<LocalCurveInput["method"]>("smooth"),[direction,setDirection]=useState<"forward"|"backward">("forward");
  const [strength,setStrength]=useState(1),[maximum,setMaximum]=useState(.25),[iterations,setIterations]=useState(12);
  const [tangents,setTangents]=useState(true),[outward,setOutward]=useState(enlargeOnlyDefault),[zoomSpan,setZoomSpan]=useState(false);
  const factor=mmPerUnit??1,units=mmPerUnit?"mm":"px";
  const shape=source[ref.shapeIndex],ring=ref.ringIndex===OUTER_RING?shape?.outer:shape?.holes[ref.ringIndex];
  const preview=useMemo(()=>{
    if(start===null||end===null)return {result:null,error:null};
    try {
      const result=refineCurveSpan(source,{...ref,startIndex:start,endIndex:end,method,direction,strength,iterations,maxDeviation:maximum/factor,preserveTangents:tangents,outwardOnly:outward});
      return {result,error:validate?.(result.outline)??null};
    }catch(error){return{result:null,error:error instanceof Error?error.message:"Unable to refine this span."};}
  },[source,ref,start,end,method,direction,strength,iterations,maximum,factor,tangents,outward,validate]);
  const view=(p:Point)=>({x:p.x,y:yUp?-p.y:p.y});
  const shown=zoomSpan&&preview.result?preview.result.indices.map(i=>view(ring[i])):ring?.map(view)??[];
  const bounds=outlineBounds([{outer:shown,holes:[]}]);
  const w=Math.max(.1,bounds?bounds.maxX-bounds.minX:1),h=Math.max(.1,bounds?bounds.maxY-bounds.minY:1),pad=Math.max(w,h)*.12;
  const box=`${(bounds?.minX??0)-pad} ${(bounds?.minY??0)-pad} ${w+2*pad} ${h+2*pad}`;
  const path=(outline:Outline)=>outline.flatMap(s=>[s.outer,...s.holes]).map(r=>r.map((p,i)=>{const q=view(p);return`${i?"L":"M"}${q.x},${q.y}`;}).join(" ")+" Z").join(" ");
  const choose=(i:number)=>{if(target==="start"){setStart(i);setTarget("end");}else setEnd(i);};
  const pick=(event:React.PointerEvent<SVGSVGElement>)=>{
    const matrix=event.currentTarget.getScreenCTM();if(!matrix||!ring?.length)return;
    const p=event.currentTarget.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const mapped=p.matrixTransform(matrix.inverse()),q={x:mapped.x,y:yUp?-mapped.y:mapped.y};
    let closest=0;ring.forEach((p,i)=>{if(Math.hypot(p.x-q.x,p.y-q.y)<Math.hypot(ring[closest].x-q.x,ring[closest].y-q.y))closest=i;});choose(closest);
  };
  const result:LocalCurveResult|null=preview.result;
  const inputClass="h-9 rounded-md border bg-background px-2 text-sm";
  return <>
    <DialogHeader><DialogTitle>Refine a local curve</DialogTitle><DialogDescription>Choose two contour points, then preview the span between them. The rest of the outline stays fixed.</DialogDescription></DialogHeader>
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 rounded-md border bg-muted/20">
        <div className="flex flex-wrap gap-2 border-b p-2">
          <Button size="sm" variant={target==="start"?"default":"outline"} onClick={()=>setTarget("start")}>Choose start</Button>
          <Button size="sm" variant={target==="end"?"default":"outline"} onClick={()=>setTarget("end")}>Choose end</Button>
          <Button size="sm" variant="outline" onClick={()=>setZoomSpan(v=>!v)} disabled={!result}>{zoomSpan?"Fit contour":"Zoom to span"}</Button>
        </div>
        <svg role="img" aria-label="Local curve preview" className="h-96 w-full touch-none" viewBox={box} onPointerDown={pick}>
          <path d={path(source)} fill="none" stroke="#c17d26" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
          {result&&<path d={path(result.outline)} fill="none" stroke="#0785a0" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
          {ring?.map((p,i)=>{const q=view(p),selected=i===start||i===end;return <circle key={i} cx={q.x} cy={q.y} r={Math.max(w,h)*(selected ? .013 : .006)}
            fill={i===start?"#15803d":i===end?"#be185d":"#64748b"} opacity={selected?1:.3} role="button" tabIndex={0} aria-label={`Contour point ${i}`}
            onPointerDown={event=>{event.stopPropagation();choose(i);}} onKeyDown={(event:KeyboardEvent)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();choose(i);}}}/>;})}
        </svg>
        <p className="p-2 text-xs text-muted-foreground">Orange: original · Blue: proposed · Green: start · Pink: end</p>
      </div>
      <div className="space-y-3 text-sm">
        <label className="grid gap-1">Contour<select aria-label="Curve contour" className={inputClass} value={`${ref.shapeIndex}:${ref.ringIndex}`} onChange={e=>{const [shapeIndex,ringIndex]=e.target.value.split(":").map(Number);setRef({shapeIndex,ringIndex});setStart(null);setEnd(null);setZoomSpan(false);}}>
          {source.flatMap((s,si)=>[OUTER_RING,...s.holes.map((_,i)=>i)].map(ri=><option key={`${si}:${ri}`} value={`${si}:${ri}`}>Shape {si+1} · {ri===OUTER_RING?"Outer":`Hole ${ri+1}`}</option>))}</select></label>
        <div className="grid grid-cols-2 gap-2">{(["start","end"] as const).map(which=><label key={which} className="grid gap-1">{which==="start"?"Start point":"End point"}<Input aria-label={which==="start"?"Start point":"End point"} type="number" min={0} max={(ring?.length??1)-1} value={(which==="start"?start:end)??""} onChange={e=>(which==="start"?setStart:setEnd)(e.target.value===""?null:Number(e.target.value))}/></label>)}</div>
        <label className="grid gap-1">Path<select aria-label="Curve path" className={inputClass} value={direction} onChange={e=>setDirection(e.target.value as typeof direction)}><option value="forward">Forward around contour</option><option value="backward">Backward around contour</option></select></label>
        <label className="grid gap-1">Method<select aria-label="Curve method" className={inputClass} value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="smooth">Smooth existing curve</option><option value="arc">Fit circular arc</option><option value="ellipse">Fit ellipse arc</option></select></label>
        <label className="grid gap-1">Maximum movement ({units})<Input aria-label="Maximum curve movement" type="number" min={.001} step={.05} value={maximum} onChange={e=>setMaximum(Number(e.target.value))}/></label>
        <label className="grid gap-1">Strength<Input aria-label="Curve strength" type="number" min={0} max={1} step={.1} value={strength} onChange={e=>setStrength(Number(e.target.value))}/></label>
        {method==="smooth"&&<label className="grid gap-1">Smoothing passes<Input aria-label="Smoothing passes" type="number" min={1} max={100} value={iterations} onChange={e=>setIterations(Number(e.target.value))}/></label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={tangents} onChange={e=>setTangents(e.target.checked)}/>Keep endpoint directions</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={outward} onChange={e=>setOutward(e.target.checked)}/>Only enlarge pocket</label>
        {result&&<p role="status" className="text-xs">Largest move: {(result.maximumMove*factor).toFixed(3)} {units}{result.limited?" · Movement limited":""}{result.fit?.radius?` · Fitted radius: ${(result.fit.radius*factor).toFixed(2)} ${units}`:result.fit?.axisA?` · Ellipse radii: ${(result.fit.axisA*factor).toFixed(2)} / ${(result.fit.axisB!*factor).toFixed(2)} ${units}`:""}</p>}
        {(preview.error||stale)&&<p role="alert" className="text-sm text-destructive">{stale?"The source contour changed. Close and reopen this preview.":preview.error}</p>}
      </div>
    </div>
    <DialogFooter><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={stale||!result||!!preview.error||(result?.maximumMove??0)<1e-9} onClick={()=>{if(result)onApply(result.outline);}}>Apply curve refinement</Button></DialogFooter>
  </>;
}
