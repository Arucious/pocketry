import * as React from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {BinProvider,useBin,type BinStore} from "@/state/bin-store";
import {ExperimentalFeaturesProvider} from "@/state/experimental-features";
import {ShapeLibraryProvider} from "@/state/shape-library";
import {springShape,springSpec,springPocket} from "@shared/gridfinity/fixtures/wall-springs";
import {fingerHoleSchema} from "@shared/gridfinity/cutout";
import {PocketSpringControls} from "./pocket-spring-controls";
let store:BinStore,host:HTMLDivElement,root:ReturnType<typeof createRoot>;
function Probe(){store=useBin();return store.cutouts[0]?<PocketSpringControls cutout={store.cutouts[0]} shape={springShape} shapes={[springShape]}/>:null;}
function button(text:string){return [...document.querySelectorAll('button')].find(b=>b.textContent===text)!;}
function click(text:string){React.act(()=>button(text).click());}
function enter(label:string,value:string){const input=document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;React.act(()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});React.act(()=>input.blur());}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);sessionStorage.clear();localStorage.clear();
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  React.act(()=>root.render(<ExperimentalFeaturesProvider><ShapeLibraryProvider><BinProvider><Probe/></BinProvider></ShapeLibraryProvider></ExperimentalFeaturesProvider>));
  React.act(()=>store.dispatch({type:'HYDRATE',spec:springSpec,cutouts:[springPocket],fingerHoles:[]}));
});
afterEach(()=>{React.act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
describe('spring placement preview',()=>{
  it('cancels without edits and applies one undoable spring, including editing and removal',()=>{
    click('Add wall spring');enter('Contour distance','40');expect(document.querySelector('[role="alert"]')).toBeNull();
    click('Cancel');expect(store.cutouts[0].springs).toBeUndefined();
    click('Add wall spring');enter('Contour distance','40');click('Apply spring');
    const leaf=store.cutouts[0].springs![0];expect(leaf.atMm).toBe(40);
    React.act(()=>store.dispatch({type:'UNDO'}));expect(store.cutouts[0].springs).toBeUndefined();
    React.act(()=>store.dispatch({type:'REDO'}));click('Edit spring');enter('Contour distance','50');click('Apply spring');
    expect(store.cutouts[0].springs![0]).toMatchObject({id:leaf.id,atMm:50});
    React.act(()=>document.querySelector<HTMLButtonElement>(`[aria-label="Remove spring ${leaf.id}"]`)!.click());expect(store.cutouts[0].springs).toEqual([]);
  });
  it('blocks a spring whose housing intersects finger access',()=>{
    React.act(()=>store.dispatch({type:'HYDRATE',spec:springSpec,cutouts:[springPocket],fingerHoles:[fingerHoleSchema.parse({id:'grip',center:{x:0,y:-15},diameterMm:12,depthMm:8})]}));
    click('Add wall spring');enter('Contour distance','40');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('finger access');expect(button('Apply spring').disabled).toBe(true);
    expect(store.cutouts[0].springs).toBeUndefined();
  });
});
