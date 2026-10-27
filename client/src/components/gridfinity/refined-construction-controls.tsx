import { DEFAULT_REFINED_MAGNETS, refinedConstructionPreset } from "@shared/gridfinity/construction";
import type { BinSpec, BinSpecInput } from "@shared/gridfinity/types";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function RefinedConstructionControls({ spec, onChange }: {
  spec: BinSpec; onChange: (patch: Partial<BinSpecInput>, transient?: boolean, historyLabel?: string) => void;
}): JSX.Element {
  const settings = spec.refinedMagnet ?? DEFAULT_REFINED_MAGNETS;
  const patchSettings = (patch: Partial<typeof settings>, transient = false) =>
    onChange({ refinedMagnet: { ...settings, ...patch } }, transient, "Edit refined magnets");
  return <div className="space-y-3 rounded-md border p-2" aria-label="Base and rim presets">
    <Button variant="outline" size="sm" className="h-auto w-full whitespace-normal text-xs"
      disabled={spec.gridPitch !== "full"} onClick={() => onChange(refinedConstructionPreset(), false, "Apply refined base and rim preset")}>
      Refined magnets + notched lip
    </Button>
    {spec.gridPitch !== "full" && <p className="text-[11px] text-muted-foreground">This preset requires the full 42 mm grid.</p>}
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs" htmlFor="bin-lip-notches">Top notches</Label>
      <Switch id="bin-lip-notches" aria-label="Top notches" checked={spec.lipNotches ?? false}
        disabled={spec.lip !== "standard" || spec.gridPitch !== "full"}
        onCheckedChange={lipNotches => onChange({ lipNotches }, false, "Change stacking lip notches")} />
    </div>
    {!spec.flatBottom && spec.magnetHoles && <>
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">Magnet style</Label>
        <Select value={spec.magnetStyle ?? "standard"} onValueChange={value => onChange({
          magnetStyle: value as "standard" | "refined", ...(value === "refined" ? { screwHoles: false, magnetCrushRibs: false } : {}),
        }, false, "Change magnet style")}>
          <SelectTrigger aria-label="Magnet style" className="h-8 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="standard">Standard bottom entry</SelectItem><SelectItem value="refined">Refined side entry</SelectItem></SelectContent>
        </Select>
      </div>
      {spec.magnetStyle === "refined" && <div className="space-y-2" aria-label="Refined magnet settings">
        {([
          ["diameterMm", "Magnet diameter", 4, 8, .05],
          ["thicknessMm", "Magnet thickness", 1, 3.5, .05],
          ["captiveHeightMm", "Retaining skin", .2, 1.2, .05],
          ["crushDepthMm", "Refined crush depth", 0, .3, .01],
        ] as const).map(([key, label, min, max, step]) => <div className="flex items-center justify-between gap-2" key={key}>
          <Label className="text-xs">{label}</Label>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><DraftNumberInput className="h-8 w-16"
            aria-label={`${label} in millimetres`} value={settings[key]} min={min} max={max} step={step} displayPrecision={2}
            onValueChange={value => patchSettings({ [key]: value }, true)} onValueCommit={value => patchSettings({ [key]: value })} />mm</span>
        </div>)}
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs">Side entry</Label>
          <Select value={settings.sideAccess} onValueChange={sideAccess => patchSettings({ sideAccess: sideAccess as "left" | "right" })}>
            <SelectTrigger aria-label="Magnet side entry" className="h-8 flex-1"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="right">Right</SelectItem><SelectItem value="left">Left</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2"><Label className="text-xs">Corner magnets only</Label>
          <Switch aria-label="Corner magnets only" checked={settings.cornerOnly} onCheckedChange={cornerOnly => patchSettings({ cornerOnly })} /></div>
        <div className="flex items-center justify-between gap-2"><Label className="text-xs">Magnet removal relief</Label>
          <Switch aria-label="Magnet removal relief" checked={settings.easyRelease === "auto"}
            onCheckedChange={enabled => patchSettings({ easyRelease: enabled ? "auto" : "off" })} /></div>
        <p className="text-[11px] text-muted-foreground">6 × 2 mm magnet preset: 0.1 mm height allowance is added. Sideways retention relies on fit. Physical calibration is still needed.</p>
      </div>}
    </>}
  </div>;
}
