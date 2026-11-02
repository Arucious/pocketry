// @vitest-environment jsdom
import * as React from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {Outline} from "@shared/geometry/types";
import {LocalCurveTool} from "./local-curve-tool";

let host:HTMLDivElement,root:Root;
const apply=vi.fn();
const source:Outline=[{outer:Array.from({length:60},(_,i)=>{const t=i*2*Math.PI/60,r=i%4===0?10.2:10;return{x:r*Math.cos(t),y:r*Math.sin(t)};}),holes:[]}];
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent===name)!;
const click=(name:string)=>React.act(()=>button(name).click());
const point=(index:number)=>React.act(()=>document.querySelector(`[aria-label="Contour point ${index}"]`)!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener(){},removeEventListener(){}}));
  host=document.createElement("div");document.body.append(host);root=createRoot(host);apply.mockReset();
  React.act(()=>root.render(<LocalCurveTool outline={source} mmPerUnit={1} onApply={apply}/>));
});
afterEach(()=>{React.act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe("local curve preview",()=>{
  it("previews a keyboard-selected span and cancels without a document edit",()=>{
    const original=JSON.stringify(source);click("Refine curve");point(5);point(30);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Largest move:");
    expect(button("Apply curve refinement").disabled).toBe(false);
    expect(apply).not.toHaveBeenCalled();click("Cancel");
    expect(apply).not.toHaveBeenCalled();expect(JSON.stringify(source)).toBe(original);
  });
  it("applies exactly one bounded contour edit with the outside span unchanged",()=>{
    click("Refine curve");point(5);point(30);click("Apply curve refinement");
    expect(apply).toHaveBeenCalledTimes(1);
    const changed=apply.mock.calls[0][0] as Outline;
    source[0].outer.forEach((p,i)=>{if(i<=6||i>=29)expect(changed[0].outer[i]).toEqual(p);});
    expect(changed).not.toEqual(source);expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("blocks a too-short span and a layout error instead of applying an invalid preview",()=>{
    click("Refine curve");point(5);point(7);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("five points");
    expect(button("Apply curve refinement").disabled).toBe(true);click("Cancel");
    React.act(()=>root.render(<LocalCurveTool outline={source} onApply={apply} validate={()=>"Pocket would cross the wall"}/>));
    click("Refine curve");point(5);point(30);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("cross the wall");
    expect(button("Apply curve refinement").disabled).toBe(true);
  });
  it("rejects a stale preview after undo or another source edit",()=>{
    click("Refine curve");point(5);point(30);
    React.act(()=>root.render(<LocalCurveTool outline={[...source]} onApply={apply}/>));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("source contour changed");
    expect(button("Apply curve refinement").disabled).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
});
