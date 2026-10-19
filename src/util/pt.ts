export class Pt {
  
  static mid(pts: Pt[]) {
    let x = 0;
    let y = 0;
    for (const pt of pts) { x += pt.x; y += pt.y; }
    const mult = 1 / pts.length;
    return new Pt({ x: x * mult, y: y * mult });
  };
  
  public x: number;
  public y: number;
  constructor(inp?: { x: number, y: number }) {
    const { x, y } = inp ?? { x: 0, y: 0 };
    this.x = x;
    this.y = y;
  }
  
  public json() { return { x: this.x, y: this.y }; }
  
  public len()                             { return Math.sqrt(this.x * this.x + this.y * this.y); }
  public dot(pt: { x: number, y: number }) { return this.x * pt.x + this.y * pt.y; }
  public add(pt: { x: number, y: number }) { return new Pt({ x: this.x + pt.x, y: this.y + pt.y }); }
  public sub(pt: { x: number, y: number }) { return new Pt({ x: this.x - pt.x, y: this.y - pt.y }); }
  public mult(mag: number)                 { return new Pt({ x: this.x * mag, y: this.y * mag }); }
  public norm()                            { return this.mult(1 / this.len()); }
  
  public moveTo(pt: { x: number, y: number }, amt: number) {
    
    const dx = pt.x - this.x;
    const dy = pt.y - this.y;
    const mult = amt / Math.sqrt(dx * dx + dy * dy)
    return this.add({ x: dx * mult, y: dy * mult });
    
  }
  
  public ptMult(pt: { x: number, y: number }) {
    return new Pt({ x: this.x * pt.x, y: this.y * pt.y });
  }
  public angMove(inp: { ang: 0 | number | 1, mag: number }) {
    const ang = inp.ang * 2 * Math.PI;
    return new Pt({
      x: this.x + Math.cos(ang) * inp.mag,
      y: this.y + Math.sin(ang) * inp.mag
    });
  }
  
};