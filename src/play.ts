import type { Draw, Look } from './util/draw.ts';
import { Pt } from './util/pt.ts';
import ticker from './util/ticker.ts';
import { TimeStep, type Flow } from './util/timeStep/main.ts';
import { BaseCls as WireBaseCls, type Registry as WireRegistry } from './util/wire/main.ts';

type Tfm = { pos: { x: number, y: number }, tur: number };
export type ClsRegistry = typeof registry;
export type Registry = { [K in keyof ClsRegistry]: InstanceType<ClsRegistry[K]> };
export const registry = (() => {
  
  abstract class Bound extends WireBaseCls {
    
    public static readonly clsName: string = 'Bound';
    
    abstract axes():  Pt[];
    abstract proj(normAxis: Pt): readonly [ number, number ]; // Note the projection interval is ordered, i.e. `interval[0] <= interval[1]`
    abstract render(tfm: Tfm, draw: Draw, look: Look);
    
  };
  class CircleBound extends Bound {
    
    public static readonly clsName = 'CircleBound';
    
    protected r: number;
    constructor(inp: { r: number }) {
      super();
      this.r = inp.r;
    }
    encode() { return { r: this.r }; }
    
    axes()             { return []; }
    proj(normAxis: Pt) { return [ -this.r, +this.r ] as const; }
    render(tfm: Tfm, draw: Draw, look: Look) {
      draw.circle({ ...tfm.pos, r: this.r, ...look });
    }
    
  };
  class PolygonBound extends Bound {
    
    public static readonly clsName = 'PolygonBound';
    
    protected cornersRh: Pt[]; // "right-handed"
    protected cache: { axes: null | Pt[] };
    constructor(inp: { cornersRh: Pt[] }) {
      super();
      this.cornersRh = inp.cornersRh;
      this.cache = { axes: null };
    }
    encode() { return { cornersRh: this.cornersRh }; }
    
    axes() { return this.cache.axes ??= (() => {
      
      let last = this.cornersRh.at(-1)!;
      return this.cornersRh.map(pt => {
        
        const edge = pt.sub(last);
        last = pt;
        return edge.addTur(0.25).norm();
        
      });
      
    })(); }
    proj(normAxis: Pt) {
      
      let min = Infinity;
      let max = -Infinity;
      for (const pt of this.cornersRh) {
        const proj = pt.dot(normAxis);
        if (proj < min) min = proj;
        if (proj > max) max = proj;
      }
      
      return [ min, max ] as const;
      
    }
    render(tfm: Tfm, draw: Draw, look: Look) {
      draw.polygon({
        pts: Pt.rotate(this.cornersRh, tfm.tur).map(pt => pt.add(tfm.pos)),
        ...look
      });
    }
    
  };
  
  class Entity extends WireBaseCls {
    
    public static clsName = 'Entity';
    
    protected state: { id: string, ms: number };
    
    constructor(inp: Entity['state']) {
      super();
      this.state = inp;
    }
    
    public getId() { return this.state.id; }
    
    public getRelationGroups(flow: Flow | { ms: number }): readonly Play.RelationGroups[] { return []; }
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {}
    
    public render(flow: Flow | { ms: number }, draw: Draw) {
      draw.circle({ x: 0, y: 0, r: 100 + 50 * Math.sin(Math.PI * 2 * flow.ms * 0.001), fill: '#f00' });
    }
    
    encode() { return this.state; }
    
  };
  
  abstract class Physical extends Entity {
    
    public static clsName = 'Physical';
    
    protected state: Entity['state'] & {
      anchorMs: number,
      pos: Pt,
      tur: number
    };
    
    constructor(inp: Physical['state']) {
      super(inp);
      this.state = inp;
    }
    
    protected getForces(flow: Flow | { ms: number }): Play.Force[] { return []; }
    
    protected calcForce(flow: Flow | { ms: number }, force: Play.Force): { x: number, y: number, tur: number } {
      
      const durSc = Math.max(flow.ms - force.ms, force.durMs ?? -Infinity) * 0.001;
      
      if (durSc <= 0) return { x: 0, y: 0, tur: 0 };
      
      if (force.type === 'vel') return { x: force.x * durSc, y: force.y * durSc, tur: 0 };
      
      if (force.type === 'acl') {
        
        const acl = 0.5 * durSc * durSc;
        return { x: force.x * acl, y: force.y * acl, tur: 0 };
        
      }
      
      if (force.type === 'arc') {
        
        const { initAng, r, vel } = force;
        const { x, y } = Pt.add([
          Pt.polar({ tur: initAng + vel * durSc, mag: r }), // Circular motion around the origin
          Pt.polar({ tur: initAng + 0.5, mag: r })          // Constant offset by the circle radius so at t=0 the force is { x: 0, y: 0
        ]);
        return { x, y, tur: 0 };
        
      }
      
      if (force.type === 'turVel') return { x: 0, y: 0, tur: force.vel * durSc };
      
      throw Error('ow')[cl.mod]({ force });
      
    }
    
    public abstract getBound(flow: Flow | { ms: number }): Bound;
    
    public getWeight(flow: Flow | { ms: number }) { return 1; }
    
    public getRelationGroups(flow: Flow | { ms: number }) { return [ 'physics' ] as const; }
    
    public getTransform(flow: Flow | { ms: number }) {
      
      const { anchorMs } = this.state;
      
      let pos = new Pt(this.state.pos);
      let tur = this.state.tur;
      
      for (const force of this.getForces(flow)) {
        
        const f = this.calcForce(flow, force);
        pos = pos.add(f);
        tur += f.tur;
        
        // Subtract any part of the force which predates our anchor; that offset from the force is
        // already baked into the anchor!
        if (force.ms < anchorMs) {
          const f = this.calcForce({ ms: anchorMs }, force);
          pos = pos.sub(f);
          tur -= f.tur;
        }
        
      }
      
      return { pos, tur };
      
    }
    
    public reanchor(this, flow: Flow | { ms: number }, fn: (state: Physical['state']) => void = () => {}) {
      
      const { pos, tur } = this.getTransform(flow);
      this.state.anchorMs = flow.ms;
      this.state.pos = pos;
      this.state.tur = tur;
      fn(this.state);
      
    }
    
    public getColour(flow: Flow | { ms: number }): `#${string}` { return '#f00'; }
    
    public render(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      this.getBound(flow).render(tfm, draw, { fill: this.getColour(flow) });
      draw.line({
        pt0: tfm.pos,
        pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 100 })),
        line: this.getColour(flow)
      });
    }
    
  };
  
  class Obstacle extends Physical {
    
    public static clsName = 'Obstacle';
    
    protected state: Physical['state'] & {
      bound: Bound,
      tur: number,
      forces: Play.Force[]
    };
    
    constructor(inp: Obstacle['state']) {
      super(inp);
      this.state = inp;
    }
    
    encode() { return this.state; }
    
    public getForces() { return this.state.forces; }
    
    public getWeight() { return Infinity; }
    
    public getBound() { return this.state.bound; }
    
    public getColour(): `#${string}` { return '#000'; }
    
    public render(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      
      const { bound } = this.state;
      bound.render(tfm, draw, { fill: this.getColour() });
      
    }
    
  };
  
  abstract class Member extends Physical {
    
    public static readonly clsName: string = 'Member';
    
  };
  
  class Player extends Member {
    
    public static clsName = 'Player';
    
    protected state: Physical['state'] & {
      bound: Bound,
      name: string,
      buttons: { [K in Play.Button]: boolean }
    };
    constructor(inp: Player['state']) {
      super(inp);
      this.state = inp;
    }
    
    protected getBaseStats() { return {
      posSpeed: 5,
      turSpeed: 0.5,
      visionSweep: 0.3,
      visionRange: 120
    }; }

    protected getForces(flow: Flow | { ms: number; }) {
      
      const { buttons } = this.state;
      const tur = +(buttons.rotR1 || buttons.rotR2) - +(buttons.rotL1 || buttons.rotL2);
      
      const { posSpeed: posSpeed, turSpeed: baseTurSpeed } = this.getBaseStats();
      const turSpeed = baseTurSpeed * (false ? 1
        : (buttons.rotL2 || buttons.rotR2) ? 0.1
        : 1
      );
      
      // Movement penalties; strafing is slower; backwards is slowest
      const walkVelMult = false                                ? 1
        : this.state.buttons.dirD                              ? 0.3
        : (this.state.buttons.dirR || this.state.buttons.dirL) ? 0.55
        :                                                        1;
      
      // Direction of movement based on facing direction and buttons
      const vertPol = +this.state.buttons.dirU - 1.0 * +this.state.buttons.dirD;
      const horzPol = +this.state.buttons.dirR - 1.0 * +this.state.buttons.dirL;
      const walkVel = new Pt({ x: vertPol, y: horzPol })
        .norm()                     // fixed-length
        .mult(posSpeed * walkVelMult)          // apply walk vel mult
        .addTur(this.state.tur);  // Align with rotation
      
      const walkVelLen = walkVel.len();
      
      const forces: Play.Force[] = [];
      
      if (walkVelLen) {
        
        if (tur) {
          
          const secsPerTurn = 1 / turSpeed;
          const circum = secsPerTurn * walkVelLen;
          const r = circum / (2 * Math.PI);
          const initAng = this.state.tur - tur * 0.25; // Quarter turn offset in the direction of turning
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'arc', r, initAng, vel: tur * vertPol * turSpeed });
          
        } else {
          
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'vel', ...walkVel })
          
        }
        
      }
      
      if (tur) {
        forces.push({ ms: this.state.anchorMs, durMs: null, type: 'turVel', vel: tur * turSpeed });
      }
      
      return forces;
      
    }
    
    public getBound() { return this.state.bound; }
    
    public setBtn(btn: Play.Button, active: boolean) { this.state.buttons[btn] = active; }
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {
      const { visionSweep: visionAngle, visionRange: visionDistance } = this.getBaseStats();
      const { pos, tur } = this.getTransform(flow);
      draw.cone({ x: pos.x, y: pos.y, tur, sweep: visionAngle, r: visionDistance });
      draw.circle({ x: pos.x, y: pos.y, r: 10 });
    }
    
    public render(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      
      const colour = this.getColour(flow);
      this.state.bound.render(tfm, draw, { fill: colour });
      
      draw.circle({ x: tfm.pos.x, y: tfm.pos.y, r: 3, line: colour, lineW: 0.1 });
      
      draw.line({
        pt0: tfm.pos,
        pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 20 })),
        line: colour,
        lineW: 0.1
      });
      
    }
    
  };
  
  const classes = {
    Pt,
    CircleBound,
    PolygonBound,
    Entity,
    Physical,
    Obstacle,
    Player
  } satisfies WireRegistry;
  for (const k in classes) if (k !== classes[k].clsName) throw Error('clsName missing')[cl.mod]({ k })
  
  return classes;
  
})();

export namespace Play {
  
  export type Force = { ms: number, durMs: null | number } & [
    
    // Pos
    { type: 'vel', x: number, y: number },
    { type: 'acl', x: number, y: number },
    { type: 'arc', r: number, initAng: number, vel: number },
    
    // Ang
    { type: 'turVel', vel: number },
    
  ][number];
  
  export type RelationGroups = [
    'physics'
  ][number];
  
  export type State = {
    entities: Obj<Registry['Entity']>
  };
  export type Rel = [
    { type: 'sat', ents: [ string, string ], pen: number, axis: { x: number, y: number } }
  ][number];
  
  export type Button = never
    | `dir${'L' | 'R' | 'U' | 'D'}`
    | `rot${'L' | 'R'}${'1' | '2'}`
    | `act${0 | 1 | 2 | 3 | 4 | 5 | 6}`;
  
  export type ClientEvent = { ms: number } & [
    { ms: number, op: 'player.launch',  name: string                 },
    { ms: number, op: 'player.cancel'                                },
    { ms: number, op: 'player.key',     btn: `${'+' | '-'}${Button}` }
  ][number];
  
  export type Event = ClientEvent & { session: { id: string } };
  export type AckEvent = Event & { ack?: { id: string, clientUtcMs: number, serverUtcMs: number, resolvedUtcMs: number } };
  
};

export default () => {
  
  const pendingEvents: Play.Event[] = [];
  
  const { CircleBound, PolygonBound, Obstacle } = registry;
  const playTimeStep = new TimeStep<ClsRegistry, Play.State, Play.Event, Play.Rel>({
    seed: 1000,
    registry,
    msPerTick: 9,    // Just under 2 ticks per frame at 60fpsc (which is 16.666mspf)
    minMsPerTick: 3,
    state: { entities: {
      
      [`${Obstacle.clsName}/aaa`]: new Obstacle({
        id: `${Obstacle.clsName}/aaa`,
        ms: 0,
        anchorMs: 0,
        pos: new Pt({ x: 0, y: 0 }),
        tur: 0,
        bound: new CircleBound({ r: 50 }),
        forces: []
      }),
      [`${Obstacle.clsName}/spinnyBoi`]: new Obstacle({
        id: `${Obstacle.clsName}/spinnyBoi`,
        ms: 0,
        anchorMs: 0,
        pos: new Pt({ x: 70, y: 0 }),
        tur: 0,
        bound: new PolygonBound({
          cornersRh: (3)[cl.toArr](v => Pt.polar({ tur: v / 3, mag: 10 }))
        }),
        forces: [ { ms: 0, durMs: null, type: 'turVel', vel: 0.03 } ]
      }),
      
    }},
    advance: (state, evt, rng, { Player }) => {
      
      if (evt.op === 'timeStep.rel') {
        
        for (const rel of evt.rels) {
          
          if (rel.type === 'sat') {
            
            const [ ent0, ent1 ] = rel.ents.map(id => state.entities[id] as Registry['Physical']); // I'm preeetty sure that if `relationCfg.find` saw an entity id, that id is guaranteed to exist when we process the timeStep.rel event here...
            
            const axis = new Pt(rel.axis);
            const pen = rel.pen + 0.000001; // TODO: do we need this slop
            const w0 = ent0.getWeight(evt);
            const w1 = ent1.getWeight(evt);
            if (w0 === Infinity && w1 === Infinity) continue;
            
            const [ amt0, amt1 ] = (() => {
              
              if (w0 === Infinity) return [ 0, 1 ];
              if (w1 === Infinity) return [ 1, 0 ];
              
              const amt0 = w0 / (w0 + w1);
              return [ amt0, 1 - amt0 ];
              
            })();
            
            ent0.reanchor(evt, state => state.pos = state.pos.add(axis.mult(-1 * pen * amt0)));
            ent1.reanchor(evt, state => state.pos = state.pos.add(axis.mult(+1 * pen * amt1)));
            
          }
          
        }
        
      }
      
      if (evt.op === 'player.launch') {
        
        state.entities[`${Player.clsName}/${evt.session.id}`] = new Player({
          id: `${Player.clsName}/${evt.session.id}`,
          ms: evt.ms,
          name: evt.name,
          anchorMs: evt.ms,
          pos: new Pt({ x: 53, y: 0 }).add({ x: 0, y: rng.nextInt(-10, 10) }),
          tur: 0,
          buttons: ([ 'dirL', 'dirR', 'dirU', 'dirD', 'rotL1', 'rotL2', 'rotR1', 'rotR2', 'act0', 'act1', 'act2', 'act3', 'act4', 'act5', 'act6' ] as const)[cl.toObj](v => [ v, false ]),
          bound: new CircleBound({ r: 0.3 })
        });
      }
      
      if (evt.op === 'player.cancel') delete state.entities[`${Player.clsName}/${evt.session.id}`];
      
      if (evt.op === 'player.key') {
        
        const ent = state.entities[cl.at](`${Player.clsName}/${evt.session.id}`, null) as null | Registry['Player'];
        if (!ent) return;
        
        ent.reanchor(evt);
        ent.setBtn(evt.btn.slice(1) as Play.Button, evt.btn[0] === '+');
        
      }
      
    },
    relationCfg: {
      quality: 4,
      find: (flow, state, lastRels) => {
        
        const entities = lastRels
          ? new Set(lastRels[cl.map](rel => rel.ents.map(id => state.entities[id])).flat(1))
          : state.entities[cl.toArr](v => v);
        
        const relGroups: { [K in Play.RelationGroups]?: Registry['Entity'][] } = {};
        
        for (const ent of entities)
          for (const group of ent.getRelationGroups(flow))
            (relGroups[group] ??= []).push(ent)
        
        const rels: Play.Rel[] = [];
        
        const { physics = [] } = relGroups;
        (() => {
          
          const len = physics.length;
          for (let i = 1; i < len; i++) { for (let j = 0; j < i; j++) {
            
            const phys0 = physics[i] as Registry['Physical'];
            const phys1 = physics[j] as Registry['Physical'];
            const tfm0 = phys0.getTransform(flow);
            const tfm1 = phys1.getTransform(flow);
            const [ bound0, bound1 ] = [ phys0.getBound(flow), phys1.getBound(flow) ];
            
            const posDir = tfm1.pos.sub(tfm0.pos);
            
            const physAxes = [
              ...Pt.rotate(bound0.axes(), tfm0.tur).map(axis => ({ axis, phys: phys0 })),
              ...Pt.rotate(bound1.axes(), tfm1.tur).map(axis => ({ axis, phys: phys1 }))
            ];
            
            // Ensure at least one (trivial) axis - enables axis-less 0d points, circles
            if (!physAxes.length) physAxes.push({ axis: tfm0.pos.sub(tfm1.pos).norm(), phys: phys0 });
            
            const sat = (() => {
              
              let sat = { dist: -Infinity, physAxis: physAxes[0] };
              for (const physAxis of physAxes) {
                
                const { axis } = physAxis;
                const [ axisPos0, axisPos1 ] = [ tfm0.pos.dot(axis), tfm1.pos.dot(axis) ];
                const [ [ min0, max0 ], [ min1, max1 ] ] = [
                  bound0.proj(axis.addTur(-tfm0.tur)).map(v => v + axisPos0) as [ number, number ],
                  bound1.proj(axis.addTur(-tfm1.tur)).map(v => v + axisPos1) as [ number, number ]
                ];
                
                const dist = Math.max(min0 - max1, min1 - max0);
                if (dist >= 0) return null; // Separated along at least one axis!
                
                // Does this axis have less separation than the incumbent?
                if (dist > sat.dist) sat = { dist, physAxis };
                
              }
              
              return sat;
              
            })();
            
            if (sat) {
              const { dist, physAxis: { axis } } = sat;
              rels.push({
                type: 'sat',
                ents: [ phys0.getId(), phys1.getId() ],
                pen: -dist,
                axis: axis.dot(posDir) < 0 ? axis.mult(-1) : axis
              });
            }
            
          }}
          
        })();
        
        return rels;
        
      }
    }
  });
  
  let patienceMs = 20; // Intentionally lag by this amount to avoid constantly stepping up past most recent events and constantly rolling back
  let offsetMs = 0;    // Fine-tuning knob for utc millis - e.g. to precisely align client+server
  const playTicker = ticker(60, ({ ms }) => {
    
    const events = [ ...pendingEvents ].sort((evt0, evt1) => evt0.ms - evt1.ms);
    pendingEvents.length = 0;
    
    for (const event of events) playTimeStep.processEvent(event);
    
    playTimeStep.tickUpToMs(Math.max(0, (ms + offsetMs) - patienceMs));
    
  });
  
  return {
    registry,
    timeStep: playTimeStep,
    ticker: playTicker,
    setPatienceMs: (pMs: number) => patienceMs = pMs,
    setOffsetMs:   (oMs: number) => offsetMs = oMs,
    getOffsetMs:   ()            => offsetMs,
    addEvent: (event: Play.Event) => pendingEvents.push(event)
  };
  
};