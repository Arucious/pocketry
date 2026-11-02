import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {BinProvider,useBin,type BinStore} from '@/state/bin-store';
import {ExperimentalFeaturesProvider} from '@/state/experimental-features';
import {ShapeLibraryProvider} from '@/state/shape-library';
import {fingerHoleSchema} from '@shared/gridfinity/cutout';
import {springSpec} from '@shared/gridfinity/fixtures/wall-springs';
import {FingerJoiningControls} from './finger-joining-controls';
let store:BinStore,host:HTMLDivElement,root:ReturnType<typeof createRoot>;
function Probe(){store=useBin();return store.fingerHoles[0]?<FingerJoiningControls hole={store.fingerHoles[0]}/>:null;}
function enter(label:string,value:string){const input=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;React.act(()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});React.act(()=>input.blur());}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);sessionStorage.clear();localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);React.act(()=>root.render(<ExperimentalFeaturesProvider><ShapeLibraryProvider><BinProvider><Probe/></BinProvider></ShapeLibraryProvider></ExperimentalFeaturesProvider>));React.act(()=>store.dispatch({type:'HYDRATE',spec:springSpec,cutouts:[],fingerHoles:[fingerHoleSchema.parse({id:'h',center:{x:0,y:0}})]}));});
afterEach(()=>{React.act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('edits blend runouts with undo and clears them when removing the joining chamfer',()=>{
  expect(host.querySelector<HTMLInputElement>('[aria-label="Joining chamfer blend"]')!.disabled).toBe(true);
  enter('Joining chamfer','1.2');enter('Joining chamfer blend','0.5');expect(store.fingerHoles[0]).toMatchObject({joiningChamferMm:1.2,joiningBlendMm:.5});
  React.act(()=>store.dispatch({type:'UNDO'}));expect(store.fingerHoles[0].joiningBlendMm).toBeUndefined();
  React.act(()=>store.dispatch({type:'REDO'}));enter('Joining chamfer','0');expect(store.fingerHoles[0]).toMatchObject({joiningChamferMm:0,joiningBlendMm:0});
});
