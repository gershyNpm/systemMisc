import { Pt } from "./pt.ts";

type Canvas = {
  width: number,
  height: number,
  getContext: (mode: '2d') => any
};
type CanvasCtx = {
  
  save: () => void,
  restore: () => void,
  
  beginPath: () => void,
  clearRect: (x: number, y: number, w: number, h: number) => void,
  rect: (x: number, y: number, w: number, h: number) => void,
  arc: (x: number, y: number, r: number, ang0: number, ang1: number) => void,
  moveTo: (x: number, y: number) => void,
  lineTo: (x: number, y: number) => void,
  closePath: () => void,
  clip: () => void,
  translate: (x: number, y: number) => void,
  scale: (w: number, h: number) => void,
  rotate: (rot: number) => void,
  
  lineWidth: number,
  fillStyle: string,   fill:   () => void,
  strokeStyle: string, stroke: () => void,
  
};
export class Draw {
  
  protected canvas: Canvas;
  protected ctx: CanvasCtx;
  constructor(inp: { canvas: Canvas, ctx?: CanvasCtx }) {
    this.canvas = inp.canvas;
    this.ctx = inp.ctx ?? inp.canvas.getContext('2d');
  }
  
  public size() { return { w: this.canvas.width, h: this.canvas.height }; }
  public mid()  { const { w, h } = this.size(); return new Pt({ x: w * 0.5, y: h * 0.5 }); }
  
  public fresh<R>(fn: () => R) {
    
    const { w, h } = this.size();
    this.ctx.clearRect(0, 0, w, h);
    return fn();
    
  }

  public rect(inp: { x: number, y: number, w: number, h: number, line?: `#${string}`, fill?: `#${string}` } & ({ line: string } | { fill: string })) {                                     
    
    this.commit(inp, () => this.ctx.rect(inp.x, inp.y, inp.w, inp.h));
    
  }

  public cone(inp: { x: number, y: number, dir: number, ang: number, r: number, fill?: `#${string}`, line?: `#${string}`, lineW?: number }) {
    
    this.commit(inp, () => {
      
      const { ctx } = this;
      const { x, y, dir, ang, r } = inp;
      
      const ang0 = (dir - ang * 0.5) * Math.PI * 2;
      const ang1 = (dir + ang * 0.5) * Math.PI * 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang0) * r, y + Math.sin(ang0) * r);
      ctx.arc(x, y, r, ang0, ang1);
      ctx.closePath();
      
    });
    
  }
  
  public frame(fn: (shift: { trn: (inp: { x: number, y: number }) => void, scl: (amt: number) => void, rot: (ang: number) => void }) => void) {
    
    this.ctx.save();
    
    fn({
      trn: (inp: { x: number, y: number }) => this.ctx.translate(inp.x, inp.y),
      scl: (inp: number) => this.ctx.scale(inp, inp),
      rot: (inp: number) => this.ctx.rotate(inp * 2 * Math.PI),
    });
    
    this.ctx.restore();
    
  }
  
  public clip(fn: () => void) {
    const { ctx } = this;
    ctx.beginPath();
    fn();
    ctx.clip();
  }
  
  protected set(inp: { lineW?: number, fill?: `#${string}`, line?: `#${string}` } = {}) {
    Object.assign(this.ctx, {
      lineWidth: inp.lineW ?? 1,
      fillStyle: inp.fill ?? '#0000',
      strokeStyle: inp.line ?? '#0000'
    });
  }
  
  protected commit(inp: { lineW?: number, line?: `#${string}`, fill?: `#${string}` }, fn: () => void) {
    
    const { ctx } = this;
    
    const { lineW = 1, line, fill } = inp;
    if (line || fill) ctx.beginPath();
    
    fn();
    
    if (fill) { ctx.  fillStyle = fill;                        ctx.fill();   }
    if (line) { ctx.strokeStyle = line; ctx.lineWidth = lineW; ctx.stroke(); }
    
  }
  
  public circle(inp: { x: number, y: number, r: number, line?: `#${string}`, fill?: `#${string}` }) {
    
    this.commit(inp, () => {
      
      const { ctx } = this;
      const { x, y, r } = inp;
      ctx.moveTo(x + r, y);
      if (r >= 0) ctx.arc(x, y, +r, 0, +Math.PI * 2);
      else        ctx.arc(x, y, -r, 0, -Math.PI * 2);
      
    });
    
  }
  
  public line(inp: { pt0: { x: number, y: number }, pt1: { x: number, y: number }, lineW?: number, line?: `#${string}` }) {
    
    this.commit(inp, () => {
      this.ctx.moveTo(inp.pt0.x, inp.pt0.y);
      this.ctx.lineTo(inp.pt1.x, inp.pt1.y);
    });
    
  }
  
};