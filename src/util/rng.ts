export class Rng {
  
  protected state: number;
  
  constructor(state: number) {
    this.state = state >>> 0;
  }
  
  public nextFlt() { // return [0, +1)
    
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    
  }
  
  public nextFltPol() { return 2 * (this.nextFlt() - 0.5); } // returns [-1, +1)
  
  // Convenience helper to get an integer between min (inclusive) and max (exclusive)
  public nextInt(min: number, max: number) {
    
    return min + Math.floor(this.nextFlt() * (max - min));
    
  }
  
  public elem<T>(elems: T[]): Skip | T { return elems.length ? elems[this.nextInt(0, elems.length)] : cl.skip; }
  
  public shuffle<T>(elems: T[]): T[] {
    
    const len = elems.length;
    elems = [ ...elems ];
    for (let i = 0; i < len; i++) {
      const rand = this.nextInt(0, len);
      [ elems[i], elems[rand] ] = [ elems[rand], elems[i] ];
    }
    return elems;
    
  }
  
  public clone() { return new Rng(this.state); }
  
  public export() { return { state: this.state }; }
  
}