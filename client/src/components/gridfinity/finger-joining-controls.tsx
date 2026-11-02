import type {FingerHole} from "@shared/gridfinity/cutout";
import {DraftNumberInput} from "@/components/ui/draft-number-input";
import {useBin} from "@/state/bin-store";
export function FingerJoiningControls({hole}:{hole:FingerHole}) {
  const {dispatch}=useBin();
  return <div className="space-y-2 border-t pt-2 text-xs" aria-label="Finger access joining relief">
    <label className="flex items-center gap-2">Joining chamfer (mm)<DraftNumberInput className="h-8" aria-label="Joining chamfer" value={hole.joiningChamferMm??0} min={0} max={5} step={.1} displayPrecision={2} onValueChange={joiningChamferMm=>dispatch({type:'UPDATE_FINGER_HOLE',id:hole.id,patch:{joiningChamferMm,...(joiningChamferMm===0?{joiningBlendMm:0}:{})},historyLabel:'Bevel finger joining corners'})}/></label>
    <label className="flex items-center gap-2">Blend into walls (mm)<DraftNumberInput className="h-8" aria-label="Joining chamfer blend" value={hole.joiningBlendMm??0} min={0} max={3} step={.1} displayPrecision={2} disabled={!(hole.joiningChamferMm??0)} onValueChange={joiningBlendMm=>dispatch({type:'UPDATE_FINGER_HOLE',id:hole.id,patch:{joiningBlendMm},historyLabel:'Blend finger joining chamfer'})}/></label>
    <p className="text-muted-foreground">Bevel vertical joining corners down to the floor. A blend eases both ends into the neighboring wall curves; zero keeps a straight chamfer. Requires flat-bottom access beside a blind pocket.</p>
  </div>;
}
