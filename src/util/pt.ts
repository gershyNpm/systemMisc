// Angles: "turn" is a fraction of 360deg, i.e. degrees = turns * 360; radians = turns * 2pi
// - The single-letter term for "turn" is simply "u"; three-letter term is "tur"
// 2d cartesian vector: cartesian: (x, y)
// 2d polar vector: (turn, mag)
// Movement: along x axis is horz ("horizontal"); along y axis is vert ("vertical")
// Rotation: clockwise is rh ("right-handed"); counter-clockwise is lh ("left-handed")
// Rectangular dimensions: w/h ("width" / "height")
// Rectangular anchors: l/r/u/d ("left" / "right" / "up" / "down")
// Coordinate system visualization:
// - Positive turn increments are right-handed; negative is left-handed
// - Positive x coordinate movement is rightwards
// - Positive y coordinate movement is downwards

export class Pt {
  
  public static readonly tau = 2 * Math.PI;
  public static readonly clsName = 'Pt';
  
  static carte(inp: { x: number, y: number }) { return new Pt(inp); }
  static polar(inp: { tur: 0 | number | 1, mag: number }) {
    
    // Note that with the classic canvas coordinate system of x increasing to the right and y
    // increasing downwards, with ang=0 the output points right, then as ang increases the output
    // rotates clockwise
    
    const ang = inp.tur * Pt.tau;
    return new Pt({ x: Math.cos(ang) * inp.mag, y: Math.sin(ang) * inp.mag });
    
  };
  static add(pts: { x: number, y: number }[]) {
    const pt = new Pt();
    for (const { x, y } of pts) { pt.x += x; pt.y += y; }
    return pt;
  };
  static mid(pts: { x: number, y: number }[]) {
    return this.add(pts).mult(1 / pts.length);
  };
  static tur(src: { x: number, y: number }, trg: { x: number, y: number }) {
    const tur = Math.atan2(trg.y - src.y, trg.x - src.x) / Pt.tau;
    return tur < 0 ? tur + 1 : tur;
  };
  static rotate(pts: { x: number, y: number }[], turDelta: number) {
    
    const angDelta = turDelta * Pt.tau;
    const [ cos, sin ] = [ Math.cos(angDelta), Math.sin(angDelta) ];
    return pts.map(({ x, y }) => new Pt({
      x: x * cos - y * sin,
      y: x * sin + y * cos
    }));
    
  };
  
  public x: number;
  public y: number;
  constructor(inp: { x: number, y: number } = { x: 0, y: 0 }) {
    this.x = inp.x;
    this.y = inp.y;
  }
  encode() { return { x: this.x, y: this.y }; }
  
  public len()                             { return Math.sqrt(this.x * this.x + this.y * this.y); }
  public dot(pt: { x: number, y: number }) { return this.x * pt.x + this.y * pt.y; }
  public add(pt: { x: number, y: number }) { return new Pt({ x: this.x + pt.x, y: this.y + pt.y }); }
  public sub(pt: { x: number, y: number }) { return new Pt({ x: this.x - pt.x, y: this.y - pt.y }); }
  public mult(mag: number)                 { return new Pt({ x: this.x * mag, y: this.y * mag }); }
  public norm()                            { return this.mult(1 / this.len()); }
  
  public getTur(pt: { x: number, y: number }) { return Pt.tur(this, pt); }
  public addTur(turDelta: number)             { return Pt.rotate([ this ], turDelta)[0]; }
  
};