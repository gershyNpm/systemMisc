import '@gershy/clearing';
import { GifEncoder } from '@skyra/gifenc';
import { createCanvas } from 'canvas';
import { Draw } from './draw.ts';
import type { Fact } from '@gershy/disk';

export type GifInp = {
  fact: Fact,
  quality?: 0 | number | 1,
  w: number,
  h: number,
  fpsc: number,
  frame: [
    { ms: null,   fn: (inp: { draw: Draw, ms: number, sc: number              }) => { finish: boolean } },
    { ms: number, fn: (inp: { draw: Draw, ms: number, sc: number, amt: number }) => void                }
  ][number]
};
export default async (inp: GifInp) => {
  
  const { fact, quality = 1, w, h, fpsc, frame } = inp;
  
  const headStreamPrm = fact.getDataHeadStream();
  
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const draw = new Draw({ canvas, ctx: ctx as any });
  
  const msPerFrame = 1000 / fpsc;
  const encoder = new GifEncoder(inp.w, inp.h);
  encoder
    .setRepeat(0)                              // 0 = continuous loop, -1 = play once, otherwise N = N repetitions
    .setDelay(msPerFrame)                      // Millis between frames
    .setQuality(30 - Math.round(quality * 29)) // 1 is best, 30 is worst
    .start();
  
  const headStream = await headStreamPrm;
  encoder.createReadStream().pipe(headStream);
  // encoder.createReadStream().pipe(createWriteStream(inp.fact.fsp()));
  
  if (frame.ms !== null) {
    
    const frames = Math.floor(frame.ms / msPerFrame);
    
    for (let frm = 0; frm < frames; frm++) {
      
      const ms = frm * msPerFrame;
      draw.fresh({}, () => frame.fn({ draw, ms, sc: ms * 0.001, amt: frm / (frames - 1) }));
      encoder.addFrame(ctx);
      
    }
    
  } else {
    
    for (let frm = 0; true; frm++) {
      
      const ms = frm * msPerFrame;
      const { finish } = draw.fresh({}, () => frame.fn({ draw, ms, sc: ms * 0.001 }));
      encoder.addFrame(ctx);
      if (finish) break;
      
    }
    
  }
  
  encoder.finish();
  await headStream.prm;
  
};