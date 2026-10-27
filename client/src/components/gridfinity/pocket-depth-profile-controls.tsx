import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { depthProfileSchema, depthProfileError, depthProfileSegments, maximumProfileDepth,
  profileAxisBounds, profileDepthAt, type DepthProfile } from "@shared/gridfinity/depth-profile";
import { resolvePlacedPocketDepth, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBin } from "@/state/bin-store";

/** Stations belong to a pocket, so ordinary edit history, linking, save and
 * export use the same data. Distances follow the source shape when resized. */
export function PocketDepthProfileControls({ cutout, shape }: { cutout: CutoutPlacement; shape: TracedShape }): JSX.Element {
  const { dispatch, spec } = useBin();
  const [error, setError] = useState<string | null>(null);
  const profile = cutout.depthProfile;
  const commit = (next: DepthProfile) => {
    const parsed = depthProfileSchema.safeParse(next);
    const message = parsed.success ? depthProfileError(parsed.data, shape.outlineMm) : parsed.error.issues[0].message;
    if (message) { setError(message); return; }
    setError(null);
    dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { depthProfile: parsed.success ? parsed.data : next,
      depth: { mode: "mm", value: maximumProfileDepth(next) }, bottomFilletMm: 0,
      split: undefined, fillHeightReference: undefined }, historyLabel: "Edit depth stations" });
  };
  const create = () => {
    const x = profileAxisBounds(shape.outlineMm, "x"), y = profileAxisBounds(shape.outlineMm, "y");
    const axis = x.length >= y.length ? "x" : "y";
    const resolved = resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout);
    const depthMm = Math.min(280, Math.max(.1, resolved.axialDepthMm ?? resolved.depthMm ?? 5));
    commit({ axis, stations: [{ atMm: 0, depthMm, transition: "step" },
      { atMm: (axis === "x" ? x : y).length, depthMm, transition: "step" }] });
  };
  const length = profile ? profileAxisBounds(shape.outlineMm, profile.axis).length : 0;
  const graph = profile ? depthProfileSegments(profile, length) : [];
  const maxDepth = profile ? maximumProfileDepth(profile) : 1;
  const graphPath = graph.flatMap(s => [[s.fromMm, s.fromDepthMm], [s.toMm, s.toDepthMm]])
    .map(([x, y], i) => `${i ? "L" : "M"} ${10 + x / Math.max(.001, length) * 280} ${12 + y / maxDepth * 65}`).join(" ");
  return <details className="group/depth-profile border-t pt-1 text-xs" open={!!profile || undefined}>
    <summary className="flex cursor-pointer items-center justify-between gap-2 py-2 font-medium">
      Depth stations <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/depth-profile:rotate-180" />
    </summary>
    <div className="space-y-3 pb-3" aria-label="Depth stations editor">
      {!profile ? <>
        <p className="text-muted-foreground">Add several floor depths with sharp steps, straight ramps or smooth blends.</p>
        <Button type="button" size="sm" variant="outline" disabled={!!cutout.split}
          onClick={create}>Add depth stations</Button>
        {cutout.split && <p>Remove the two-section split before adding depth stations.</p>}
      </> : <>
        <label className="flex items-center gap-2">Direction
          <Select value={profile.axis} onValueChange={axis => {
            const newLength = profileAxisBounds(shape.outlineMm, axis as "x" | "y").length;
            commit({ ...profile, axis: axis as "x" | "y", stations: profile.stations.map(s => ({ ...s, atMm: s.atMm * newLength / length })) });
          }}>
            <SelectTrigger className="h-8 flex-1" aria-label="Depth station direction"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="x">Left to right (X)</SelectItem><SelectItem value="y">Bottom to top (Y)</SelectItem></SelectContent>
          </Select>
        </label>
        <p className="text-muted-foreground">Positions in mm from the outline’s {profile.axis === "x" ? "left" : "bottom"} edge, before resizing. Depths are measured down from the pocket top. Each transition leads to the next station.</p>
        <svg viewBox="0 0 300 92" className="w-full rounded border bg-muted/20" role="img" aria-label="Pocket depth side profile">
          <path d="M 10 12 H 290" stroke="currentColor" opacity=".3" fill="none" />
          <path d={graphPath} stroke="currentColor" strokeWidth="1.5" fill="none" />
          <text x="10" y="89" fontSize="9" fill="currentColor">0 mm</text><text x="290" y="89" textAnchor="end" fontSize="9" fill="currentColor">{length.toFixed(1)} mm</text>
        </svg>
        <div className="grid grid-cols-[1fr_1fr_1.3fr_1.8rem] gap-1 text-muted-foreground" aria-hidden="true">
          <span>Position</span><span>Depth</span><span>To next</span><span />
        </div>
        {profile.stations.map((station, i) => <div className="grid grid-cols-[1fr_1fr_1.3fr_1.8rem] items-center gap-1" key={i}>
          <DraftNumberInput className="h-8 min-w-0 px-1" aria-label={`Station ${i + 1} position in millimetres`}
            value={station.atMm} min={0} max={length} step={1} displayPrecision={2} disabled={i === 0}
            onValueChange={atMm => commit({ ...profile, stations: profile.stations.map((s, j) => j === i ? { ...s, atMm } : s) })} />
          <DraftNumberInput className="h-8 min-w-0 px-1" aria-label={`Station ${i + 1} depth in millimetres`}
            value={station.depthMm} min={.1} max={280} step={.5} displayPrecision={2}
            onValueChange={depthMm => commit({ ...profile, stations: profile.stations.map((s, j) => j === i ? { ...s, depthMm } : s) })} />
          {i < profile.stations.length - 1 ? <Select value={station.transition} onValueChange={transition => commit({ ...profile,
            stations: profile.stations.map((s, j) => j === i ? { ...s, transition: transition as typeof s.transition } : s) })}>
            <SelectTrigger className="h-8 min-w-0 px-1" aria-label={`Station ${i + 1} transition`}><SelectValue>{station.transition === "step" ? "Step" : station.transition === "linear" ? "Ramp" : "Smooth"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="step">Sharp step</SelectItem><SelectItem value="linear">Straight ramp</SelectItem><SelectItem value="smooth">Smooth blend</SelectItem></SelectContent>
          </Select> : <span className="text-muted-foreground">To end</span>}
          <Button type="button" size="sm" variant="ghost" className="h-8 px-1" disabled={i === 0 || profile.stations.length <= 2}
            aria-label={`Remove station ${i + 1}`} onClick={() => commit({ ...profile, stations: profile.stations.filter((_, j) => j !== i) })}>×</Button>
        </div>)}
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="outline" disabled={profile.stations.length >= 64} onClick={() => {
            const gaps = profile.stations.slice(1).map((s, i) => ({ size: s.atMm - profile.stations[i].atMm, index: i }));
            const gap = gaps.reduce((best, next) => next.size > best.size ? next : best);
            const atMm = (profile.stations[gap.index].atMm + profile.stations[gap.index + 1].atMm) / 2;
            const stations = [...profile.stations]; stations.splice(gap.index + 1, 0,
              { atMm, depthMm: profileDepthAt(profile, atMm), transition: profile.stations[gap.index].transition });
            commit({ ...profile, stations });
          }}>Add station</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => {
            setError(null); dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { depthProfile: undefined }, historyLabel: "Remove depth stations" });
          }}>Use one depth</Button>
        </div>
        <p className="text-muted-foreground">Keep equal depths to hold a flat section. To begin a ramp at 60 mm and finish at 80 mm, place stations at both positions. Bottom-edge fillets are replaced by these floor transitions.</p>
      </>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  </details>;
}
