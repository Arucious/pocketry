import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { ExperimentalFeaturesProvider } from "@/state/experimental-features";
import { BinProvider, useBin, type BinStore } from "@/state/bin-store";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PocketDepthProfileControls } from "./pocket-depth-profile-controls";

const shape: TracedShape = { id: "s", name: "Tool", sourceMmPerPx: 1, pointCount: 4,
  bboxMm: { minX: -30, minY: -10, maxX: 30, maxY: 10 },
  outlineMm: [{ outer: [{ x: -30, y: -10 }, { x: 30, y: -10 }, { x: 30, y: 10 }, { x: -30, y: 10 }], holes: [] }] };
let store: BinStore, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function Probe() { store = useBin(); return store.cutouts[0] ? <PocketDepthProfileControls cutout={store.cutouts[0]} shape={shape} /> : null; }
const click = (name: string) => React.act(() => [...host.querySelectorAll("button")].find(b => b.textContent === name)!.click());
function enter(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  React.act(() => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  React.act(() => input.blur());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  React.act(() => root.render(<ExperimentalFeaturesProvider><ShapeLibraryProvider><BinProvider><Probe /></BinProvider></ShapeLibraryProvider></ExperimentalFeaturesProvider>));
  React.act(() => store.dispatch({ type: "HYDRATE", spec: parseBinSpec({ gridX: 3, gridY: 3, heightUnits: 5 }),
    cutouts: [parseCutoutPlacement({ id: "p", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 12 } })] }));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("depth station editing", () => {
  it("creates a uniform profile, edits several seats and supports undo/redo and removal", () => {
    click("Add depth stations");
    expect(store.cutouts[0].depthProfile!.axis).toBe("x");
    expect(store.cutouts[0].bottomFilletMm).toBe(0);
    click("Add station");
    expect(store.cutouts[0].depthProfile!.stations.map(s => s.atMm)).toEqual([0, 30, 60]);
    enter("Station 2 position in millimetres", "40");
    enter("Station 2 depth in millimetres", "7");
    expect(store.cutouts[0].depthProfile!.stations[1]).toMatchObject({ atMm: 40, depthMm: 7 });
    const edited = store.cutouts[0].depthProfile;
    React.act(() => store.dispatch({ type: "UNDO" }));
    expect(store.cutouts[0].depthProfile!.stations[1].depthMm).toBe(12);
    React.act(() => store.dispatch({ type: "REDO" }));
    expect(store.cutouts[0].depthProfile).toEqual(edited);
    expect(host.querySelector('[aria-label="Pocket depth side profile"]')).not.toBeNull();
    click("Use one depth"); expect(store.cutouts[0].depthProfile).toBeUndefined();
    React.act(() => store.dispatch({ type: "UNDO" })); expect(store.cutouts[0].depthProfile).toEqual(edited);
  });
  it("rejects crossed stations without changing the saved geometry", () => {
    click("Add depth stations"); click("Add station");
    const before = store.cutouts[0].depthProfile;
    enter("Station 2 position in millimetres", "60");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("strictly increasing");
    expect(store.cutouts[0].depthProfile).toEqual(before);
  });
});
