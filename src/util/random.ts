export class Random {
  
  protected state: number;
  
  constructor(state: number) {
    this.state = state >>> 0;
  }

  public nextFlt() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Convenience helper to get an integer between min (inclusive) and max (exclusive)
  public nextInt(min: number, max: number) {
    return min + Math.floor(this.nextFlt() * (max - min));
  }
  
  public elem<T>(elems: T[]) { return elems[this.nextInt(0, elems.length)]; }
  
  public shuffle<T>(elems: T[]): T[] {
    
    elems = [ ...elems ];
    
    const ret: T[] = [];
    while (elems.length) {
      
      const ind = this.nextInt(0, elems.length);
      ret.push(elems[ind]);
      elems.splice(ind, 1);
      
    }
    
    return ret;
    
  }
  
  public clone() { return new Random(this.state); }
  
  
}