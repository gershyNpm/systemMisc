export class Pt {
  
  static carte(inp: { x: number, y: number }) { return new Pt(inp); }
  static polar(inp: { ang: 0 | number | 1, mag: number }) {
    
    // Note that with the classic canvas coordinate system of x increasing to the right and y
    // increasing downwards, with ang=0 the output points right, then as ang increases the output
    // rotates clockwise
    
    const ang = inp.ang * 2 * Math.PI;
    return new Pt({ x: Math.cos(ang) * inp.mag, y: Math.sin(ang) * inp.mag });
    
  };
  static add(pts: Pt[]) {
    const pt = new Pt();
    for (const { x, y } of pts) { pt.x += x; pt.y += y; }
    return pt;
  };
  static mid(pts: Pt[]) {
    return this.add(pts).mult(1 / pts.length);
  };
  static ang(src: { x: number, y: number }, trg: { x: number, y: number }) {
    const ang = Math.atan2(trg.y - src.y, trg.x - src.x) / (2 * Math.PI);
    return ang < 0 ? ang + 1 : ang;
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
  
  public rotateBy(ang: number) {
    
    const cur = Pt.ang({ x: 0, y: 0 }, this);
    return Pt.polar({ ang: cur + ang, mag: this.len() });
    
  }
  
};