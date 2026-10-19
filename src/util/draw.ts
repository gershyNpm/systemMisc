type Canvas = {
  width: number,
  height: number
};
type CanvasCtx = {
  
  save: () => void,
  restore: () => void,
  
  
  beginPath: () => void,
  clearRect: (x: number, y: number, w: number, h: number) => void,
  arc: (x: number, y: number, r: number, ang0: number, ang1: number) => void,
  
  fillStyle: string,   fill:   () => void,
  strokeStyle: string, stroke: () => void,
  
};
export class Draw {
  
  protected canvas: Canvas;
  protected ctx: CanvasCtx;
  constructor(inp: { canvas: Canvas, ctx: CanvasCtx }) {
    this.canvas = inp.canvas;
    this.ctx = inp.ctx;
  }
  
  public clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }
  
  public frame(fn: (draw: Draw) => void) {
    this.ctx.save
  }
  
  public circle(inp: { x: number, y: number, r: number, line?: `#${string}`, fill?: `#${string}` } & ({ line: string } | { fill: string })) {
    
    const { x, y, r, line = null, fill = null } = inp;
    const ctx = this.ctx;
    
    ctx.beginPath();
    if (r >= 0) ctx.arc(x, y, +r, 0, +Math.PI * 2);
    else        ctx.arc(x, y, -r, 0, -Math.PI * 2);
    
    if (fill) { ctx.fillStyle   = fill; ctx.fill();   }
    if (line) { ctx.strokeStyle = line; ctx.stroke(); }
    
  }
  
};