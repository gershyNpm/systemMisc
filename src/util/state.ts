import type { JsfnInstSer } from '@gershy/util-jsfn-encode';

export abstract class AdvancingState<E, S extends Json> {
  
  protected state: S;
  
  constructor(inp: { state: S }) {
    this.state = inp.state;
  }
  public advance(evt: E) { this.state = this.getAdvance(this.state, evt); }
  protected abstract getAdvance(prev: S, evt: E): S;
  
  toJsfn() {
    
    type Cls = typeof AdvancingState<E, S>;
    return {
      hoist: `${import.meta.filename}::${this.constructor.name}`,
      form: this.constructor as Cls,
      args: [ { state: this.state } ]
    } satisfies JsfnInstSer<Cls>;
    
  }
  
};