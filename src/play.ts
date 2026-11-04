import type { Draw, Look } from './util/draw.ts';
import { Pt } from './util/pt.ts';
import type { Rng } from './util/rng.ts';
import ticker from './util/ticker.ts';
import { TimeStep } from './util/timeStep/main.ts';
import { BaseCls as WireBaseCls, type Registry as WireRegistry } from './util/wire/main.ts';

// TODO
// - Consider switching everything from `Date.now()` to `performance.now()`

export namespace Play {
  
  export type Force = { ms: number, durMs: null | number } & [
    
    // Pos
    { type: 'vel', x: number, y: number },
    { type: 'acl', x: number, y: number },
    { type: 'arc', r: number, initTur: number, vel: number },
    
    // Ang
    { type: 'turVel', amt: number },
    { type: 'turAcl', amt: number, flatSc: number }, // Note "flatSc" caps the acceleration effect at whatever amount it hits after that many seconds - pass `flatSc: Infinity` to disable
    
  ][number];
  
  export type RelationGroup = [
    'physics',
    'player'
  ][number];
  
  export type State = {
    world: Registry['World']
  };
  
  // Relations that can happen between any two entities
  export type Rel = [
    
    // Stage rels
    { type: 'waitingRoomLaunch',  ms: number },
    { type: 'plungeSpin',         ms: number },
    { type: 'plungeOpen',         ms: number },
    { type: 'plungeShut'                     },
    
    { type: 'sat', ents: [ string, string ], pen: number, axis: { x: number, y: number } },
    
    { type: 'ent', entId: string, ms: number, inp: { type: string } & Obj<Json> }
    
  ][number];
  
  // Subset of `Rel` which are single-entity-specific - generated and advanced by the same entity
  export type EntityRel = Rel & { type: 'ent', inp: [
    { type: 'bullet' },
    { type: 'zombiePlan' }
  ][number] };
  
  export type EntityRelInp = EntityRel['inp'] & { ms: number };
  
  export type Button = never
    | `dir${'L' | 'R' | 'U' | 'D'}`
    | `tur${'L' | 'R'}${'1' | '2'}`
    | `mod${0}`
    | `act${0 | 1 | 2 | 3 | 4 | 5 | 6}`;
  
  export type ClientEvent = { ms: number } & [
    { ms: number, op: 'player.launch',  name: string                 },
    { ms: number, op: 'player.cancel'                                },
    { ms: number, op: 'player.key',     btn: `${'+' | '-'}${Button}` }
  ][number];
  
  export type Event = ClientEvent & { session: { id: string } };
  export type AckEvent = Event & { ack?: { id: string, clientMs: number, serverMs: number, resolvedMs: number } };
  
  export type RenderOp = { z: number, fn: () => void };
  
  export type ClsRegistry = typeof registry;
  export type Registry = { [K in keyof ClsRegistry]: InstanceType<ClsRegistry[K]> };
  
  export type Tfm = { pos: Pt, tur: number };
  
};

// Utils
export class Flow {
  
  // Note: never sent over wire - simply a utility class instantiated by `World`!
  
  readonly ms: number;
  readonly sc: number;
  readonly stats: { hit: number, miss: number };
  protected cache: Map<string, any>;
  constructor(ms: number) {
    this.ms = ms;
    this.sc = ms * 0.001;
    this.cache = new Map();
    this.stats = { hit: 0, miss: 0 };
  }
  
  cached<V>(key: string, fn: () => V): V {
    
    const hit = this.cache.get(key);
    if (hit !== cl.skip) { this.stats.hit++; return hit; }
    
    const miss = fn();
    this.cache.set(key, miss);
    this.stats.miss++;
    return miss;
    
  }
  
  cacheInvalidate(key: string) { this.cache.delete(key); }
  
  jumpTo(ms: number) { return new Flow(ms); }
  
};

export const registry = (() => {
  
  const debuggg = true;
  
  // Geometry
  abstract class Bound extends WireBaseCls {
    
    static readonly clsName: string = 'Bound';
    
    abstract axes():  Pt[];
    abstract proj(normAxis: Pt): readonly [ number, number ]; // Note the projection interval is ordered, i.e. `interval[0] <= interval[1]`
    abstract render(tfm: Play.Tfm, draw: Draw, look: Look): void;
    abstract boundingRadius(): number;
    
  };
  class CircleBound extends Bound {
    
    static readonly clsName: string = 'CircleBound';
    
    r: number;
    constructor(inp: { r: number }) {
      super();
      this.r = inp.r;
    }
    encode() { return { r: this.r }; }
    
    axes()             { return []; }
    proj(normAxis: Pt) { return [ -this.r, +this.r ] as const; }
    render(tfm: Play.Tfm, draw: Draw, look: Look) {
      draw.circle({ ...tfm, r: this.r, ...look });
    }
    boundingRadius() { return this.r; }
    
  };
  class RectBound extends Bound {
    
    static readonly clsName: string = 'RectBound';
    
    w: number;
    h: number;
    constructor(inp: { w: number, h: number }) {
      super();
      this.w = inp.w;
      this.h = inp.h;
    }
    encode() { return { w: this.w, h: this.h }; }
    
    axes() { return [ new Pt({ x: 1, y: 0 }), new Pt({ x: 0, y: 1 }) ]; }
    proj(normAxis: Pt) {
      const hw = this.w * 0.5;
      const hh = this.h * 0.5;
      return PolygonBound.project(normAxis, [
        new Pt({ x: -hw, y: -hh }),
        new Pt({ x: +hw, y: -hh }),
        new Pt({ x: +hw, y: +hh }),
        new Pt({ x: -hw, y: +hh })
      ]);
    }
    render(tfm: Play.Tfm, draw: Draw, look: Look) {
      draw.rect({ ...tfm, w: this.w, h: this.h, ...look });
    }
    boundingRadius() { return Math.hypot(this.w * 0.5, this.h * 0.5); }
    
  };
  class PolygonBound extends Bound {
    
    static readonly clsName: string = 'PolygonBound';
    
    static project(normAxis: Pt, pts: Pt[]) {
      
      let min = Infinity;
      let max = -Infinity;
      for (const pt of pts) {
        const proj = pt.dot(normAxis);
        if (proj < min) min = proj;
        if (proj > max) max = proj;
      }
      
      return [ min, max ] as const;
      
    }
    
    cornersRh: Pt[]; // "right-handed"
    protected cache: { axes: null | Pt[], boundingRadius: null | number };
    constructor(inp: { cornersRh: Pt[] }) {
      super();
      this.cornersRh = inp.cornersRh;
      this.cache = { axes: null, boundingRadius: null };
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
    proj(normAxis: Pt) { return PolygonBound.project(normAxis, this.cornersRh); }
    render(tfm: Play.Tfm, draw: Draw, look: Look) {
      
      draw.polygon({
        pts: Pt.rotate(this.cornersRh, tfm.tur).map(pt => pt.add(tfm.pos)),
        ...look
      });
      
    }
    boundingRadius() { return this.cache.boundingRadius ??= (() => {
      
      let max = 0;
      for (const pt of this.cornersRh) max = Math.max(max, pt.len());
      return max;
      
    })(); }
    
  };
  
  class Entity extends WireBaseCls {
    
    static readonly clsName: string = 'Entity';
    
    protected state: { ms: number };
    
    constructor(state: Entity['state']) {
      super();
      this.state = state;
    }
    
    getRelationGroups(flow: Flow): readonly Play.RelationGroup[] { return []; }
    
    getRelations(flow: Flow): Play.EntityRel[] { return []; }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp) {}
    
    renderClip(flow: Flow, draw: Draw) {}
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      return [ { z: 0, fn: () => {
        draw.text({ x: 0, y: 0, tur: flow.sc, text: (this as any).constructor.clsName, fontSize: 1, fill: '#f00' })
      }}];
      
    }
    
    encode() { return this.state; }
    
  };
  
  class World extends WireBaseCls {
    
    static readonly clsName: string = 'World';
    
    protected state: { name: string, stage: Stage };
    
    constructor(state: World['state']) {
      super();
      this.state = state;
    }
    encode() { return this.state; }
    
    getStage(flow: Flow)   { return this.state.stage; }
    setStage(stage: Stage) { this.state.stage = stage; }
    
    getRelations(flow: Flow, lastRels: null | Play.Rel[]): Play.Rel[] {
      
      return this.getStage(flow).getRelations(flow, lastRels).rels;
      
    }
    
    dispatchAdvanceEvent(rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      const flow = new Flow(evt.ms);
      this.getStage(flow).dispatchAdvanceEvent(flow, this, rng, evt);
      
    }
    
  };
  class Stage extends WireBaseCls {
    
    static readonly clsName: string = 'Stage';
    
    static wall = (inp: { flow: Flow, id?: string, w: number, pt0: Pt, pt1: Pt }) => {
      
      const { flow, id = null, w, pt0, pt1 } = inp;
      const mid = pt0.add(pt1).mult(0.5);
      
      return Obstacle.fromInitialState({
        flow,
        id,
        bound: new RectBound({ w: pt1.sub(pt0).len(), h: w }),
        pos: mid,
        tur: pt0.getTur(pt1)
      });
      
    };
    
    static airlock = (inp: { flow: Flow, num: number, r?: number, pos: Pt, tur: number }) => (5)[cl.toArr](n => {
      
      const { flow, num, r = 15, pos, tur } = inp;
      return Stage.wall({
        flow,
        id: `${Obstacle.clsName}/airlock${num}/${n}`,
        w: 3,
        pt0: pos.add(Pt.polar({ tur: tur + (n / 5) + (1 / 5) * -0.5, mag: r })),
        pt1: pos.add(Pt.polar({ tur: tur + (n / 5) + (1 / 5) * +0.5, mag: r }))
      });
      
    });
    
    protected state: {
      ms: number,
      entities: Obj<Entity>
    };
    constructor(state: Stage['state']) {
      super();
      this.state = state;
    }
    encode() { return this.state; }
    
    getEntities(flow: Flow) { return this.state.entities; }
    
    getRelations(flow: Flow, lastRels: null | Play.Rel[]) {
      
      const ents = this.getEntities(flow);
      const entities = lastRels
        ? new Set(lastRels[cl.map](rel => ((rel as { ents?: string[] }).ents ?? []).map(id => ents[id])).flat(1))
        : (function*() { for (const k in ents) yield ents[k] })();
      
      const relGroups: { [K in Play.RelationGroup]?: Entity[] } = {};
      const rels: Play.Rel[] = [];
      
      for (const ent of entities) {
        
        // Ignore time rels that are too far in the future to be processed here
        for (const timeRel of ent.getRelations(flow))
          if (timeRel.ms < flow.ms + 3 * 1000)
            rels.push(timeRel);
        
        for (const group of ent.getRelationGroups(flow))
          (relGroups[group] ??= []).push(ent)
        
      }
      
      const { physics = [] } = relGroups;
      (() => {
        
        const len = physics.length;
        for (let i = 1; i < len; i++) { for (let j = 0; j < i; j++) {
          
          const phys0 = physics[i] as Physical;
          const phys1 = physics[j] as Physical;
          
          if (!phys0.canCollide(phys1) || !phys1.canCollide(phys0)) continue;
          
          const tfm0 = phys0.getTransform(flow);
          const tfm1 = phys1.getTransform(flow);
          const [ bound0, bound1 ] = [ phys0.getBound(flow), phys1.getBound(flow) ];
          
          const posDir = tfm1.pos.sub(tfm0.pos);
          
          const physAxes = [
            ...Pt.rotate(bound0.axes(), tfm0.tur).map(axis => ({ axis, phys: phys0 })),
            ...Pt.rotate(bound1.axes(), tfm1.tur).map(axis => ({ axis, phys: phys1 }))
          ];
          
          // Ensure at least one (trivial) axis - enables axis-less 0d points, circles
          if (!physAxes.length) physAxes.push({
            axis: tfm1.pos.sub(tfm0.pos).norm(new Pt({ x: 1, y: 0 })),
            phys: phys0
          });
          
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
              axis: axis.dot(posDir) < 0 ? axis.mult(-1) : axis // Note this axis must point from `phys0` to `phys1`!
            });
          }
          
        }}
        
      })();
      
      return { rels, entities, relGroups };
      
    }
    
    dispatchAdvanceRelations(world: World, flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.Rel) {
      
      if (rel.type === 'sat') {
        
        const [ ent0, ent1 ] = rel.ents.map(id => entities[cl.at](id, null) as null | Physical); // I'm preeetty sure that if `relationCfg.find` saw an entity id, that id is guaranteed to exist when we process the timeStep.rel event here...
        if (!ent0 || !ent1) return;
        
        const axis = new Pt(rel.axis);
        const pen = rel.pen + 0.000001; // TODO: do we need this slop
        const w0 = ent0.getWeight(flow); // Note that sat has already guaranteed
        const w1 = ent1.getWeight(flow);
        
        const [ amt0, amt1 ] = (() => {
          
          if (w0 === Infinity) return [ 0, 1 ];
          if (w1 === Infinity) return [ 1, 0 ];
          
          const amt0 = w0 / (w0 + w1);
          return [ amt0, 1 - amt0 ];
          
        })();
        
        ent0.reanchor(flow, state => state.pos = state.pos.add(axis.mult(-1 * pen * amt0)));
        ent1.reanchor(flow, state => state.pos = state.pos.add(axis.mult(+1 * pen * amt1)));
        
        ent0.advanceCollide({ world, flow, entities, rng, phys: ent1 });
        ent1.advanceCollide({ world, flow, entities, rng, phys: ent0 });
        return;
        
      }
      
      if (rel.type === 'ent') {
        
        const ent = entities[cl.at](rel.entId, null);
        if (!ent) return;
        
        ent.advanceRelation(flow, entities, rng, { ms: rel.ms, ...(rel as Play.EntityRel).inp });
        
      }
      
    }
    
    dispatchAdvanceEvent(flow: Flow, world: World, rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      const entities = this.getEntities(flow);
      
      if (evt.op === 'timeStep.rel')
        for (const rel of evt.rels)
          this.dispatchAdvanceRelations(world, flow, entities, rng, rel);
      
      if (evt.op === 'player.key' && entities[cl.has](`${Player.clsName}/${evt.session.id}`)) {
        
        const ent = entities[`${Player.clsName}/${evt.session.id}`] as Play.Registry['Player'];
        
        const btn = evt.btn.slice(1) as Play.Button;
        const act = evt.btn[0] === '+';
        ent.advanceButton(flow, rng, btn, act);
        
      }
      
      return entities;
      
    }
    
    renderClip(flow: Flow, draw: Draw) {}
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      return [ { z: 0, fn: () => {
        draw.text({ x: 0, y: 0, tur: flow.sc, text: (this as any).constructor.clsName, fontSize: 1, fill: '#f00' })
      }}];
      
    }
    
  };
  class WaitingRoom extends Stage {
    
    static readonly clsName: string = 'WaitingRoom';
    
    static fromInitialState(inp: { flow: Flow, players: { required: number } }) {
      
      const mysteryBound = new PolygonBound({
        cornersRh: (3)[cl.toArr](v => Pt.polar({ tur: v / 3, mag: 8 }))
      });
      
      const { flow } = inp;
      return new WaitingRoom({
        ms: flow.ms,
        players: { total: 0, required: inp.players.required, fulfilledMs: null, delayLaunchMs: debuggg ? 500 : 1000 * 10 },
        entities: [
          
          ...Stage.airlock({ flow, num: 0, pos: new Pt(), tur: 0 }),
          
          Obstacle.fromInitialState({
            flow,
            id: `${Obstacle.clsName}/mystery0`,
            pos: new Pt(),
            tur: 0,
            bound: mysteryBound,
            forces: [ { ms: 0, durMs: null, type: 'turVel', amt: 0.06 } ]
          }),
          
          Obstacle.fromInitialState({
            flow,
            id: `${Obstacle.clsName}/mystery1`,
            pos: new Pt(),
            tur: 0,
            bound: mysteryBound,
            forces: [ { ms: 0, durMs: null, type: 'turVel', amt: -0.06 } ]
          }),
          
        ][cl.toObj](obs => [ obs.getId(), obs ])
      });
      
    }
    
    protected state: Stage['state'] & {
      players: { total: number, required: number, fulfilledMs: null | number, delayLaunchMs: number }
    };
    
    constructor(state: WaitingRoom['state']) { super(state); this.state = state; }
    
    getRelations(flow: Flow, lastRels: null | Play.Rel[]) {
      
      const r = super.getRelations(flow, lastRels);
      
      const { fulfilledMs, delayLaunchMs } = this.state.players;
      if (fulfilledMs)
        r.rels.push({ ms: fulfilledMs + delayLaunchMs, type: 'waitingRoomLaunch' })
      
      return r;
      
    }
    
    dispatchAdvanceRelations(world: World, flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.Rel) {
      
      super.dispatchAdvanceRelations(world, flow, entities, rng, rel);
       
      if (rel.type === 'waitingRoomLaunch') {
        
        this.state.players.fulfilledMs = null;
        this.state.players.required += 100;
        
        const entities = { ...this.state.entities };
        delete entities[`${Obstacle.clsName}/wall0`]; // Delete the wall with angle 0
        
        const addEnts = [
          
          Obstacle.fromInitialState({
            flow,
            id: `${Obstacle.clsName}/plungeWall0`,
            pos: new Pt({ x: 30, y: -7 }),
            tur: 0,
            bound: new RectBound({ w: 30, h: 4 })
          }),
          Obstacle.fromInitialState({
            flow,
            id: `${Obstacle.clsName}/plungeWall1`,
            pos: new Pt({ x: 30, y: +7 }),
            tur: 0,
            bound: new RectBound({ w: 30, h: 4 })
          }),
          
          ...(10)[cl.toArr](n => new Zombie({
            ms: flow.ms,
            id: `${Zombie.clsName}/plungeZombie${n}`,
            anchorMs: flow.ms,
            pos: new Pt({ x: 30, y: 0 }).add(Pt.polar({ tur: rng.nextFlt(), mag: rng.nextFlt() * 4 })),
            tur: rng.nextFlt(),
            nextPlanMs: flow.ms + 5 * 1000,
            plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! }
          }))
          
        ];
        
        for (const ent of addEnts) entities[ent.getId()] = ent;
        
        world.setStage(Plunge.fromInitialState({
          flow,
          rng,
          level: 0,
          players: entities[cl.map](v => cl.inCls(v, Player) ? v : cl.skip),
          airlockPos: new Pt({ x: 0, y: 0 }),
          airlockTur: 0
        }));
        
      }
      
    }
    
    dispatchAdvanceEvent(flow: Flow, world: World, rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      const entities = super.dispatchAdvanceEvent(flow, world, rng, evt);
      
      if (evt.op === 'player.launch' && this.state.players.total < this.state.players.required) {
        
        this.state.players.total++;
        
        const tur = rng.nextFlt();
        entities[`${Player.clsName}/${evt.session.id}`] = new Player({
          id: `${Player.clsName}/${evt.session.id}`,
          ms: evt.ms,
          name: evt.name,
          anchorMs: evt.ms,
          pos: Pt.polar({ tur, mag: 10 }),
          tur: tur + 0.5,
          buttons: ([ 'dirL', 'dirR', 'dirU', 'dirD', 'turL1', 'turL2', 'turR1', 'turR2', 'mod0', 'act0', 'act1', 'act2', 'act3', 'act4', 'act5', 'act6' ] as const)[cl.toObj](v => [ v, false ]),
          shootMs: null,
          bulletRearmMs: 0
        });
        
        if (this.state.players.total === this.state.players.required) this.state.players.fulfilledMs = evt.ms;
        
      }
      
      if (evt.op === 'player.cancel') {
        
        this.state.players.total--;
        this.state.players.fulfilledMs = null;
        
        delete entities[`${Player.clsName}/${evt.session.id}`];
        
      }
      
      return entities;
      
    }
    
    renderClip(flow: Flow, draw: Draw) { draw.circle({ pos: new Pt(), r: 2 }); }
    
    getRenderOps(flow: Flow, draw: Draw) {
      
      return [ { z: 1, fn: () => {
        
        const { players } = this.state;
        const ms = players.fulfilledMs
          ? Math.max(0, (players.fulfilledMs + players.delayLaunchMs) - flow.ms)
          : null;
          
        draw.text({
          x: 0, y: ms ? -0.5 : 0, tur: 0,
          text: `${players.total} / ${players.required}`,
          fontSize: 0.75,
          align: '=',
          fill: '#f55'
        });
        if (ms) draw.text({
          x: 0, y: 0.5, tur: 0,
          text: Math.round(ms).toString(10),
          fontSize: 0.75,
          align: '=',
          fill: '#f55'
        });
        
      }}];
      
    }
    
  };
  class Plunge extends Stage {
    
    static readonly clsName: string = 'Plunge';
    
    static spinTurVel = 0.2;
    
    protected state: Stage['state'] & {
      level: number,
      spinMs: number,
      step: { ms: number, term: 'wait' | 'spin' | 'open' | 'shut' }
    };
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, level: number, players: Obj<Player>, airlockPos: Pt, airlockTur: number }) => {
      
      const { flow, rng, level, players, airlockPos, airlockTur } = inp;
      
      const airlockRadius = 15;
      const terrain: Physical[] = Stage.airlock({ flow, num: 0, pos: airlockPos, tur: airlockTur });
      
      const spinMs = 1000 + rng.nextFlt() * 3000;
      const tur = airlockTur + Plunge.spinTurVel * (spinMs * 0.001);
      const gateHead0 = airlockPos.add(Pt.polar({ tur: tur + (1 / 5) * -0.5, mag: airlockRadius }));
      const gateHead1 = airlockPos.add(Pt.polar({ tur: tur + (1 / 5) * +0.5, mag: airlockRadius }));
      
      terrain.push(Obstacle.fromInitialState({
        flow,
        bound: new CircleBound({ r: 3 }),
        pos: gateHead0,
        tur: 0
      }));
      terrain.push(Obstacle.fromInitialState({
        flow,
        bound: new CircleBound({ r: 3 }),
        pos: gateHead1,
        tur: 0
      }));
      
      const len = debuggg ? 10 : (20 + rng.nextFlt() * 50);
      const gateTail0 = gateHead0.add(Pt.polar({ tur, mag: len }));
      const gateTail1 = gateHead1.add(Pt.polar({ tur, mag: len }));
      terrain.push(Stage.wall({ flow, w: 3, pt0: gateHead0, pt1: gateTail0 }));
      terrain.push(Stage.wall({ flow, w: 3, pt0: gateHead1, pt1: gateTail1 }));
      
      terrain.push(...(2 + level * 2)[cl.toArr](n => {
        
        return Zombie.fromInitialState({
          flow,
          rng,
          num: n,
          pos: Pt.mid([ gateHead0, gateHead1 ]).add(Pt.polar({ tur, mag: (0.2 + rng.nextFlt() * 0.6) * len })),
          tur: rng.nextFlt()
        });
        
      }));
      
      const airlock1 = (() => {
        
        const airlockApothem = airlockRadius * Math.cos(Math.PI / 5);
        const geom = Stage.airlock({
          flow,
          num: 1,
          pos: airlockPos.add(Pt.polar({ tur, mag: airlockApothem * 2 + len })),
          tur: tur + 0.5
        });
        
        return geom.slice(1); // Remove the 1st wall
        
      })();
      terrain.push(...airlock1);
      
      return new Plunge({
        ms: flow.ms,
        level,
        spinMs,
        step: { ms: flow.ms, term: 'wait' },
        entities: {
          
          ...players,
          ...terrain[cl.toObj](obs => [ obs.getId(), obs ])
          
        }
      });
      
    };
    
    constructor(state: Plunge['state']) {
      super(state);
      this.state = state;
    }
    
    getRelations(flow: Flow, lastRels: null | Play.Rel[]) {
      
      const r = super.getRelations(flow, lastRels);
      
      const { state } = this;
      const { step } = state;
      if (step.term === 'wait')
        r.rels.push({ type: 'plungeSpin', ms: step.ms + 1000 * 3 });
      
      if (step.term === 'spin')
        r.rels.push({ type: 'plungeOpen', ms: step.ms + state.spinMs });
      
      if (step.term === 'open') {
        
        // const { player = [] } = r.relGroups;
        
      }
      
      return r;
      
    }
    
    dispatchAdvanceRelations(world: World, flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.Rel): void {
      
      super.dispatchAdvanceRelations(world, flow, entities, rng, rel);
      
      if (rel.type === 'plungeSpin') {
        
        const airlock0 = entities[cl.toArr](ent => {
          if (!cl.inCls(ent, Obstacle))                                 return cl.skip;
          if (!ent.getId()[cl.hasHead](`${Obstacle.clsName}/airlock0`)) return cl.skip;
          return ent;
        });
        const mid = Pt.mid(airlock0.map(obs => obs.getTransform(flow).pos));
        const r = airlock0[0].getTransform(flow).pos.sub(mid).len();
        
        for (const obs of airlock0) {
          
          obs.reanchor<Obstacle['state']>(flow, state => {
            
            const turVel = Plunge.spinTurVel;
            const initTur = mid.getTur(state.pos);
            state.forces = [
              { ms: flow.ms, durMs: this.state.spinMs, type: 'arc', r, initTur, vel: turVel },
              { ms: flow.ms, durMs: this.state.spinMs, type: 'turVel', amt: turVel }
            ];
            
          });
          
        }
        
        this.state.step = { ms: flow.ms, term: 'spin' };
        
      }
      
      if (rel.type === 'plungeOpen') {
        delete entities[`${Obstacle.clsName}/airlock0/0`];
        this.state.step = { ms: flow.ms, term: 'open' };
      }
      
    }
    
  };
  
  class Staged extends Entity {
    
    static readonly clsName: string = 'Staged';
    
    protected state: Entity['state'] & { id: string };
    constructor(state: Staged['state']) { super(state); this.state = state; }
    
    getId() { return this.state.id; }
    
  };
  
  abstract class Physical extends Staged {
    
    static readonly clsName: string = 'Physical';
    
    protected state: Staged['state'] & {
      anchorMs: number,
      pos: Pt,
      tur: number
    };
    
    constructor(state: Physical['state']) {
      super(state);
      this.state = state;
    }
    
    getForces(flow: Flow) { return flow.cached(`${this.state.id}/forces`, () => this.getForces0(flow)); }
    getForces0(flow: Flow): Play.Force[] { return []; }
    
    protected calcForce(flow: Flow, force: Play.Force): { x: number, y: number, tur: number } {
      
      const durSc = Math.min(flow.ms - force.ms, force.durMs ?? Infinity) * 0.001;
      
      if (durSc <= 0) return { x: 0, y: 0, tur: 0 };
      
      if (force.type === 'vel') return { x: force.x * durSc, y: force.y * durSc, tur: 0 };
      
      if (force.type === 'acl') {
        
        const acl = 0.5 * durSc * durSc;
        return { x: force.x * acl, y: force.y * acl, tur: 0 };
        
      }
      
      if (force.type === 'arc') {
        
        const { initTur, r, vel } = force;
        const { x, y } = Pt.add([
          Pt.polar({ tur: initTur + vel * durSc, mag: r }), // Circular motion around the origin
          Pt.polar({ tur: initTur + 0.5, mag: r })          // Constant offset by the circle radius so at t=0 the force is { x: 0, y: 0
        ]);
        return { x, y, tur: 0 };
        
      }
      
      if (force.type === 'turVel') return { x: 0, y: 0, tur: force.amt * durSc };
      
      if (force.type === 'turAcl') {
        
        const preFlatSc = Math.min(durSc, force.flatSc);
        const pstFlatSc = Math.max(0, durSc - force.flatSc);
        
        return { x: 0, y: 0, tur: 0
          + (force.amt * 0.5 * preFlatSc * preFlatSc)
          + (force.amt * force.flatSc * pstFlatSc)
        };
        
      }
      
      throw Error('ow')[cl.mod]({ force });
      
    }
    
    abstract getBound(flow: Flow): Bound;
    
    canCollide(phys: Physical) { return true; }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {}
    
    getWeight(flow: Flow) { return 1; }
    
    getRelationGroups(flow: Flow): Play.RelationGroup[] { return [ 'physics' ]; }
    
    getTransform(flow: Flow) { return flow.cached(`${this.state.id}/tfm`, () => this.getTransform0(flow)); }
    getTransform0(flow: Flow) {
      
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
          const f = this.calcForce(flow.jumpTo(anchorMs), force);
          pos = pos.sub(f);
          tur -= f.tur;
        }
        
      }
      
      return { pos, tur };
      
    }
    
    reanchor<S extends Physical['state']>(flow: Flow, fn: (state: S) => void = () => {}) {
      
      // TODO: how does this (and how ought it) interact with the Flow cache?
      const { pos, tur } = this.getTransform(flow);
      this.state.anchorMs = flow.ms;
      this.state.pos = pos;
      this.state.tur = tur;
      
      flow.cacheInvalidate(`${this.state.id}/tfm`);
      
      fn(this.state as S);
      
    }
    
    getColour(flow: Flow): `#${string}` { return '#f00'; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        this.getBound(flow).render(tfm, draw, { fill: this.getColour(flow) });
        draw.line({
          pt0: tfm.pos,
          pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 100 })),
          line: this.getColour(flow)
        });
        
      }} ];
      
    }
    
  };
  
  class Obstacle extends Physical {
    
    static readonly clsName: string = 'Obstacle';
    
    protected state: Physical['state'] & {
      colour: `#${string}`,
      bound: Bound,
      tur: number,
      forces: Play.Force[]
    };
    
    static fromInitialState = (inp: { flow: Flow, id?: null | string, bound: Bound, pos: Pt, tur: number, forces?: Play.Force[], colour?: `#${string}` }) => {
      
      const { flow, id = null, bound, pos, tur, forces = [], colour = '#000' } = inp;
      
      return new Obstacle({
        ms: flow.ms,
        id: id ?? `${Obstacle.clsName}/wall/${(pos.x * 0.99 + pos.y + pos.x * pos.y).toString(36)}`,
        anchorMs: flow.ms,
        pos,
        tur,
        bound,
        forces,
        colour
      });
      
    }
    
    constructor(state: Obstacle['state']) {
      super(state);
      this.state = state;
    }
    
    encode() { return this.state; }
    
    canCollide(phys: Physical) { return !cl.isCls(phys, Obstacle); }
    
    getForces0() { return this.state.forces; }
    
    getWeight() { return Infinity; }
    
    getBound() { return this.state.bound; }
    
    getColour(): `#${string}` { return this.state.colour; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        const { bound } = this.state;
        bound.render(tfm, draw, { fill: this.getColour() });
        
      }}];
      
      
    }
    
  };
  
  abstract class Humanoid extends Physical {
    
    static readonly clsName: string = 'Humanoid';
    
    static walkTurnForces = (inp: { anchor: { ms: number, tfm: { pos: Pt, tur: number } }, walkVel: Pt, facing: 'fwd' | 'bwd', turVelSigned: number }): Play.Force[] => {
      
      // Note that `inp.facing` is needed to control whether the turning force faces in the arc
      // direction or opposite
      
      const forces: Play.Force[] = [];
      
      const { anchor, walkVel, turVelSigned, facing } = inp;
      
      const walkVelLen = walkVel.len();
      if (walkVelLen) {
        
        if (turVelSigned) {
          
          const turVelMag = Math.abs(turVelSigned);
          const turVelSgn = Math.sign(turVelSigned);
          
          const secsPerTurn = 1 / turVelMag;
          const circum = secsPerTurn * walkVelLen;
          const r = circum / (2 * Math.PI);
          const initTur = anchor.tfm.tur - turVelSgn * 0.25 + { fwd: 0, bwd: 0.5 }[facing];
          
          // TODO: only correct for motion along the facing axis (not strafing)
          forces.push({ ms: anchor.ms, durMs: null, type: 'arc', r, initTur, vel: turVelSigned }); // The velocity direction rotates at the same rate as the heading
          
        } else {
          
          forces.push({ ms: anchor.ms, durMs: null, type: 'vel', ...walkVel })
          
        }
        
      }
      
      if (turVelSigned) forces.push({ ms: anchor.ms, durMs: null, type: 'turVel', amt: turVelSigned });
      
      return forces;
      
    };
    
    getBaseStats() { return { posVel: 4, turVel: 0.3 }; }
    
  };
  
  class Player extends Humanoid {
    
    static readonly clsName: string = 'Player';
    
    static bound = new CircleBound({ r: 0.3 });
    
    protected state: Physical['state'] & {
      name: string,
      buttons: { [K in Play.Button]: boolean },
      shootMs: null | number,
      bulletRearmMs: number
    };
    constructor(state: Player['state']) {
      super(state);
      this.state = state;
    }
    
    getBaseStats() { return {
      ...super.getBaseStats(),
      posVel: 4,
      turVel: 0.3,
      visionSweep: 0.1,
      visionRange: 20
    }; }
    
    getForces0(flow: Flow) {
      
      const forces: Play.Force[] = [];
      const { buttons } = this.state;
      
      // Movement forces
      (() => {
        
        // Aiming prevents moving or separate turning
        const aimTur = +buttons.turR2 - +buttons.turL2;
        if (aimTur) {
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'turAcl', amt: aimTur * 0.06, flatSc: 2 });
          return;
        }
        
        const turPol = +buttons.turR1 - +buttons.turL1;
        
        const { posVel: basePosSpeed, turVel: baseTurSpeed } = this.getBaseStats();
        const posVel = basePosSpeed * (1 * (buttons.mod0 ? 2.00 : 1) * (buttons.act0 ? 0.8 : 1.0)); // Faster when sprinting, slower when acting
        const turVel = baseTurSpeed * (1 * (buttons.mod0 ? 0.75 : 1) * (buttons.act0 ? 0.2 : 1.0)); // Slower when sprinting, slower when acting
        
        // Movement penalties; strafing is slower; backwards is slowest
        const walkVelMult = false                                ? 1
          : this.state.buttons.dirD                              ? 0.3
          : (this.state.buttons.dirR || this.state.buttons.dirL) ? 0.55
          :                                                        1;
        
        // Direction of movement based on facing direction and buttons
        const walkPol = +this.state.buttons.dirU - +this.state.buttons.dirD; // "walk"
        const strfPol = +this.state.buttons.dirR - +this.state.buttons.dirL; // "strafe"
        const walkVel = new Pt({ x: walkPol, y: strfPol })
          .norm()                       // fixed-length
          .mult(posVel * walkVelMult) // apply walk vel mult
          .addTur(this.state.tur);      // Align with rotation
        
        forces.push(...Humanoid.walkTurnForces({
          anchor: {
            ms: this.state.anchorMs,
            tfm: { pos: this.state.pos, tur: this.state.tur }
          },
          walkVel,
          facing: (walkPol >= 0) ? 'fwd' : 'bwd',
          turVelSigned: turVel * turPol
        }));
        
      })();
      
      return forces;
      
    }
    
    getBound() { return Player.bound; }
    
    getRelationGroups(flow: Flow): Play.RelationGroup[] {
      return [ ...super.getRelationGroups(flow), 'player' ];
    }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      
      if (this.state.shootMs !== null) {
        
        const msPerBullet = 150;
        const firstBulletMs = Math.max(this.state.shootMs, this.state.bulletRearmMs);
        for (let ms = firstBulletMs; ms <= flow.ms; ms += msPerBullet)
          rels.push({ type: 'ent', entId: this.state.id, ms, inp: { type: 'bullet' }});
        
      }
      
      return rels;
      
    }
    
    advanceButton(flow: Flow, rng: Rng, button: Play.Button, act: boolean) {
      
      this.reanchor<Player['state']>(flow, state => {
        
        state.buttons[button] = act;
        if (button === 'act0') this.state.shootMs = act ? flow.ms : null;
        
      });
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      
      if (rel.type === 'bullet') {
        
        const msPerBullet = 150;
        
        const bulletId = `${Bullet.clsName}/${rng.nextFlt().toString(36).slice(2)}`
        const tfm = this.getTransform(flow.jumpTo(rel.ms));
        
        const tur = tfm.tur + 0.005 - 0.01 * rng.nextFlt();
        entities[bulletId] = new Bullet({
          id: bulletId,
          ms: rel.ms,
          anchorMs: rel.ms,
          pos: tfm.pos.add(Pt.polar({ tur, mag: Player.bound.boundingRadius() + Bullet.bound.boundingRadius() + 0.05 })),
          tur,
          vel: 30
        });
        
        this.state.bulletRearmMs = Math.max(this.state.bulletRearmMs, rel.ms + msPerBullet);
        
      }
      
    }
    
    getColour(flow: Flow): `#${string}` { return '#840'; }
    
    renderClip(flow: Flow, draw: Draw) {
      const { visionSweep, visionRange } = this.getBaseStats();
      const { pos, tur } = this.getTransform(flow);
      draw.cone({ pos, tur, sweep: visionSweep, r: visionRange });
      draw.circle({ pos, r: 2 });
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        const colour = this.getColour(flow);
        this.getBound().render(tfm, draw, { fill: colour });
        
        draw.line({
          pt0: tfm.pos,
          pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 3 })),
          line: colour,
          lineW: 0.03
        });
        
        const textPos = tfm.pos.add(Pt.polar({ tur: tfm.tur + 0.5, mag: 1 }));
        draw.text({
          text: this.state.name,
          x: textPos.x,
          y: textPos.y,
          tur: tfm.tur + 0.25,
          fontSize: 0.6,
          fill: `${colour}8`
        });
        
      }}];
      
    }
    
  };
  
  class Zombie extends Humanoid {
    
    static readonly clsName: string = 'Zombie';
    
    static bound = new CircleBound({ r: 0.5 });
    static planDelayMs = 1000 * 5;
    
    protected state: Physical['state'] & {
      plan: { ms: number } & [
        { type: 'bored',       dir: 'lh' | 'rh' },
        { type: 'destination', pos: Pt },
        { type: 'player',      pos: Pt, player: Player }
      ][number],
      nextPlanMs: number
    };
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, num: number, pos: Pt, tur: number }) => {
      
      const { flow, rng, num, pos, tur } = inp;
      return new Zombie({
        ms: flow.ms,
        id: `${Zombie.clsName}/zombie/${num}`,
        anchorMs: flow.ms,
        pos,
        tur,
        plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! },
        nextPlanMs: flow.ms + 1000 * 5
      });
      
    };
    
    constructor(state: Zombie['state']) {
      super(state);
      this.state = state;
    }
    
    getBound() { return Zombie.bound; }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      
      for (let ms = this.state.nextPlanMs; ms <= flow.ms; ms += Zombie.planDelayMs)
        rels.push({ type: 'ent', entId: this.state.id, ms, inp: { type: 'zombiePlan' } });
      
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      
      if (rel.type === 'zombiePlan') {
        
        const players = entities[cl.toArr](v => cl.isCls(v, Player) ? v : cl.skip);
        const player = rng.elem(players);
        
        this.reanchor<Zombie['state']>(flow, state => {
          
          state.plan = !player
            ? { ms: rel.ms, type: 'bored',  dir: rng.elem([ 'lh', 'rh' ] as const)! }
            : { ms: rel.ms, type: 'player', pos: player.getTransform(flow).pos.add(Pt.polar({ tur: rng.nextFlt(), mag: 2 })), player };
          
          state.nextPlanMs = Math.max(state.nextPlanMs, rel.ms + Zombie.planDelayMs);
          
          if (state.plan.type === 'player')
            state.tur = state.pos.getTur(state.plan.pos);
          
        });
        
      }
      
    }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      
      if (cl.isCls(inp.phys, Bullet)) delete inp.entities[this.state.id];
      
    }
    
    getForces0(flow: Flow): Play.Force[] {
      
      const forces = super.getForces0(flow);
      
      const { posVel, turVel } = this.getBaseStats();
      const { plan } = this.state;
      
      if (plan.type === 'bored') {
        
        forces.push(...Humanoid.walkTurnForces({
          anchor: {
            ms: this.state.anchorMs,
            tfm: { pos: this.state.pos, tur: this.state.tur }
          },
          walkVel: Pt.polar({ tur: this.state.tur, mag: posVel }),
          facing: 'fwd',
          turVelSigned: turVel * { lh: -1, rh: +1 }[plan.dir]
        }));
        
      }
      
      if (plan.type === 'player') {
        
        const walkVel = plan.pos
          .sub(this.state.pos)
          .norm()
          .mult(posVel);
        forces.push({ ms: plan.ms, type: 'vel', durMs: null, ...walkVel.encode() });
        
      }
      
      return forces;
      
    }
    
    getColour(flow: Flow): `#${string}` { return '#4a0'; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        const colour = this.getColour(flow);
        this.getBound().render(tfm, draw, { fill: colour });
        
        draw.line({
          pt0: tfm.pos,
          pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.65 })),
          line: colour,
          lineW: 0.2
        });
        
        const textPos = tfm.pos.add(Pt.polar({ tur: tfm.tur + 0.5, mag: 1 }));
        draw.text({
          text: 'rrghhhh',
          x: textPos.x,
          y: textPos.y,
          tur: tfm.tur + 0.25,
          fontSize: 0.6,
          fill: `${colour}8`
        });
        
      }}];
      
    }
    
  };
  
  class Bullet extends Physical {
    
    static readonly clsName: string = 'Bullet';
    
    static bound = new RectBound({ w: 1.5, h: 0.1 });
    
    protected state: Physical['state'] & {
      vel: number
    };
    constructor(state: Bullet['state']) {
      super(state);
      this.state = state;
    }
    
    canCollide(phys: Physical) { return !cl.isCls(phys, Bullet); }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      
      delete inp.entities[this.state.id];
      
    }
    
    getBound(flow: Flow) { return Bullet.bound; }
    
    getColour(flow: Flow): `#${string}` { return '#a00'; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        this.getBound(flow).render(tfm, draw, { fill: this.getColour(flow) });
        
      }}];
      
    }
    
    getForces0(flow: Flow): Play.Force[] {
      
      const dir = Pt.polar({ tur: this.state.tur, mag: this.state.vel });
      return [
        { ms: this.state.anchorMs, type: 'vel', durMs: null, ...dir.encode() }
      ];
      
    }
    
  };
  
  const classes = {
    
    Pt,
    CircleBound,
    RectBound,
    PolygonBound,
    
    World,
    WaitingRoom,
    Plunge,
    
    Obstacle,
    Player,
    Zombie,
    
    Bullet
    
  } satisfies WireRegistry;
  for (const k in classes) if (k !== classes[k].clsName) throw Error('clsName missing')[cl.mod]({ k })
  
  return classes;
  
})();

export type PlayInp = {
  observe?: {
    tick?: (inp: {
      advanceMs:   number,
      subticks:    number;
      relChecks:   number,
      elapsedPms:  number,
      numEvents:   number
    }) => void
  }
};
export default (inp: PlayInp) => {
  
  const pendingEvents: Play.Event[] = [];
  
  const { World, WaitingRoom } = registry;
  const playTimeStep = new TimeStep<Play.ClsRegistry, Play.State, Play.Event, Play.Rel>({
    
    seed: 'gershy misc zombies fun times',
    registry,
    msPerTick: 9, // 60fpsc is 16.666mspf - 9mspt is just less than 2 ticks per 60fpsc frame
    minMsPerTick: 1.5,
    
    maxSnapshotEvents: 100,
    maxSnapshotDurMs: 400,
    maxSnapshots: 10,
    
    state: { world: new World({
      name: 'zombies',
      stage: WaitingRoom.fromInitialState({
        flow: new Flow(0),
        players: { required: 3 }
      })
    }) },
    advance: (state, evt, rng) => state.world.dispatchAdvanceEvent(rng, evt),
    relationCfg: {
      quality: 4,
      find: (flow, state, lastRels) => state.world.getRelations(new Flow(flow.ms), lastRels)
    }
    
  });
  
  let patienceMs = 20; // Intentionally lag by this amount to avoid constantly stepping up past most recent events and constantly rolling back
  let offsetMs = 0;    // Fine-tuning knob for utc millis - e.g. to precisely align client+server
  const playTicker = ticker(60, ({ ms }) => {
    
    const events = [ ...pendingEvents ].sort((evt0, evt1) => evt0.ms - evt1.ms);
    pendingEvents.length = 0;
    
    for (const event of events) {
      const processed = playTimeStep.processEvent(event);
      inp.observe?.tick?.(processed);
    }
    
    playTimeStep.tickUpToMs(Math.max(0, (ms + offsetMs) - patienceMs));
    
  });
  
  return {
    registry,
    timeStep: playTimeStep,
    ticker: playTicker,
    getPendingEvents: ()                   => pendingEvents,
    setPendingEvents: (evts: Play.Event[]) => { pendingEvents.length = 0; pendingEvents.push(...evts); },
    setPatienceMs:    (pMs: number)        => patienceMs = pMs,
    setOffsetMs:      (oMs: number)        => offsetMs = oMs,
    getOffsetMs:      ()                   => offsetMs,
    addEvent:         (event: Play.Event)  => pendingEvents.push(event),
    replaceEvent:     (old: Play.Event, next: null | Play.Event) => {
      
      // Events not yet processed by the ticker aren't in the timestep's history yet
      const ind = pendingEvents.indexOf(old);
      if (ind === -1)    return playTimeStep.replaceEvent(old, next);
      if (next === null) return void pendingEvents.splice(ind, 1);
      pendingEvents[ind] = next;
      
    }
  };
  
};