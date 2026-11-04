import { Pt } from './pt.ts';

export type Colour = `#${string}` | `rgb${string}`;
export type Look = { line?: Colour, fill?: Colour, lineW?: number };
export type Canvas = {
  width: number,
  height: number,
  getContext: (mode: '2d') => any
};
export type Transformer = {
  trn: (pos: { x: number, y: number }) => void,
  scl: (a: number)                     => void,
  tur: (t: number)                     => void
};

export type CanvasCtx = {
  
  save: () => void,
  restore: () => void,
  
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void,
  translate: (x: number, y: number) => void,
  scale: (w: number, h: number) => void,
  rotate: (rot: number) => void,
  
  beginPath: () => void,
  clearRect: (x: number, y: number, w: number, h: number) => void,
  rect: (x: number, y: number, w: number, h: number) => void,
  arc: (x: number, y: number, r: number, ang0: number, ang1: number) => void,
  moveTo: (x: number, y: number) => void,
  lineTo: (x: number, y: number) => void,
  closePath: () => void,
  clip: () => void,
  fillText: (text: string, x: number, y: number) => void,
  fillRect: (x: number, y: number, w: number, h: number) => void,
  
  font: string,
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end',
  textBaseline: string,
  lineWidth: number,
  fillStyle: string,   fill:   () => void,
  strokeStyle: string, stroke: () => void,
  
};
export class Draw {
  
  protected canvas: Canvas;
  protected ctx: CanvasCtx;
  protected tfm: Transformer;
  constructor(inp: { canvas: Canvas, ctx?: CanvasCtx }) {
    this.canvas = inp.canvas;
    this.ctx = inp.ctx ?? inp.canvas.getContext('2d');
    this.tfm = {
      trn: (inp: { x: number, y: number }) => this.ctx.translate(inp.x, inp.y),
      scl: (inp: number) => this.ctx.scale(inp, inp),
      tur: (inp: number) => this.ctx.rotate(inp * 2 * Math.PI),
    };
  }
  
  public size() { return { w: this.canvas.width, h: this.canvas.height }; }
  public mid()  { const { w, h } = this.size(); return new Pt({ x: w * 0.5, y: h * 0.5 }); }
  
  public fresh<R>(inp: { fill?: Colour }, fn: () => R) {
    
    const { w, h } = this.size();
    if (inp?.fill) {
      this.ctx.fillStyle = inp.fill;
      this.ctx.fillRect(0, 0, w, h);
    } else {
      this.ctx.clearRect(0, 0, w, h);
    }
    return fn();
    
  }
  
  public frame(fn: (shift: { trn: (inp: { x: number, y: number }) => void, scl: (amt: number) => void, tur: (ang: number) => void }) => void) {
    
    this.ctx.save();
    fn(this.tfm);
    this.ctx.restore();
    
  }
  
  public absolute(fn: (size: { w: number, h: number }) => void) {
    
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    fn(this.size());
    
    ctx.restore();
    
  }
  
  protected commit(inp: Look, fn: () => void) {
    
    const { ctx } = this;
    
    const { lineW = 1, line, fill } = inp;
    if (line || fill) ctx.beginPath();
    
    fn();
    
    if (fill) { ctx.  fillStyle = fill;                        ctx.fill();   }
    if (line) { ctx.strokeStyle = line; ctx.lineWidth = lineW; ctx.stroke(); }
    
  }
  
  public clip(fn: () => void) { const { ctx } = this; ctx.beginPath(); fn(); ctx.clip(); }
  
  public rect(inp: { pos: Pt, w: number, h: number, tur: number } & Look) {
    
    const { pos, w, h, tur } = inp;
    
    this.frame(shift => {
      shift.trn(pos);
      shift.tur(tur);
      this.commit(inp, () => this.ctx.rect(w * -0.5, h * -0.5, w, h));
    });
    
  }
  
  public cone(inp: { pos: Pt, sweep: number, r: number, tur: number } & Look) {
    
    this.commit(inp, () => {
      
      const { ctx } = this;
      const { pos: { x, y }, tur, sweep, r } = inp;
      
      const ang0 = (tur - sweep * 0.5) * Pt.tau;
      const ang1 = (tur + sweep * 0.5) * Pt.tau;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang0) * r, y + Math.sin(ang0) * r);
      ctx.arc(x, y, r, ang0, ang1);
      ctx.closePath();
      
    });
    
  }
  
  public circle(inp: { pos: Pt, r: number } & Look) {
    
    this.commit(inp, () => {
      
      const { ctx } = this;
      const { pos, r } = inp;
      ctx.moveTo(pos.x + r, pos.y);
      if (r >= 0) ctx.arc(pos.x, pos.y, +r, 0, +Math.PI * 2);
      else        ctx.arc(pos.x, pos.y, -r, 0, -Math.PI * 2);
      
    });
    
  }
  
  public polygon(inp: { pts: Pt[] } & Look) {
    
    this.commit(inp, () => {
      
      const { ctx } = this;
      const { pts } = inp;
      const lastPt = pts.at(-1)!;
      ctx.moveTo(lastPt.x, lastPt.y);
      for (const { x, y } of pts) ctx.lineTo(x, y);
      
    });
    
  }
  
  public line(inp: { pt0: Pt, pt1: Pt } & Omit<Look, 'fill'>) {
    
    this.commit(inp, () => {
      this.ctx.moveTo(inp.pt0.x, inp.pt0.y);
      this.ctx.lineTo(inp.pt1.x, inp.pt1.y);
    });
    
  }

  public text(inp: { x: number, y: number, tur: number, text: string, fontSize: number, fill?: Colour, align?: CanvasCtx['textAlign'] }) {
    
    // TODO: should this dovetail into `this.commit` somehow...?
    const { ctx } = this;
    ctx.save();
    ctx.translate(inp.x, inp.y);
    ctx.rotate(inp.tur * Pt.tau);
    ctx.font = `${inp.fontSize}px monospace`;
    ctx.textAlign = inp.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = inp.fill ?? '#000';
    ctx.fillText(inp.text, 0, 0);
    ctx.restore();
    
  }
  
};