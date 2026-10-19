import { TimeStep, TimeStepBeing, type Flow, type State } from './util/timeStep/main.ts';

export namespace Play {
  
  export type Bound = never
    | { type: 'circle', ext: number }
    | { type: 'square', ext: number };
  
  export type Entity = { pos: { x: number, y: number }, bound: Bound, colour: `#${string}` } & (never
    | { type: 'player' }
    | { type: 'enemy' }
  );
  export type State = {
    entities: Obj<Entity>
  };
  export type Rel = null;
  
  type Button = never
    | `dir${'L' | 'R' | 'U' | 'D'}`
    | `act${0 | 1 | 2 | 3 | 4 | 5}`;
  export type Event = { ms: number } & [
    { ms: number, op: 'launch', session: { id: string } },
    { ms: number, op: 'cancel', session: { id: string } },
    { ms: number, op: 'key',    session: { id: string }, btn: `${'+' | '-'}${Button}` }
  ][number];
  
};

const registry = (() => {
  
  type Force = never
    | { ms: number, durMs: null | number, type: 'vel', vx: number, vy: number }
    | { ms: number, durMs: null | number, type: 'acl', vx: number, vy: number, ax: number, ay: number };
  
  class Physical<S extends State> extends TimeStepBeing {
    
    static clsName = 'Entity';
    
    protected data: {
      anchor: { ms: number, x: number, y: number },
      forces: Force[]
    };
    
    constructor(inp: Physical<S>['data']) {
      super();
      this.data = inp;
    }
    
    protected calcForce(flow: Flow | { ms: number }, force: Force) {
      
      const durSc = Math.max(flow.ms - force.ms, force.durMs ?? -Infinity) * 0.001;
      if (durSc <= 0) return { x: 0, y: 0 };
      
      if (force.type === 'vel') {
        
        return { x: force.vx * durSc, y: force.vy * durSc };
        
      }
      
      if (force.type === 'acl') {
        
        const acl = 0.5 * durSc * durSc;
        return {
          x: force.vx * durSc + force.ax * acl,
          y: force.vy * durSc + force.ay * acl
        };
        
      }
      
      throw Error('ow');
      
    }
    
    getPos(flow: Flow) {
      
      const { ms, x, y } = this.data.anchor;
      let xx = x;
      let yy = y;
      
      for (const force of this.data.forces) {
        
        const { x: fx, y: fy } = this.calcForce(flow, force);
        xx += fx;
        yy += fy;
        
        // Subtract any part of the force already included in our anchor
        if (force.ms > ms) {
          
          const { x: fx, y: fy } = this.calcForce({ ms }, force);
          xx -= fx;
          yy -= fy;
          
        }
        
        
      }
      
    }
    
    getJsonData() { return this.data; }
    
  };
  
  return {
    
    Physical
    
  } satisfies Obj<new (...args: any[]) => TimeStepBeing>;
  
})();

export default new TimeStep<typeof registry, Play.State, Play.Event, Play.Rel>({
  seed: 1000,
  registry,
  state: { entities: {} },
  advance: (state, evt, rng) => {
    
    if (evt.op === 'launch') state.entities[`player/${evt.session.id}`] = {
      type: 'player',
      pos: { x: -500 + rng.nextFlt() * 1000, y: -500 + rng.nextFlt() * 1000 },
      bound: { type: 'circle', ext: 1 },
      colour: '#aa0'
    };
    
    if (evt.op === 'cancel') delete state.entities[`player/${evt.session.id}`];
    
    if (evt.op === 'key') {
      
      const ent = state.entities[cl.at](`player/${evt.session.id}`, null);
      if (ent) {
        
        
        
      }
      
    }
    
    return state;
    
  }
});