import {wallSpringSchema} from "../spring-schema";
import {parseBinSpec} from "../types";
import {parseCutoutPlacement,type TracedShape} from "../cutout";
export const springShape:TracedShape={id:"tool",name:"Tool",sourceMmPerPx:1,pointCount:4,bboxMm:{minX:-40,maxX:40,minY:-15,maxY:15},
  outlineMm:[{outer:[{x:-40,y:-15},{x:40,y:-15},{x:40,y:15},{x:-40,y:15}],holes:[]}]};
export const springSpec=parseBinSpec({gridX:4,gridY:3,heightUnits:3,fill:"solid"});
export const springPocket=parseCutoutPlacement({id:"p",shapeId:"tool",position:{x:0,y:0},clearanceMm:.6,cornerRoundMm:0,topFilletMm:0,bottomFilletMm:0,depth:{mode:"remaining",floorThicknessMm:7}});
export const leaf=wallSpringSchema.parse({id:"leaf",atMm:40});
