import { createCanvas } from 'canvas';
import { Draw } from './draw.ts';
import type { Fact } from '@gershy/disk';

export type PngInp = {
  fact: Fact,
  w: number,
  h: number,
  frame: (draw: Draw) => void
};
export default async (inp: PngInp) => {
  
  const { fact, w, h, frame } = inp;
  
  const headStreamPrm = fact.getDataHeadStream();
  
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const draw = new Draw({ canvas, ctx: ctx as any });
  
  frame(draw);
  
  const headStream = await headStreamPrm;
  canvas.createPNGStream().pipe(headStream);
  await headStream.prm;
  
};