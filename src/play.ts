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
    { type: 'plungeClear',        ms: number },
    { type: 'plungeNext',         ms: number },
    { type: 'plungeSpawn',        ms: number },
    
    { type: 'sat', ents: [ string, string ], pen: number, axis: { x: number, y: number } },
    
    { type: 'ent', entId: string, ms: number, inp: { type: string } & Obj<Json> }
    
  ][number];
  
  // Subset of `Rel` which are single-entity-specific - generated and advanced by the same entity
  export type EntityRel = Rel & { type: 'ent', inp: [
    { type: 'shoot' },
    { type: 'reloadDone' },
    { type: 'expire' },
    { type: 'spit' },
    { type: 'land' },
    { type: 'unslow' },
    { type: 'explode' },
    { type: 'zombiePlan' },
    { type: 'revive' },
    { type: 'aimStop' }
  ][number] };
  
  export type EntityRelInp = EntityRel['inp'] & { ms: number };
  
  export type Button = never
    | `dir${'L' | 'R' | 'U' | 'D'}`
    | `tur${'L' | 'R'}${'1' | '2'}`
    | `mod${0}`
    | `act${0 | 1 | 2 | 3 | 4 | 5 | 6}`
    | 'mapFixed'; // Set while the player views a fixed map; movement is then screen-relative
  
  export type Buttons = { [K in Button]: boolean };
  
  export type ClientEvent = { ms: number } & [
    { ms: number, op: 'player.launch',  name: string                 },
    { ms: number, op: 'player.cancel'                                },
    { ms: number, op: 'player.key',     btn: `${'+' | '-'}${Button}`, chat?: string, aim?: number | null }
  ][number];
  
  export type Event = ClientEvent & { session: { id: string } };
  export type AckEvent = Event & { ack?: { id: string, clientMs: number, serverMs: number, resolvedMs: number } };
  
  export type RenderOp = { z: number, fn: () => void };
  
  export type ClsRegistry = typeof registry;
  export type Registry = { [K in keyof ClsRegistry]: InstanceType<ClsRegistry[K]> };
  
  export type Tfm = { pos: Pt, tur: number };
  
  export type StatRow = { name: string, damage: number, kills: number, friendly: number, points: number, revives: number, trophies: number };
  
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
  
  const debuggg = false;
  
  // Guns; `fireMs` is the minimum delay between shots, `perRound` guns reload one round at a time
  const gunSpecs = {
    pistol:  { auto: false, clip: 15, reserve: 150, damage: 1, vel: 30, pellets: 1, spread: 0.004, fireMs: 200, reloadMs: 900,  perRound: false, len: 0.55, colour: '#333' },
    rifle:   { auto: true,  clip: 30, reserve: 120, damage: 2, vel: 45, pellets: 1, spread: 0.007, fireMs: 100, reloadMs: 2200, perRound: false, len: 1.1,  colour: '#241' },
    shotgun: { auto: false, clip: 6,  reserve: 36,  damage: 1, vel: 28, pellets: 7, spread: 0.035, fireMs: 800, reloadMs: 650,  perRound: true,  len: 0.9,  colour: '#531' }
  } as const;
  type GunKind = keyof typeof gunSpecs;
  
  // Player appearances; one is picked at random when a player spawns
  const playerLooks = [
    { body: '#840', accent: '#fc0', mark: 'dot'    },
    { body: '#357', accent: '#9cf', mark: 'stripe' },
    { body: '#a36', accent: '#fdf', mark: 'cross'  },
    { body: '#273', accent: '#bfa', mark: 'tri'    },
    { body: '#c60', accent: '#ff6', mark: 'ring'   },
    { body: '#546', accent: '#d9f', mark: 'half'   },
    { body: '#066', accent: '#6ff', mark: 'dot'    },
    { body: '#a22', accent: '#fcc', mark: 'stripe' },
    { body: '#660', accent: '#ee8', mark: 'cross'  },
    { body: '#444', accent: '#f4f', mark: 'tri'    }
  ] as const;
  
  // Level palettes; `pattern` marks the floor texture drawn in `mark`
  const themes = [
    { floor: '#94ae82', wall: '#4c3626', debris: '#3e3328', pattern: 'speckle', mark: '#829b72' }, // forest
    { floor: '#c8c8cc', wall: '#6e7a86', debris: '#59616b', pattern: 'hatch',   mark: '#a0a0a8' }, // grip-metal corridor
    { floor: '#d9c38a', wall: '#9a6b3c', debris: '#7a5530', pattern: 'speckle', mark: '#c2ab70' }, // desert
    { floor: '#938d9b', wall: '#2f2a33', debris: '#443f4a', pattern: 'speckle', mark: '#817a89' }, // cave
    { floor: '#dfeff7', wall: '#6f98b8', debris: '#5b84a3', pattern: 'hatch',   mark: '#c5dbe8' }  // ice
  ] as const;
  
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
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp, world: World) {}
    
    advanceButton(flow: Flow, entities: Obj<Entity>, rng: Rng, btn: Play.Button, act: boolean, world: World) {}
    
    renderClip(flow: Flow, draw: Draw) {}
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      return [ { z: 1, fn: () => {
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
    
    // Chosen so the outer wall edge is tangent to the radius-15 area clip circle
    static airlockWallW = 5.7;
    
    static wall = (inp: { flow: Flow, id?: string, w: number, pt0: Pt, pt1: Pt, colour?: `#${string}` }) => {
      
      const { flow, id = null, w, pt0, pt1, colour } = inp;
      const mid = pt0.add(pt1).mult(0.5);
      
      return Obstacle.fromInitialState({
        flow,
        id,
        bound: new RectBound({ w: pt1.sub(pt0).len(), h: w }),
        pos: mid,
        tur: pt0.getTur(pt1),
        colour
      });
      
    };
    
    static airlock = (inp: { flow: Flow, num: number, r?: number, pos: Pt, tur: number, wallColour?: `#${string}` }) => (5)[cl.toArr](n => {
      
      const { flow, num, r = 15, pos, tur, wallColour = '#000' } = inp;
      return Stage.wall({
        flow,
        id: `${Obstacle.clsName}/airlock${num}/${n}`,
        w: Stage.airlockWallW,
        colour: n === 0 ? '#25c' : wallColour, // Wall 0 is the door
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
        
        // Non-solid entities (e.g. pools) only report the overlap; they never push anyone
        if (ent0.isSolid() && ent1.isSolid()) {
          ent0.reanchor(flow, state => state.pos = state.pos.add(axis.mult(-1 * pen * amt0)));
          ent1.reanchor(flow, state => state.pos = state.pos.add(axis.mult(+1 * pen * amt1)));
        }
        
        ent0.advanceCollide({ world, flow, entities, rng, phys: ent1 });
        ent1.advanceCollide({ world, flow, entities, rng, phys: ent0 });
        return;
        
      }
      
      if (rel.type === 'ent') {
        
        const ent = entities[cl.at](rel.entId, null);
        if (!ent) return;
        
        ent.advanceRelation(flow, entities, rng, { ms: rel.ms, ...(rel as Play.EntityRel).inp }, world);
        
      }
      
    }
    
    dispatchAdvanceEvent(flow: Flow, world: World, rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      const entities = this.getEntities(flow);
      
      if (evt.op === 'timeStep.rel')
        for (const rel of evt.rels)
          this.dispatchAdvanceRelations(world, flow, entities, rng, rel);
      
      if (evt.op === 'player.key') {
        
        const ent = entities[cl.at](`${Player.clsName}/${evt.session.id}`, null);
        if (ent instanceof Physical && typeof evt.chat === 'string') {
          const text = evt.chat.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160);
          const id = `Cue/chat/${ent.getId()}`;
          const prev = entities[id];
          if (text && (!(prev instanceof Cue) || flow.ms - prev.encode().ms >= 500))
            entities[id] = new Cue({ ms: flow.ms, id, kind: 'chat', pos: ent.getTransform(flow).pos, tur: 0, owner: ent.getId(), text });
          return entities;
        }
        if (cl.isCls(ent, Player) && (evt.aim === null || (typeof evt.aim === 'number' && Number.isFinite(evt.aim)))) {
          ent.setAim(flow, evt.aim);
          return entities;
        }
        if (ent) ent.advanceButton(flow, entities, rng, evt.btn.slice(1) as Play.Button, evt.btn[0] === '+', world);
        
      }
      
      return entities;
      
    }
    
    // Vision is only relevant within this area; unbounded by default
    renderAreaClip(flow: Flow, draw: Draw) { draw.circle({ pos: new Pt(), r: 1e6 }); }
    
    // Per-player results to show on screen, or null when there's nothing to show
    getStatsView(flow: Flow): null | Play.StatRow[] { return null; }
    
    renderGround(flow: Flow, draw: Draw, centre: Pt) { draw.circle({ pos: centre, r: 1000, fill: '#ccc' }); }
    
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
        cornersRh: (3)[cl.toArr](v => Pt.polar({ tur: v / 3, mag: 6 }))
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
            ...Zombie.randomBuild(rng),
            flankTur: rng.nextFlt(),
            plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! }
          }))
          
        ];
        
        for (const ent of addEnts) entities[ent.getId()] = ent;
        
        world.setStage(Plunge.fromInitialState({
          flow,
          rng,
          level: 0,
          carried: carryOver(entities),
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
        spawnPlayer(flow, rng, entities, {
          id: `${Player.clsName}/${evt.session.id}`,
          name: evt.name,
          pos: Pt.polar({ tur, mag: 10 }),
          tur: tur + 0.5,
          buttons: ([ 'dirL', 'dirR', 'dirU', 'dirD', 'turL1', 'turL2', 'turR1', 'turR2', 'mod0', 'act0', 'act1', 'act2', 'act3', 'act4', 'act5', 'act6', 'mapFixed' ] as const)[cl.toObj](v => [ v, false ])
        });
        
        if (this.state.players.total === this.state.players.required) this.state.players.fulfilledMs = evt.ms;
        
      }
      
      if (evt.op === 'player.cancel') {
        
        this.state.players.total--;
        this.state.players.fulfilledMs = null;
        
        const leaving = entities[cl.at](`${Player.clsName}/${evt.session.id}`, null);
        if (leaving && cl.isCls(leaving, Player))
          for (const { id } of leaving.getGuns()) delete entities[id];
        
        delete entities[`${Player.clsName}/${evt.session.id}`];
        
      }
      
      return entities;
      
    }
    
    renderAreaClip(flow: Flow, draw: Draw) { draw.circle({ pos: new Pt(), r: 15 }); }
    
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
    static clearDelayMs = 1000 * 10;
    static corridorFlare = 8; // How far the corridor's middle bulges outward on each side
    
    protected state: Stage['state'] & {
      level: number,
      spinMs: number,
      exit: { pos: Pt, tur: number }, // Center of the opposing airlock; `tur` points into the airlock from the corridor
      entry: Pt,
      stats: Obj<Play.StatRow>,
      theme: number, // Index into `themes`
      nextSpawnMs: number,
      spawnNum: number,
      step: { ms: number, term: 'wait' | 'spin' | 'open' | 'clear' | 'shut' }
    };
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, level: number, carried: Obj<Entity>, airlockPos: Pt, airlockTur: number }) => {
      
      const { flow, rng, level, carried, airlockPos, airlockTur } = inp;
      
      const airlockRadius = 15;
      const themeInd = Math.floor(rng.nextFlt() * themes.length);
      const theme = themes[themeInd];
      const terrain: Physical[] = Stage.airlock({ flow, num: 0, pos: airlockPos, tur: airlockTur, wallColour: theme.wall });
      
      const spinMs = 1000 + rng.nextFlt() * 3000;
      const tur = airlockTur + Plunge.spinTurVel * (spinMs * 0.001);
      const gateHead0 = airlockPos.add(Pt.polar({ tur: tur + (1 / 5) * -0.5, mag: airlockRadius }));
      const gateHead1 = airlockPos.add(Pt.polar({ tur: tur + (1 / 5) * +0.5, mag: airlockRadius }));
      
      const len = debuggg ? 10 : (20 + rng.nextFlt() * 50);
      const airlockApothem = airlockRadius * Math.cos(Math.PI / 5);
      const exitPos = airlockPos.add(Pt.polar({ tur, mag: airlockApothem * 2 + len }));
      
      for (const side of corridorGeom(airlockPos, exitPos).sides) {
        
        for (let k = 0; k < side.length - 1; k++)
          terrain.push(Stage.wall({ flow, w: 3, pt0: side[k], pt1: side[k + 1], colour: theme.wall }));
        
        for (const joint of side) {
          terrain.push(Obstacle.fromInitialState({
            flow,
            bound: new CircleBound({ r: 1.5 }),
            pos: joint,
            tur: 0,
            colour: theme.wall
          }));
        }
        
      }
      
      // Positions spread over the whole corridor (and occasionally the exit airlock)
      const corridorMid = Pt.mid([ gateHead0, gateHead1 ]);
      const ramp = Math.min(len * 0.3, 10);
      const scatter = () => {
        
        if (rng.nextFlt() < 0.2) return exitPos.add(Pt.polar({ tur: rng.nextFlt(), mag: rng.nextFlt() * 7 }));
        
        const d = (0.03 + rng.nextFlt() * 0.94) * len;
        const edge = Math.min(1, d / ramp, (len - d) / ramp);
        const half = 6 + Plunge.corridorFlare * edge * 0.8; // Stays clear of the walls as the corridor flares
        return corridorMid
          .add(Pt.polar({ tur, mag: d }))
          .add(Pt.polar({ tur: tur + 0.25, mag: (rng.nextFlt() - 0.5) * 2 * half }));
        
      };
      
      // Debris: pillar stumps, crate pairs, fallen girders and rubble shards
      const debrisAt = (pos: Pt): Obstacle[] => {
        
        const kind = Math.floor(rng.nextFlt() * 4);
        const turn = rng.nextFlt();
        const mk = (bound: Bound, at: Pt, t: number) => Obstacle.fromInitialState({
          flow,
          id: `${Obstacle.clsName}/debris/${rng.nextFlt().toString(36).slice(2)}`,
          bound,
          pos: at,
          tur: t,
          colour: theme.debris
        });
        
        if (kind === 0) return [ mk(new CircleBound({ r: 0.7 + rng.nextFlt() * 0.7 }), pos, 0) ];
        if (kind === 1) return [ mk(new RectBound({ w: 1.4, h: 1.4 }), pos, turn), mk(new RectBound({ w: 1, h: 1 }), pos.add(Pt.polar({ tur: turn, mag: 1.1 })), turn + 0.1) ];
        if (kind === 2) return [ mk(new RectBound({ w: 3 + rng.nextFlt() * 2, h: 0.5 }), pos, turn) ];
        return [ mk(new PolygonBound({ cornersRh: (3)[cl.toArr](v => Pt.polar({ tur: turn + v / 3, mag: 1 + rng.nextFlt() * 0.8 })) }), pos, 0) ];
        
      };
      for (let n = 0; n < 4 + Math.floor(level / 2); n++) terrain.push(...debrisAt(scatter()));
      
      const numBarrels = 3 + Math.floor(level / 2);
      for (let n = 0; n < numBarrels; n++)
        terrain.push(Barrel.fromInitialState({ flow, rng, pos: scatter() }));
      
      // Medkits and trophies lie around the map
      const pickups: Pickup[] = [];
      const numMedkits = 1 + (rng.nextFlt() < 0.5 ? 1 : 0);
      for (let n = 0; n < numMedkits; n++) pickups.push(Pickup.fromInitialState({ flow, rng, kind: 'medkit', pos: scatter() }));
      for (let n = 0; n < 3; n++)          pickups.push(Pickup.fromInitialState({ flow, rng, kind: 'trophy', pos: scatter() }));
      if (rng.nextFlt() < 0.35) pickups.push(Pickup.fromInitialState({ flow, rng, kind: 'pills', pos: scatter() }));
      
      const airlock1 = (() => {
        
        const geom = Stage.airlock({ flow, num: 1, pos: exitPos, tur: tur + 0.5, wallColour: theme.wall });
        return geom.slice(1); // Remove the 1st wall
        
      })();
      terrain.push(...airlock1);
      
      // Guns lie on the floor of the starting airlock; the first level has none (pistols only)
      const kinds: GunKind[] = level === 0 ? [] : [ rng.elem([ 'pistol', 'rifle', 'shotgun' ] as const)! ];
      const guns = kinds.map((kind, n) => Gun.fromInitialState({
        flow,
        rng,
        kind,
        pos: airlockPos.add(Pt.polar({ tur: (n + rng.nextFlt() * 0.5) / kinds.length, mag: 4 + rng.nextFlt() * 2 }))
      }));
      
      // Ammo sometimes lies in the starting airlock too
      const ammo = (level >= 2 && rng.nextFlt() < 0.5)
        ? [ Ammo.fromInitialState({
          flow,
          rng,
          kind: rng.elem([ 'pistol', 'rifle', 'shotgun' ] as const)!,
          pos: airlockPos.add(Pt.polar({ tur: rng.nextFlt(), mag: 4 + rng.nextFlt() * 2 }))
        }) ]
        : [];
      
      const stats: Obj<Play.StatRow> = {};
      for (const [ id, ent ] of Object.entries(carried))
        if (ent instanceof Player) stats[id] = { name: ent.getName(), damage: 0, kills: 0, friendly: 0, points: 0, revives: 0, trophies: 0 };
      
      return new Plunge({
        ms: flow.ms,
        level,
        spinMs,
        exit: { pos: exitPos, tur: tur + 0.5 },
        entry: airlockPos,
        stats,
        theme: themeInd,
        nextSpawnMs: flow.ms,
        spawnNum: 0,
        step: { ms: flow.ms, term: 'wait' },
        entities: {
          
          ...carried,
          ...guns[cl.toObj](gun => [ gun.getId(), gun ]),
          ...ammo[cl.toObj](a => [ a.getId(), a ]),
          ...pickups[cl.toObj](p => [ p.getId(), p ]),
                   ...terrain[cl.toObj](obs => [ obs.getId(), obs ])
          
        }
      });
      
    };
    
    constructor(state: Plunge['state']) {
      super(state);
      this.state = state;
    }
    
    addStat(id: string, name: string, key: 'damage' | 'kills' | 'friendly' | 'points' | 'revives' | 'trophies', amt: number) {
      
      const row = this.state.stats[id] ??= { name, damage: 0, kills: 0, friendly: 0, points: 0, revives: 0, trophies: 0 };
      row[key] += amt;
      
      // Ranking is by points: damage and kills score, and revives score a lot
      if (key === 'damage') row.points += amt * 2;
      if (key === 'kills') row.points += 25;
      if (key === 'revives') row.points += 200;
      if (key === 'trophies') row.points += Pickup.trophyPoints * amt;
      
    }
    
    renderGround(flow: Flow, draw: Draw, centre: Pt) {
      
      const theme = themes[this.state.theme];
      draw.circle({ pos: centre, r: 1000, fill: theme.floor });
      
      // Texture is anchored to the world so it slides under the player
      const reach = 16;
      if (theme.pattern === 'hatch') {
        
        const step = 2;
        const yA = centre.y - reach;
        const yB = centre.y + reach;
        const span = Math.ceil(4 * reach / step);
        
        // Lines of constant x - y, then of constant x + y
        const kDiff = Math.floor((centre.x - centre.y - 2 * reach) / step);
        const kSum = Math.floor((centre.x + centre.y - 2 * reach) / step);
        for (let i = 0; i <= span; i++) {
          
          const cDiff = (kDiff + i) * step;
          const cSum = (kSum + i) * step;
          draw.line({ pt0: new Pt({ x: cDiff + yA, y: yA }), pt1: new Pt({ x: cDiff + yB, y: yB }), line: theme.mark, lineW: 0.07 });
          draw.line({ pt0: new Pt({ x: cSum - yA, y: yA }), pt1: new Pt({ x: cSum - yB, y: yB }), line: theme.mark, lineW: 0.07 });
          
        }
        
      } else {
        
        const cell = 3;
        const ix0 = Math.floor((centre.x - reach) / cell);
        const iy0 = Math.floor((centre.y - reach) / cell);
        const num = Math.ceil(2 * reach / cell) + 1;
        for (let ix = ix0; ix < ix0 + num; ix++) { for (let iy = iy0; iy < iy0 + num; iy++) {
          
          const hash = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663)) >>> 0;
          draw.circle({
            pos: new Pt({ x: (ix + (hash % 1000) / 1000) * cell, y: (iy + ((hash >>> 10) % 1000) / 1000) * cell }),
            r: 0.08 + ((hash >>> 20) % 100) / 100 * 0.12,
            fill: theme.mark
          });
          
        }}
        
      }
      
    }
    
    // Shown once the plunge is beaten
    getStatsView(flow: Flow) {
      
      if (this.state.step.term !== 'clear') return null;
      return Object.values(this.state.stats).sort((a, b) => b.points - a.points);
      
    }
    
    renderAreaClip(flow: Flow, draw: Draw) {
      
      const airlockRadius = 15;
      const { entry, exit, step } = this.state;
      draw.circle({ pos: entry, r: airlockRadius });
      draw.circle({ pos: exit.pos, r: airlockRadius });
      
      // The corridor only joins the airlock area once the door is open
      if (step.term !== 'open') return;
      
      const [ side0, side1 ] = corridorGeom(entry, exit.pos).sides;
      // Same winding as the circles so overlapping areas union instead of cancelling
      draw.polygon({ pts: [ side0[3], side1[3], side1[2], side1[1], side1[0], side0[0], side0[1], side0[2] ] });
      
    }
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      const airlockRadius = 15;
      const apothem = airlockRadius * Math.cos(Math.PI / 5);
      const { exit, step } = this.state;
      const clearMs = step.term === 'clear' ? Math.max(0, step.ms + Plunge.clearDelayMs - flow.ms) : null;      
      let inside = 0;
      let total = 0;
      let zombiesInside = false;
      for (const ent of Object.values(this.getEntities(flow))) {
        const alive = cl.isCls(ent, Player);
        const enemy = cl.inCls(ent, Zombie); // Includes compromised players
        if (alive || cl.isCls(ent, DownedPlayer) || cl.isCls(ent, CompromisedPlayer)) total++;
        if (!alive && !enemy) continue;
        if ((ent as Physical).getTransform(flow).pos.sub(exit.pos).len() >= apothem - Stage.airlockWallW * 0.5) continue;
        if (alive) inside++; else zombiesInside = true;
      }
      
      return [
        
        // Faint guide arrows from the entry airlock toward the exit airlock
        { z: 0, fn: () => {
          
          const { entry } = this.state;
          const dir = entry.getTur(exit.pos);
          const dist = exit.pos.sub(entry).len();
          const num = Math.max(1, Math.round(dist / 4));
          for (let i = 0; i <= num; i++) {
            
            const d = dist * (i / num);
            const mid = entry.add(Pt.polar({ tur: dir, mag: d }));
            draw.polygon({
              pts: [
                mid.add(Pt.polar({ tur: dir,        mag: 0.8  })),
                mid.add(Pt.polar({ tur: dir + 0.25, mag: 0.25 })).sub(Pt.polar({ tur: dir, mag: 0.8 })),
                mid.add(Pt.polar({ tur: dir - 0.25, mag: 0.25 })).sub(Pt.polar({ tur: dir, mag: 0.8 }))
              ],
              fill: '#0002'
            });
            
          }
          
        }},
        
        // Floor sits below all entities
        { z: 0, fn: () => {
          
          if (!inside) return;
          draw.polygon({
            pts: (5)[cl.toArr](k => exit.pos.add(Pt.polar({ tur: exit.tur + (k / 5) - 0.1, mag: airlockRadius }))),
            fill: zombiesInside ? '#fdd' : '#fff'
          });
          
        }},
        
        { z: 2, fn: () => {
          
          draw.text({
            x: exit.pos.x, y: clearMs === null ? exit.pos.y : exit.pos.y - 0.5, tur: 0,
            text: `${inside} / ${total}`,
            fontSize: 0.75,
            align: '=',
            fill: '#f55'
          });
          
          if (clearMs !== null) draw.text({
            x: exit.pos.x, y: exit.pos.y + 0.5, tur: 0,
            text: Math.round(clearMs).toString(10),
            fontSize: 0.75,
            align: '=',
            fill: '#f55'
          });
          
        }}
        
      ];
      
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
        r.rels.push({ type: 'plungeSpawn', ms: state.nextSpawnMs });
        
        // Beaten when every living player is inside the exit airlock and no enemy (including
        // compromised players) is; downed players are exempt
        const airlockApothem = 15 * Math.cos(Math.PI / 5);
        let numPlayers = 0;
        let beaten = true;
        for (const ent of Object.values(this.getEntities(flow))) {
          
          const isPlayer = cl.isCls(ent, Player);
          if (!isPlayer && !cl.inCls(ent, Zombie)) continue;
          
          const inside = (ent as Physical).getTransform(flow).pos.sub(state.exit.pos).len() < airlockApothem - Stage.airlockWallW * 0.5;
          if (isPlayer) { numPlayers++; if (!inside) { beaten = false; break; } }
          else if (inside) { beaten = false; break; }
          
        }
        
        if (beaten && numPlayers) r.rels.push({ type: 'plungeClear', ms: flow.ms });
        
      }
      
      if (step.term === 'clear')
        r.rels.push({ type: 'plungeNext', ms: step.ms + Plunge.clearDelayMs });
      
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
        this.state.nextSpawnMs = flow.ms;
      }

      if (rel.type === 'plungeSpawn' && this.state.step.term === 'open') {
        this.state.nextSpawnMs = flow.ms + 6000 / (1 + this.state.level * 0.22);
        const enemies = Object.values(entities).filter(ent => cl.inCls(ent, Zombie));
        const capacity = Math.max(0, 60 - enemies.length);
        const centre = this.state.entry.add(this.state.exit.pos.sub(this.state.entry).mult(0.35 + rng.nextFlt() * 0.4));
        for (let count = 0; count < Math.min(3, capacity); count++) {
          const pos = centre.add(Pt.polar({ tur: rng.nextFlt(), mag: 4 + rng.nextFlt() * 3 }));
          const players = Object.values(entities).filter(ent => cl.isCls(ent, Player));
          if (players.some(ent => (ent as Player).getTransform(flow).pos.sub(pos).len() < 5)) continue;
          const roll = rng.nextFlt();
          const cls = this.state.level >= 5 && roll < 0.08 ? AcidMan
            : this.state.level >= 4 && roll < 0.16 ? PregnantMan
            : this.state.level >= 3 && roll < 0.3 ? WetMan : Zombie;
          const enemy = cls.fromInitialState({ flow, rng, num: this.state.spawnNum++, pos, tur: rng.nextFlt() });
          entities[enemy.getId()] = enemy;
        }
      }
      
      if (rel.type === 'plungeClear') {
        
        // Restore the airlock's missing wall so no more enemies can enter
        const wall = Stage.airlock({ flow, num: 1, pos: this.state.exit.pos, tur: this.state.exit.tur })[0];
        entities[wall.getId()] = wall;
        this.state.step = { ms: flow.ms, term: 'clear' };
        
        // Downed players are revived inside the sealed airlock
        for (const ent of Object.values(entities))
          if (cl.isCls(ent, DownedPlayer))
            ent.revive(flow, rng, entities, this.state.exit.pos.add(Pt.polar({ tur: rng.nextFlt(), mag: rng.nextFlt() * 4 })));
        
      }
      
      if (rel.type === 'plungeNext') {
        
        // Anyone not alive by now (compromised or downed) rejoins as a living player in the airlock
        for (const ent of Object.values(entities)) {
          const spawn = () => this.state.exit.pos.add(Pt.polar({ tur: rng.nextFlt(), mag: rng.nextFlt() * 4 }));
          if (cl.isCls(ent, DownedPlayer))      ent.revive(flow, rng, entities, spawn());
          if (cl.isCls(ent, CompromisedPlayer)) ent.revive(flow, rng, entities, spawn());
        }
        const most = Math.max(0, ...Object.values(this.state.stats).map(row => row.trophies));
        for (const [ id, ent ] of Object.entries(entities))
          if (cl.isCls(ent, Player)) ent.setStar(most > 0 && this.state.stats[id]?.trophies === most);
        
        world.setStage(Plunge.fromInitialState({
          flow,
          rng,
          level: this.state.level + 1,
          carried: carryOver(entities),
          airlockPos: this.state.exit.pos,
          airlockTur: this.state.exit.tur
        }));
        
      }
      
    }
    
  };
  
  class Staged extends Entity {
    
    static readonly clsName: string = 'Staged';
    
    protected state: Entity['state'] & { id: string };
    constructor(state: Staged['state']) { super(state); this.state = state; }
    
    getId() { return this.state.id; }
    
  };
  
  class Cue extends Staged {
    static readonly clsName: string = 'Cue';
    protected state: Staged['state'] & { kind: 'spray' | 'scream' | 'ouch' | 'chat', pos: Pt, tur: number, owner: string, text: string };
    constructor(state: Cue['state']) { super(state); this.state = state; }
    getCue() { return this.state; }
    getRelations(flow: Flow): Play.EntityRel[] {
      return [{ type: 'ent', entId: this.state.id, ms: this.state.ms + (this.state.kind === 'chat' ? 8000 : 650), inp: { type: 'expire' } }];
    }
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp) {
      if (rel.type === 'expire') delete entities[this.state.id];
    }
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      if (this.state.kind !== 'spray') return [];
      const age = Math.min(1, Math.max(0, (flow.ms - this.state.ms) / 650));
      return [{ z: 2, fn: () => {
        for (let index = 0; index < 7; index++) {
          const tur = this.state.tur + (index - 3) * 0.045;
          const dist = (0.25 + age * (1.2 + index % 3 * 0.4));
          const pos = this.state.pos.add(Pt.polar({ tur, mag: dist }));
          draw.line({ pt0: pos, pt1: pos.add(Pt.polar({ tur, mag: 0.16 * (1 - age) })), line: '#102d13', lineW: 0.09 * (1 - age) });
          draw.circle({ pos, r: 0.06 * (1 - age), fill: '#9dff70' });
        }
      }}];
    }
  };

  const emitCue = (flow: Flow, entities: Obj<Entity>, kind: 'spray' | 'scream' | 'ouch', pos: Pt, tur: number, owner: string) => {
    const id = `Cue/${kind}/${owner}/${flow.ms}`;
    entities[id] = new Cue({ ms: flow.ms, id, kind, pos, tur, owner, text: '' });
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
    
    isSolid() { return true; }
    
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
      flow.cacheInvalidate(`${this.state.id}/forces`);
      
      fn(this.state as S);
      
      flow.cacheInvalidate(`${this.state.id}/tfm`);
      flow.cacheInvalidate(`${this.state.id}/forces`);
      
    }
    
    getColour(flow: Flow): `#${string}` { return '#f00'; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        
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
      
      return [ { z: 1, fn: () => {
        
        const { bound } = this.state;
        bound.render(tfm, draw, { fill: this.getColour(), line: '#eee', lineW: 0.045 });
        
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
    static reviveMs = 1000 * 5;
    static slowMs = 400;
    static maxHealth = 100;
    static grenadeCooldownMs = 1000 * 4;
    
    protected state: Physical['state'] & {
      name: string,
      buttons: Play.Buttons,
      guns: { id: string, kind: GunKind }[], // Owned guns; the `Gun` entities themselves live on the stage
      activeInd: number,
      health: number,
      look: number,           // Index into `playerLooks`
      star: boolean,
      aim: number | null,
      danceUntilMs: number,
      pillsUntilMs: number,   // While active, vision is wider
      grenadeReadyMs: number, // Earliest time of the next grenade throw
      revive: null | { ms: number, targetId: string } // Committal; while set the player can't move, turn or shoot
      slowUntilMs: null | number,                       // Set while standing in a pool; halves walking speed
    };
    constructor(state: Player['state']) {
      super(state);
      this.state = state;
    }
    
    getBaseStats() { return {
      ...super.getBaseStats(),
      posVel: 3.2,
      turVel: 0.26,
      visionSweep: 0.125,
      visionRange: 20
    }; }
    
    getForces0(flow: Flow) {
      
      const forces: Play.Force[] = [];
      const { buttons } = this.state;
      if (this.state.revive) return forces;
      
      // Movement forces
      (() => {
        
        // Aiming prevents moving or separate turning
        const aimTur = +buttons.turR2 - +buttons.turL2;
        if (aimTur && this.state.aim === null) {
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'turAcl', amt: aimTur * 0.06, flatSc: 2 });
          return;
        }
        
        const turPol = +buttons.turR1 - +buttons.turL1;
        
        const { posVel: basePosSpeed, turVel: baseTurSpeed } = this.getBaseStats();
        const posVel = basePosSpeed * (1 * (buttons.mod0 ? 2.00 : 1) * (buttons.act0 ? 0.8 : 1.0)) * (this.state.slowUntilMs !== null ? 0.5 : 1); // Faster when sprinting, slower when acting or wading
        const turVel = baseTurSpeed * (1 * (buttons.mod0 ? 0.75 : 1) * (buttons.act0 ? 0.2 : 1.0)); // Slower when sprinting, slower when acting
        if (this.state.aim !== null) {
          const delta = ((this.state.aim - this.state.tur) % 1 + 1.5) % 1 - 0.5;
          if (Math.abs(delta) > 0.000001) forces.push({ ms: this.state.anchorMs, durMs: Math.abs(delta) / turVel * 1000, type: 'turVel', amt: Math.sign(delta) * turVel });
          const walk = buttons.mapFixed
            ? new Pt({ x: +buttons.dirR - +buttons.dirL, y: +buttons.dirD - +buttons.dirU }).norm().mult(posVel)
            : new Pt({ x: +buttons.dirU - +buttons.dirD, y: +buttons.dirR - +buttons.dirL }).norm().mult(posVel * (buttons.dirD ? 0.3 : buttons.dirL || buttons.dirR ? 0.55 : 1)).addTur(this.state.tur);
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'vel', ...walk.encode() });
          return;
        }
        
        // Movement penalties; strafing is slower; backwards is slowest
        const walkVelMult = false                                ? 1
          : this.state.buttons.dirD                              ? 0.3
          : (this.state.buttons.dirR || this.state.buttons.dirL) ? 0.55
          :                                                        1;
        
        // Direction of movement based on facing direction and buttons
        const walkPol = +this.state.buttons.dirU - +this.state.buttons.dirD; // "walk"
        const strfPol = +this.state.buttons.dirR - +this.state.buttons.dirL; // "strafe"
        
        // With a fixed map, movement is relative to the screen (W is always up) rather than the facing
        if (buttons.mapFixed) {
          const fixedVel = new Pt({ x: strfPol, y: -walkPol }).norm().mult(posVel);
          if (fixedVel.len()) forces.push({ ms: this.state.anchorMs, durMs: null, type: 'vel', x: fixedVel.x, y: fixedVel.y });
          if (turPol) forces.push({ ms: this.state.anchorMs, durMs: null, type: 'turVel', amt: turVel * turPol });
          return;
        }
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
    
    getName() { return this.state.name; }
    getButtons() { return this.state.buttons; }
    isReviving(targetId: string) { return this.state.revive?.targetId === targetId; }
    isBusy() { return this.state.revive !== null; }
    isSlowed() { return this.state.slowUntilMs !== null; }
    getHealth() { return this.state.health; }
    getLook() { return this.state.look; }
    getStar() { return this.state.star; }
    setStar(star: boolean) { this.state.star = star; }
    setAim(flow: Flow, aim: number | null) {
      this.reanchor<Player['state']>(flow, state => { state.aim = aim === null ? null : ((aim % 1) + 1) % 1; });
    }
    
    heal(amt: number) { this.state.health = Math.min(Player.maxHealth, this.state.health + amt); }
    
    throwGrenade(flow: Flow, entities: Obj<Entity>, rng: Rng) {
      
      if (flow.ms < this.state.grenadeReadyMs) return;
      
      const tfm = this.getTransform(flow);
      const id = `${Grenade.clsName}/${rng.nextFlt().toString(36).slice(2)}`;
      entities[id] = new Grenade({
        id,
        ms: flow.ms,
        anchorMs: flow.ms,
        pos: tfm.pos,
        tur: tfm.tur,
        dest: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: Grenade.throwDist })),
        shooterId: this.state.id,
        shooterName: this.state.name
      });
      
      this.state.grenadeReadyMs = flow.ms + Player.grenadeCooldownMs;
      
    }
    
    // Returns the remaining health
    hurt(amt: number) { return this.state.health = Math.max(0, this.state.health - amt); }
    
    slow(flow: Flow) {
      
      if (this.state.slowUntilMs !== null) return;
      this.reanchor<Player['state']>(flow, state => { state.slowUntilMs = flow.ms + Player.slowMs; });
      
    }
    getGuns() { return this.state.guns; }
    
    getActiveGun(entities: Obj<Entity>): null | Gun {
      
      const owned = this.state.guns[this.state.activeInd];
      const gun = owned ? entities[cl.at](owned.id, null) : null;
      return gun && cl.isCls(gun, Gun) ? gun : null;
      
    }
    
    swapGun(flow: Flow, entities: Obj<Entity>) {
      
      const { guns } = this.state;
      if (guns.length < 2) return;
      
      this.getActiveGun(entities)?.setActive(flow, false);
      this.state.activeInd = (this.state.activeInd + 1) % guns.length;
      
      const gun = this.getActiveGun(entities);
      gun?.setActive(flow, true);
      if (this.state.buttons.act0) gun?.setTrigger(flow, true);
      
    }
    
    pickUp(flow: Flow, entities: Obj<Entity>, world: World) {
      
      const pos = this.getTransform(flow).pos;
      let nearest: null | Gun | Ammo | Pickup = null;
      let nearestDist = Gun.pickupRange;
      for (const ent of Object.values(entities)) {
        
        // Ammo only interests players who own a matching gun
        let at: null | Pt = null;
        if (ent instanceof Gun && ent.getOwnerId() === null) at = ent.getPos();
        else if (ent instanceof Ammo && this.state.guns.some(g => g.kind === ent.getKind())) at = ent.getPos();
        else if (ent instanceof Pickup && (ent.getKind() !== 'medkit' || this.state.health < Player.maxHealth)) at = ent.getPos();
        if (!at) continue;
        
        const dist = at.sub(pos).len();
        if (dist < nearestDist) { nearest = ent as Gun | Ammo | Pickup; nearestDist = dist; }
        
      }
      
      const picked = nearest as null | Gun | Ammo | Pickup;
      if (!picked) return;
      
      if (picked instanceof Pickup) {
        
        if (picked.getKind() === 'medkit') this.heal(Pickup.healAmt);
        else if (picked.getKind() === 'pills') this.state.pillsUntilMs = flow.ms + Pickup.pillsMs;
        else recordStat(world, flow, this.state.id, this.state.name, 'trophies', 1);
        
        delete entities[picked.getId()];
        return;
        
      }
      
      if (picked instanceof Ammo) {
        const owned = this.state.guns.find(g => g.kind === picked.getKind());
        const ownedGun = owned ? entities[cl.at](owned.id, null) : null;
        if (ownedGun && cl.isCls(ownedGun, Gun)) ownedGun.addReserve(picked.getAmt());
        delete entities[picked.getId()];
        return;
      }
      
      const gun = picked as Gun;
      
      // A duplicate kind just contributes its ammo
      const { guns } = this.state;
      const dupe = guns.find(g => g.kind === gun.getKind());
      if (dupe) {
        const owned = entities[cl.at](dupe.id, null);
        if (owned && cl.isCls(owned, Gun)) owned.addReserve(gun.getClip() + gun.getReserve());
        delete entities[gun.getId()];
        return;
      }
      
      this.getActiveGun(entities)?.setActive(flow, false);
      gun.take(this.state.id);
      guns.push({ id: gun.getId(), kind: gun.getKind() });
      this.state.activeInd = guns.length - 1;
      gun.setActive(flow, true);
      if (this.state.buttons.act0) gun.setTrigger(flow, true);
      
    }
    
    dropGuns(flow: Flow, entities: Obj<Entity>) {
      
      const pos = this.getTransform(flow).pos;
      const { guns } = this.state;
      guns.forEach(({ id }, n) => {
        const gun = entities[cl.at](id, null);
        if (gun && cl.isCls(gun, Gun)) gun.drop(pos.add(Pt.polar({ tur: n / guns.length, mag: 0.8 })));
      });
      
    }
    
    getHud(entities: Obj<Entity>, flow: Flow) {
      
      const gun = this.getActiveGun(entities);
      return {
        guns: this.state.guns.map((g, n) => ({ kind: g.kind as string, active: n === this.state.activeInd })),
        clip: gun ? gun.getClip() : 0,
        reserve: gun ? gun.getReserve() : 0,
        reloading: gun ? gun.isReloading() : false,
        health: this.state.health,
        grenadeMs: Math.max(0, this.state.grenadeReadyMs - flow.ms),
        pillsMs: Math.max(0, this.state.pillsUntilMs - flow.ms),
        reviving: this.state.revive !== null
      };
      
    }
    
    findRevivable(flow: Flow, entities: Obj<Entity>) {
      
      const pos = this.getTransform(flow).pos;
      let best: null | DownedPlayer = null;
      let bestDist = DownedPlayer.reviveRange;
      for (const ent of Object.values(entities)) {
        
        if (!cl.isCls(ent, DownedPlayer) || ent.isClaimed(entities)) continue;
        
        const dist = ent.getTransform(flow).pos.sub(pos).len();
        if (dist < bestDist) { best = ent; bestDist = dist; }
        
      }
      
      return best;
      
    }
    
    getRelationGroups(flow: Flow): Play.RelationGroup[] {
      return [ ...super.getRelationGroups(flow), 'player' ];
    }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      
      if (this.state.revive) rels.push({
        type: 'ent', entId: this.state.id, ms: this.state.revive.ms + Player.reviveMs, inp: { type: 'revive' }
      });
      
      if (this.state.slowUntilMs !== null) rels.push({
        type: 'ent', entId: this.state.id, ms: this.state.slowUntilMs, inp: { type: 'unslow' }
      });
      if (this.state.aim !== null && !this.state.revive) {
        const delta = ((this.state.aim - this.state.tur) % 1 + 1.5) % 1 - 0.5;
        const speed = this.getBaseStats().turVel * (this.state.buttons.mod0 ? 0.75 : 1) * (this.state.buttons.act0 ? 0.2 : 1);
        if (Math.abs(delta) > 0.000001) rels.push({ type: 'ent', entId: this.state.id, ms: this.state.anchorMs + Math.abs(delta) / speed * 1000, inp: { type: 'aimStop' } });
      }
      
      return rels;
      
    }
    
    advanceButton(flow: Flow, entities: Obj<Entity>, rng: Rng, button: Play.Button, act: boolean, world: World) {
      
      const body = (button === 'act3' && act && !this.state.revive) ? this.findRevivable(flow, entities) : null;
      
      this.reanchor<Player['state']>(flow, state => {
        
        state.buttons[button] = act;
        
        // Button state is still tracked while reviving, but has no effect
        if (state.revive) return;
        
        if (button === 'act0') this.getActiveGun(entities)?.setTrigger(flow, act);
        if (button === 'act1' && act) this.swapGun(flow, entities);
        if (button === 'act2' && act) this.getActiveGun(entities)?.startReload(flow);
        if (button === 'act4' && act) this.pickUp(flow, entities, world);
        if (button === 'act5' && act) this.throwGrenade(flow, entities, rng);
        if (button === 'act6' && act) state.danceUntilMs = flow.ms + 4000;
        
        if (body) {
          state.revive = { ms: flow.ms, targetId: body.getId() };
          this.getActiveGun(entities)?.setTrigger(flow, false);
          body.setReviver(state.id);
        }
        
      });
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp, world: World): void {
      if (rel.type === 'aimStop') this.reanchor(flow, () => {});
      
      if (rel.type === 'unslow') {
        
        // Standing in a pool again re-slows on the next collision check
        if (this.state.slowUntilMs === null) return;
        this.reanchor<Player['state']>(flow, state => { state.slowUntilMs = null; });
        
      }
      
      if (rel.type === 'revive') {
        
        const { revive } = this.state;
        if (!revive) return;
        
        const body = entities[cl.at](revive.targetId, null);
        if (body && cl.isCls(body, DownedPlayer)) {
          body.revive(flow, rng, entities);
          recordStat(world, flow, this.state.id, this.state.name, 'revives', 1);
        }
        
        this.reanchor<Player['state']>(flow, state => {
          state.revive = null;
          this.getActiveGun(entities)?.setTrigger(flow, state.buttons.act0);
        });
        
      }
      
    }
    
    getColour(flow: Flow): `#${string}` { return playerLooks[this.state.look].body; }
    
    renderClip(flow: Flow, draw: Draw) {
      const { visionSweep, visionRange } = this.getBaseStats();
      const { pos, tur } = this.getTransform(flow);
      draw.cone({ pos, tur, sweep: visionSweep * (this.state.buttons.mod0 ? 0.6 : 1) * (flow.ms < this.state.pillsUntilMs ? 2 : 1), r: visionRange }); // Sprinting narrows vision; pills widen it
      draw.circle({ pos, r: 2 });
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        
        const colour = this.getColour(flow);
        this.getBound().render(tfm, draw, { fill: colour, line: '#fff', lineW: 0.09 });
        this.getBound().render(tfm, draw, { line: '#111', lineW: 0.035 });
        if (this.state.star) draw.polygon({
          pts: Array.from({ length: 10 }, (_, index) => tfm.pos.add(Pt.polar({ tur: -0.25 + index / 10, mag: index % 2 ? 0.27 : 0.65 }))),
          fill: '#ffd43b', line: '#171717', lineW: 0.07
        });
        if (flow.ms < this.state.danceUntilMs) {
          const beat = Math.sin(flow.sc * 14);
          for (const side of [ -1, 1 ]) draw.line({
            pt0: tfm.pos.add(Pt.polar({ tur: tfm.tur + side * 0.25, mag: 0.2 })),
            pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur + side * (0.25 + beat * 0.13), mag: 0.85 })),
            line: '#fff', lineW: 0.12
          });
        }
        
        const { accent, mark } = playerLooks[this.state.look];
        const side = tfm.tur + 0.25;
        if (mark === 'dot')    draw.circle({ pos: tfm.pos, r: 0.12, fill: accent });
        if (mark === 'ring')   draw.circle({ pos: tfm.pos, r: 0.26, line: accent, lineW: 0.06 });
        if (mark === 'half')   draw.cone({ pos: tfm.pos, tur: tfm.tur, sweep: 0.5, r: 0.3, fill: accent });
        if (mark === 'tri')    draw.polygon({ pts: [ tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.28 })), tfm.pos.add(Pt.polar({ tur: tfm.tur + 0.35, mag: 0.2 })), tfm.pos.add(Pt.polar({ tur: tfm.tur - 0.35, mag: 0.2 })) ], fill: accent });
        if (mark === 'stripe' || mark === 'cross') draw.line({ pt0: tfm.pos.add(Pt.polar({ tur: side, mag: 0.3 })), pt1: tfm.pos.add(Pt.polar({ tur: side, mag: -0.3 })), line: accent, lineW: 0.1 });
        if (mark === 'cross')  draw.line({ pt0: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.3 })), pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: -0.3 })), line: accent, lineW: 0.1 });
        
        const active = this.state.guns[this.state.activeInd];
        if (active) {
          const spec = gunSpecs[active.kind];
          draw.line({ pt0: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.2 })), pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.2 + spec.len })), line: '#fff', lineW: 0.2 });
          draw.line({
            pt0: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.2 })),
            pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.2 + spec.len })),
            line: spec.colour,
            lineW: 0.12
          });
        }
        
        const { revive } = this.state;
        if (revive) draw.circle({
          pos: tfm.pos,
          r: 0.2 + 0.7 * Math.max(0, revive.ms + Player.reviveMs - flow.ms) / Player.reviveMs,
          line: '#fff',
          lineW: 0.05
        });
        
        draw.line({
          pt0: tfm.pos,
          pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 3 })),
          line: colour,
          lineW: 0.03
        });
        
        
      }}];
      
    }
    
  };
  
  class Zombie extends Humanoid {
    
    static readonly clsName: string = 'Zombie';
    
    static bound = new CircleBound({ r: 0.5 });
    static planDelayMs = 1000 * 2;
    static maxHealth = 5;
    static strikeDamage = 100;
    static aggroRange = 28; // Zombies ignore players farther away than this
    
    static bounds = new Map<number, CircleBound>();
    static boundFor(size: number) {
      
      let bound = Zombie.bounds.get(size);
      if (!bound) Zombie.bounds.set(size, bound = new CircleBound({ r: 0.5 * size }));
      return bound;
      
    }
    
    // Half to double the base size; health scales with size
    static randomBuild(rng: Rng) {
      
      const size = Math.round((0.5 + rng.nextFlt() * 1.5) * 10) / 10;
      const maxHealth = Math.max(1, Math.round(Zombie.maxHealth * size));
      return { size, health: maxHealth, maxHealth };
      
    }
    
    protected state: Physical['state'] & {
      plan: { ms: number } & [
        { type: 'bored',       dir: 'lh' | 'rh' },
        { type: 'destination', pos: Pt },
        { type: 'player',      pos: Pt }
      ][number],
      nextPlanMs: number,
      health: number,
      maxHealth: number,
      size: number,
      flankTur: number // Preferred approach angle around a player; differs per zombie so groups arrive from many sides
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
        nextPlanMs: flow.ms + 1000 * 5,
        ...Zombie.randomBuild(rng),
        flankTur: rng.nextFlt()
      });
      
    };
    
    constructor(state: Zombie['state']) {
      super(state);
      this.state = state;
    }
    
    getBound() { return Zombie.boundFor(this.state.size); }
    
    getBaseStats() { return { ...super.getBaseStats(), posVel: 2.5 }; }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      
      for (let ms = this.state.nextPlanMs; ms <= flow.ms; ms += Zombie.planDelayMs)
        rels.push({ type: 'ent', entId: this.state.id, ms, inp: { type: 'zombiePlan' } });
      
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      
      if (rel.type === 'zombiePlan') {
        
        // Random player in aggro range each plan spreads zombies across players; far zombies aim for their own
        // flank point beside the player, near zombies close in directly; with nobody in range they wander
        const here = this.getTransform(flow).pos;
        const players = entities[cl.toArr](v => cl.isCls(v, Player) && v.getTransform(flow).pos.sub(here).len() < Zombie.aggroRange ? v : cl.skip);
        const player = rng.elem(players);
        
        this.reanchor<Zombie['state']>(flow, state => {
          
          if (!player) {
            state.plan = { ms: rel.ms, type: 'bored', dir: rng.elem([ 'lh', 'rh' ] as const)! };
          } else {
            const playerPos = player.getTransform(flow).pos;
            const far = playerPos.sub(state.pos).len() > 10;
            const pos = far ? playerPos.add(Pt.polar({ tur: state.flankTur, mag: 7 })) : playerPos;
            state.plan = { ms: rel.ms, type: 'player', pos };
          }
          
          state.nextPlanMs = Math.max(state.nextPlanMs, rel.ms + Zombie.planDelayMs);
          
          if (state.plan.type === 'player')
            state.tur = state.pos.getTur(state.plan.pos);
          
        });
        
      }
      
    }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      
      const { phys, world, flow, rng, entities } = inp;
      
      // Already removed or replaced earlier in this batch of relations
      if (entities[this.state.id] !== this) return;
      
      if (cl.isCls(phys, Bullet)) {
        
        const { id, name } = phys.getShooter();
        const dmg = phys.getDamage();
        recordStat(world, flow, id, name, 'damage', Math.min(dmg, this.state.health));
        emitCue(flow, entities, 'spray', this.getTransform(flow).pos, phys.getTransform(flow).tur, `${this.state.id}/${phys.getId()}`);
        
        this.state.health -= dmg;
        if (this.state.health <= 0) { recordStat(world, flow, id, name, 'kills', 1); emitCue(flow, entities, 'scream', this.getTransform(flow).pos, 0, this.state.id); this.die(inp); }
        
      }
      
      // A strike takes a living player's health; at zero they're compromised
      if (cl.isCls(phys, Player) && entities[phys.getId()] === phys)
        damagePlayer({ flow, rng, entities, player: phys, amt: Zombie.strikeDamage, source: 'zombie' });
      
    }
    
    die(inp: { flow: Flow, rng: Rng, entities: Obj<Entity> }) { delete inp.entities[this.state.id]; }
    
    hurt(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity> }, dmg: number, shooter: { id: string, name: string }) {
      
      const { world, flow, rng, entities } = inp;
      if (entities[this.state.id] !== this) return;
      
      recordStat(world, flow, shooter.id, shooter.name, 'damage', Math.min(dmg, this.state.health));
      this.state.health -= dmg;
      if (this.state.health <= 0) { recordStat(world, flow, shooter.id, shooter.name, 'kills', 1); emitCue(flow, entities, 'scream', this.getTransform(flow).pos, 0, this.state.id); this.die({ flow, rng, entities }); }
      
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
    
    getBaseRgb(): [ number, number, number ] { return [ 0x44, 0xaa, 0x00 ]; }
    
    getColour(flow: Flow): `#${string}` {
      
      // Darkens toward 35% brightness as health drops
      const b = 0.35 + 0.65 * Math.max(0, this.state.health) / this.state.maxHealth;
      const hex = (v: number) => Math.round(v * b).toString(16).padStart(2, '0');
      const [ r, g, bl ] = this.getBaseRgb();
      return `#${hex(r)}${hex(g)}${hex(bl)}`;
      
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        
        const colour = this.getColour(flow);
        this.getBound().render(tfm, draw, { fill: colour, line: '#fff', lineW: 0.08 });
        this.getBound().render(tfm, draw, { line: '#111', lineW: 0.035 });
        
        draw.line({
          pt0: tfm.pos,
          pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.65 * this.state.size })),
          line: colour,
          lineW: 0.2 * this.state.size
        });
        
      }}];
      
    }
    
  };
  
  // A player touched by a zombie; behaves as a zombie until killed
  class CompromisedPlayer extends Zombie {
    
    static readonly clsName: string = 'CompromisedPlayer';
    
    static fromPlayer(flow: Flow, rng: Rng, player: Player) {
      
      const tfm = player.getTransform(flow);
      return new CompromisedPlayer({
        ms: flow.ms,
        id: player.getId(),
        anchorMs: flow.ms,
        pos: tfm.pos,
        tur: tfm.tur,
        plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! },
        nextPlanMs: flow.ms + 500,
        health: Zombie.maxHealth,
        maxHealth: Zombie.maxHealth,
        size: 1,
        flankTur: rng.nextFlt(),
        name: player.getName(),
        look: player.getLook(),
        star: player.getStar(),
        buttons: { ...player.getButtons() }
      });
      
    }
    
    protected state: Zombie['state'] & { name: string, look: number, star: boolean, buttons: Play.Buttons };
    constructor(state: CompromisedPlayer['state']) { super(state); this.state = state; }
    
    getLook() { return this.state.look; }
    getStar() { return this.state.star; }
    
    advanceButton(flow: Flow, entities: Obj<Entity>, rng: Rng, btn: Play.Button, act: boolean) {
      this.state.buttons[btn] = act;
    }
    
    die(inp: { flow: Flow, entities: Obj<Entity> }) {
      
      const { flow, entities } = inp;
      const tfm = this.getTransform(flow);
      replaceEntity(flow, entities, new DownedPlayer({
        id: this.state.id,
        ms: flow.ms,
        anchorMs: flow.ms,
        pos: tfm.pos,
        tur: tfm.tur,
        name: this.state.name,
        buttons: { ...this.state.buttons },
        look: this.state.look,
        star: this.state.star,
        reviverId: null
      }));
      
    }
    
    revive(flow: Flow, rng: Rng, entities: Obj<Entity>, pos?: Pt) {
      
      const tfm = this.getTransform(flow);
      spawnPlayer(flow, rng, entities, { id: this.state.id, name: this.state.name, pos: pos ?? tfm.pos, tur: tfm.tur, buttons: this.state.buttons });
      
    }
    
    getBaseRgb(): [ number, number, number ] { return [ 0xaa, 0x44, 0xaa ]; }
    
    renderClip(flow: Flow, draw: Draw) { draw.circle({ pos: this.getTransform(flow).pos, r: 1.5 }); }
    
  };
  
  // A player killed while compromised; another player can revive them by pressing Q nearby
  class DownedPlayer extends Physical {
    
    static readonly clsName: string = 'DownedPlayer';
    
    static bound = new CircleBound({ r: 0.4 });
    static reviveRange = 2;
    
    static fromPlayer(flow: Flow, player: Player) {
      
      const tfm = player.getTransform(flow);
      return new DownedPlayer({
        id: player.getId(),
        ms: flow.ms,
        anchorMs: flow.ms,
        pos: tfm.pos,
        tur: tfm.tur,
        name: player.getName(),
        buttons: { ...player.getButtons() },
        look: player.getLook(),
        star: player.getStar(),
        reviverId: null
      });
      
    }
    
    protected state: Physical['state'] & { name: string, look: number, star: boolean, buttons: Play.Buttons, reviverId: null | string };
    constructor(state: DownedPlayer['state']) { super(state); this.state = state; }
    
    getLook() { return this.state.look; }
    getStar() { return this.state.star; }
    
    getBound() { return DownedPlayer.bound; }
    canCollide(phys: Physical) { return false; }
    getRelationGroups(flow: Flow): Play.RelationGroup[] { return []; }
    
    advanceButton(flow: Flow, entities: Obj<Entity>, rng: Rng, btn: Play.Button, act: boolean) {
      this.state.buttons[btn] = act;
    }
    
    setReviver(id: string) { this.state.reviverId = id; }
    
    // A claim lapses if the reviver stopped reviving (e.g. they were compromised mid-revive)
    isClaimed(entities: Obj<Entity>) {
      
      const { reviverId } = this.state;
      const reviver = reviverId === null ? null : entities[cl.at](reviverId, null);
      return !!reviver && cl.isCls(reviver, Player) && (reviver as Player).isReviving(this.state.id);
      
    }
    
    revive(flow: Flow, rng: Rng, entities: Obj<Entity>, pos?: Pt) {
      
      const tfm = this.getTransform(flow);
      spawnPlayer(flow, rng, entities, { id: this.state.id, name: this.state.name, pos: pos ?? tfm.pos, tur: tfm.tur, buttons: this.state.buttons });
      
    }
    
    getColour(flow: Flow): `#${string}` { return '#666'; }
    
    renderClip(flow: Flow, draw: Draw) { draw.circle({ pos: this.getTransform(flow).pos, r: 1.5 }); }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        
        this.getBound().render(tfm, draw, { fill: this.getColour(flow), line: '#111', lineW: 0.08 });
        draw.circle({ pos: tfm.pos, r: 0.32, line: '#fff', lineW: 0.045 });
        
        const textPos = tfm.pos.add(Pt.polar({ tur: tfm.tur + 0.5, mag: 1 }));
        draw.text({
          text: this.state.name,
          x: textPos.x,
          y: textPos.y,
          tur: tfm.tur + 0.25,
          fontSize: 0.6,
          fill: '#fff'
        });
        
      }}];
      
    }
    
  };
  
  // Hardly moves; lobs globs that land near players and leave slowing pools
  class WetMan extends Zombie {
    
    static readonly clsName: string = 'WetMan';
    
    static spitDelayMs = 1000 * 3;
    static spitVel = 10;
    static spitRange = 25;
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, num: number, pos: Pt, tur: number }) => {
      
      const { flow, rng, num, pos, tur } = inp;
      return new WetMan({
        ms: flow.ms,
        id: `${WetMan.clsName}/wetMan/${num}`,
        anchorMs: flow.ms,
        pos,
        tur,
        plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! },
        nextPlanMs: flow.ms + 1000 * 5,
        health: Zombie.maxHealth,
        maxHealth: Zombie.maxHealth,
        size: 1,
        flankTur: rng.nextFlt(),
        // The airlock door opens at most ~7s after a level starts
        nextSpitMs: flow.ms + 1000 * 8 + rng.nextFlt() * 1000 * 2
      });
      
    };
    
    protected state: Zombie['state'] & { nextSpitMs: number };
    constructor(state: WetMan['state']) { super(state); this.state = state; }
    
    getBaseStats() { return { ...super.getBaseStats(), posVel: 0.4 }; }
    
    isAcid() { return false; }
    getSpitVel() { return WetMan.spitVel; }
    
    getBaseRgb(): [ number, number, number ] { return [ 0x33, 0x77, 0xcc ]; }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      
      for (let ms = this.state.nextSpitMs; ms <= flow.ms; ms += WetMan.spitDelayMs)
        rels.push({ type: 'ent', entId: this.state.id, ms, inp: { type: 'spit' } });
      
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      
      super.advanceRelation(flow, entities, rng, rel);
      
      if (rel.type === 'spit') {
        
        this.state.nextSpitMs = Math.max(this.state.nextSpitMs, rel.ms + WetMan.spitDelayMs);
        
        const players = entities[cl.toArr](v => cl.isCls(v, Player) ? v : cl.skip);
        const player = rng.elem(players);
        if (!player) return;
        
        // Aim near (not at) the player
        const at = flow.jumpTo(rel.ms);
        const from = this.getTransform(at).pos;
        const dest = player.getTransform(at).pos.add(Pt.polar({ tur: rng.nextFlt(), mag: rng.nextFlt() * 3 }));
        const dist = dest.sub(from).len();
        if (dist > WetMan.spitRange) return;
        
        const id = `${Glob.clsName}/${rng.nextFlt().toString(36).slice(2)}`;
        entities[id] = new Glob({
          id,
          ms: rel.ms,
          anchorMs: rel.ms,
          pos: from,
          tur: from.getTur(dest),
          dest,
          acid: this.isAcid(),
          flightMs: Math.max(200, dist / this.getSpitVel() * 1000)
        });
        
      }
      
    }
    
  };
  
  // Like WetMan but spits slow acid that damages players where it lands
  class AcidMan extends WetMan {
    
    static readonly clsName: string = 'AcidMan';
    
    static acidVel = 5;
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, num: number, pos: Pt, tur: number }) => {
      
      const { flow, rng, num, pos, tur } = inp;
      return new AcidMan({
        ms: flow.ms,
        id: `${AcidMan.clsName}/acidMan/${num}`,
        anchorMs: flow.ms,
        pos,
        tur,
        plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! },
        nextPlanMs: flow.ms + 1000 * 5,
        health: Zombie.maxHealth,
        maxHealth: Zombie.maxHealth,
        size: 1,
        flankTur: rng.nextFlt(),
        nextSpitMs: flow.ms + 1000 * 8 + rng.nextFlt() * 1000 * 2
      });
      
    };
    
    isAcid() { return true; }
    getSpitVel() { return AcidMan.acidVel; }
    getBaseRgb(): [ number, number, number ] { return [ 0xbb, 0xcc, 0x22 ]; }
    
  };
  
  // A projectile in flight; becomes a `Pool` where it lands
  class Glob extends Physical {
    
    static readonly clsName: string = 'Glob';
    
    static bound = new CircleBound({ r: 0.25 });
    static acidRadius = 1.3;
    static acidDamage = 30;
    
    protected state: Physical['state'] & { dest: Pt, flightMs: number, acid: boolean };
    constructor(state: Glob['state']) { super(state); this.state = state; }
    
    getBound() { return Glob.bound; }
    canCollide(phys: Physical) { return false; }
    getRelationGroups(flow: Flow): Play.RelationGroup[] { return []; }
    
    getForces0(flow: Flow): Play.Force[] {
      
      const { pos, dest, flightMs, anchorMs } = this.state;
      const vel = dest.sub(pos).mult(1000 / flightMs);
      return [ { ms: anchorMs, type: 'vel', durMs: null, x: vel.x, y: vel.y } ];
      
    }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      rels.push({ type: 'ent', entId: this.state.id, ms: this.state.anchorMs + this.state.flightMs, inp: { type: 'land' } });
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      
      if (rel.type !== 'land') return;
      
      delete entities[this.state.id];
      
      if (this.state.acid) {
        
        // Acid splashes on landing instead of leaving a pool
        for (const ent of Object.values(entities))
          if (ent instanceof Player && ent.getTransform(flow).pos.sub(this.state.dest).len() < Glob.acidRadius)
            damagePlayer({ flow, rng, entities, player: ent, amt: Glob.acidDamage, source: 'zombie' });
        
        const blastId = `${Blast.clsName}/${rng.nextFlt().toString(36).slice(2)}`;
        entities[blastId] = new Blast({ id: blastId, ms: rel.ms, anchorMs: rel.ms, pos: this.state.dest, tur: 0, radius: Glob.acidRadius, colour: '#88cc22' });
        return;
        
      }
      
      const id = `${Pool.clsName}/${rng.nextFlt().toString(36).slice(2)}`;
      entities[id] = new Pool({ id, ms: rel.ms, anchorMs: rel.ms, pos: this.state.dest, tur: 0 });
      
    }
    
    getColour(flow: Flow): `#${string}` { return this.state.acid ? '#9c2' : '#4ae'; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        this.getBound().render(tfm, draw, { fill: this.getColour(flow), line: '#111', lineW: 0.07 });
        draw.circle({ pos: tfm.pos, r: 0.32, line: '#fff', lineW: 0.045 });
      }}];
      
    }
    
  };
  
  // A 1m-radius puddle which slows any player standing in it
  class Pool extends Physical {
    
    static readonly clsName: string = 'Pool';
    
    static bound = new CircleBound({ r: 1 });
    static lifeMs = 1000 * 8;
    
    constructor(state: Physical['state']) { super(state); }
    
    getBound() { return Pool.bound; }
    isSolid() { return false; }
    
    // Slowed players are skipped so a stationary player doesn't trigger collisions every check
    canCollide(phys: Physical) { return cl.isCls(phys, Player) && !(phys as Player).isSlowed(); }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      if (cl.isCls(inp.phys, Player)) inp.phys.slow(inp.flow);
    }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      rels.push({ type: 'ent', entId: this.state.id, ms: this.state.anchorMs + Pool.lifeMs, inp: { type: 'expire' } });
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      if (rel.type === 'expire') delete entities[this.state.id];
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        this.getBound().render(tfm, draw, { fill: '#1868c0aa', line: '#fff', lineW: 0.07 });
        draw.circle({ pos: tfm.pos, r: 0.9, line: '#14283e', lineW: 0.05 });
      }}];
      
    }
    
  };
  
  // Huge, slow, tough; bursts into regular zombies when killed
  class PregnantMan extends Zombie {
    
    static readonly clsName: string = 'PregnantMan';
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, num: number, pos: Pt, tur: number }) => {
      
      const { flow, rng, num, pos, tur } = inp;
      return new PregnantMan({
        ms: flow.ms,
        id: `${PregnantMan.clsName}/pregnantMan/${num}`,
        anchorMs: flow.ms,
        pos,
        tur,
        plan: { type: 'bored', ms: flow.ms, dir: rng.elem([ 'lh', 'rh' ] as const)! },
        nextPlanMs: flow.ms + 1000 * 5,
        health: 40,
        maxHealth: 40,
        size: 3,
        flankTur: rng.nextFlt()
      });
      
    };
    
    getBaseStats() { return { ...super.getBaseStats(), posVel: 1.2 }; }
    
    getBaseRgb(): [ number, number, number ] { return [ 0xcc, 0x88, 0x77 ]; }
    
    die(inp: { flow: Flow, rng: Rng, entities: Obj<Entity> }) {
      
      const { flow, rng, entities } = inp;
      const pos = this.getTransform(flow).pos;
      delete entities[this.state.id];
      
      const capacity = Math.max(0, 60 - Object.values(entities).filter(ent => cl.inCls(ent, Zombie)).length);
      for (let n = 0; n < Math.min(5, capacity); n++) {
        
        const baby = Zombie.fromInitialState({
          flow,
          rng,
          num: Math.floor(rng.nextFlt() * 1e9),
          pos: pos.add(Pt.polar({ tur: n / 5, mag: 1.5 })),
          tur: rng.nextFlt()
        });
        entities[baby.getId()] = baby;
        
      }
      
    }
    
  };
  
  // Floor collectibles taken with E: medkits heal, trophies score points
  class Pickup extends Staged {
    
    static readonly clsName: string = 'Pickup';
    
    static healAmt = 50;
    static trophyPoints = 100;
    static pillsMs = 1000 * 30;
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, kind: 'medkit' | 'trophy' | 'pills', pos: Pt }) => {
      
      const { flow, rng, kind, pos } = inp;
      return new Pickup({ ms: flow.ms, id: `${Pickup.clsName}/${rng.nextFlt().toString(36).slice(2)}`, kind, pos });
      
    };
    
    protected state: Staged['state'] & { kind: 'medkit' | 'trophy' | 'pills', pos: Pt };
    constructor(state: Pickup['state']) { super(state); this.state = state; }
    
    getKind() { return this.state.kind; }
    getPos() { return this.state.pos; }
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      const { pos, kind } = this.state;
      return [ { z: 1, fn: () => {
        draw.circle({ pos, r: 0.65, fill: '#18202a', line: '#fff', lineW: 0.07 });
        
        if (kind === 'medkit') {
          draw.rect({ pos, tur: 0, w: 0.9, h: 0.7, fill: '#fff' });
          draw.rect({ pos, tur: 0, w: 0.5, h: 0.14, fill: '#d22' });
          draw.rect({ pos, tur: 0, w: 0.14, h: 0.5, fill: '#d22' });
        } else if (kind === 'pills') {
          draw.rect({ pos, tur: 0, w: 0.4, h: 0.6, fill: '#e80' });
          draw.rect({ pos: pos.add(new Pt({ x: 0, y: -0.4 })), tur: 0, w: 0.28, h: 0.2, fill: '#fff' });
        } else {
          draw.circle({ pos, r: 0.4, fill: '#fc2' });
          draw.circle({ pos, r: 0.2, fill: '#a80' });
        }
        draw.rect({ pos: pos.add(new Pt({ x: 0, y: 0.9 })), tur: 0, w: 2.8, h: 0.65, fill: '#111d' });
        draw.text({ x: pos.x, y: pos.y + 0.9, tur: 0, text: kind, fontSize: 0.5, fill: '#fff', align: '=' });
        
      }}];
      
    }
    
  };
  
  // Explodes when shot enough (or caught in another explosion)
  class Barrel extends Physical {
    
    static readonly clsName: string = 'Barrel';
    
    static bound = new CircleBound({ r: 0.6 });
    static maxHealth = 3;
    static radius = 4;
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, pos: Pt }) => {
      
      const { flow, rng, pos } = inp;
      return new Barrel({
        ms: flow.ms,
        id: `${Barrel.clsName}/${rng.nextFlt().toString(36).slice(2)}`,
        anchorMs: flow.ms,
        pos,
        tur: 0,
        health: Barrel.maxHealth
      });
      
    };
    
    protected state: Physical['state'] & { health: number };
    constructor(state: Barrel['state']) { super(state); this.state = state; }
    
    getBound() { return Barrel.bound; }
    getWeight() { return Infinity; }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      
      const { phys } = inp;
      if (cl.isCls(phys, Bullet) && (this.state.health -= phys.getDamage()) <= 0) this.detonate(inp, phys.getShooter());
      
    }
    
    detonate(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity> }, shooter: { id: string, name: string }) {
      
      const { world, flow, rng, entities } = inp;
      if (entities[this.state.id] !== this) return;
      
      delete entities[this.state.id];
      explodeAt({ world, flow, rng, entities, pos: this.getTransform(flow).pos, radius: Barrel.radius, zombieDamage: 8, playerDamage: 50, shooter });
      
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        draw.circle({ pos: tfm.pos, r: 0.6, fill: '#c63838', line: '#fff', lineW: 0.09 });
        draw.circle({ pos: tfm.pos, r: 0.4, line: '#511', lineW: 0.1 });
        draw.line({ pt0: tfm.pos.add(new Pt({ x: -0.22, y: -0.22 })), pt1: tfm.pos.add(new Pt({ x: 0.22, y: 0.22 })), line: '#fff36b', lineW: 0.12 });
      }}];
      
    }
    
  };
  
  // A thrown grenade; flies to its target and explodes after a fixed fuse
  class Grenade extends Physical {
    
    static readonly clsName: string = 'Grenade';
    
    static bound = new CircleBound({ r: 0.2 });
    static fuseMs = 1000;
    static throwDist = 10;
    static radius = 4;
    
    protected state: Physical['state'] & { dest: Pt, shooterId: string, shooterName: string };
    constructor(state: Grenade['state']) { super(state); this.state = state; }
    
    getBound() { return Grenade.bound; }
    canCollide(phys: Physical) { return false; }
    getRelationGroups(flow: Flow): Play.RelationGroup[] { return []; }
    
    getForces0(flow: Flow): Play.Force[] {
      
      const { pos, dest, anchorMs } = this.state;
      const vel = dest.sub(pos).mult(1000 / Grenade.fuseMs);
      return [ { ms: anchorMs, type: 'vel', durMs: null, x: vel.x, y: vel.y } ];
      
    }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      rels.push({ type: 'ent', entId: this.state.id, ms: this.state.anchorMs + Grenade.fuseMs, inp: { type: 'explode' } });
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp, world: World): void {
      
      if (rel.type !== 'explode') return;
      
      delete entities[this.state.id];
      explodeAt({
        world, flow, rng, entities,
        pos: this.state.dest,
        radius: Grenade.radius,
        zombieDamage: 10,
        playerDamage: 60,
        shooter: { id: this.state.shooterId, name: this.state.shooterName }
      });
      
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        draw.circle({ pos: tfm.pos, r: 0.26, fill: '#ffb52e', line: '#111', lineW: 0.07 });
        draw.circle({ pos: tfm.pos, r: 0.33, line: '#fff', lineW: 0.045 });
        draw.circle({ pos: tfm.pos, r: 0.09, fill: Math.floor(flow.ms / 100) % 2 ? '#fff' : '#dc2626' });
      }}];
      
    }
    
  };
  
  // Brief visual flash left by an explosion
  class Blast extends Physical {
    
    static readonly clsName: string = 'Blast';
    
    static bound = new CircleBound({ r: 1 });
    static lifeMs = 350;
    
    protected state: Physical['state'] & { radius: number, colour: `#${string}` };
    constructor(state: Blast['state']) { super(state); this.state = state; }
    
    getBound() { return Blast.bound; }
    canCollide(phys: Physical) { return false; }
    getRelationGroups(flow: Flow): Play.RelationGroup[] { return []; }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      rels.push({ type: 'ent', entId: this.state.id, ms: this.state.anchorMs + Blast.lifeMs, inp: { type: 'expire' } });
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      if (rel.type === 'expire') delete entities[this.state.id];
    }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        
        const t = Math.min(1, Math.max(0, (flow.ms - this.state.anchorMs) / Blast.lifeMs));
        const alpha = Math.round(255 * 0.7 * (1 - t)).toString(16).padStart(2, '0');
        draw.circle({ pos: tfm.pos, r: this.state.radius * (0.3 + 0.7 * t), fill: `${this.state.colour}${alpha}` });
        
      }}];
      
    }
    
  };
  
  // A weapon; owned guns are drawn by their owner and fired via the owner's buttons, unowned guns lie on the floor
  class Gun extends Staged {
    
    static readonly clsName: string = 'Gun';
    
    static pickupRange = 1.5;
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, kind: GunKind, owner?: null | string, pos?: Pt }) => {
      
      const { flow, rng, kind, owner = null, pos = new Pt() } = inp;
      const spec = gunSpecs[kind];
      return new Gun({
        ms: flow.ms,
        id: `${Gun.clsName}/${rng.nextFlt().toString(36).slice(2)}`,
        kind,
        ownerId: owner,
        active: owner !== null,
        pos,
        tur: rng.nextFlt(),
        clip: spec.clip,
        reserve: spec.reserve,
        triggerMs: null,
        nextShotMs: 0,
        reload: null
      });
      
    };
    
    protected state: Staged['state'] & {
      kind: GunKind,
      ownerId: null | string,
      active: boolean,            // Whether this is its owner's equipped gun
      pos: Pt,                    // Floor position; only meaningful while unowned
      tur: number,
      clip: number,
      reserve: number,
      triggerMs: null | number,   // When the trigger was pulled; null if released (or consumed by a semi-auto shot)
      nextShotMs: number,
      reload: null | { ms: number }
    };
    constructor(state: Gun['state']) { super(state); this.state = state; }
    
    getKind() { return this.state.kind; }
    getOwnerId() { return this.state.ownerId; }
    getPos() { return this.state.pos; }
    getClip() { return this.state.clip; }
    getReserve() { return this.state.reserve; }
    isReloading() { return this.state.reload !== null; }
    addReserve(amt: number) { this.state.reserve += amt; }
    
    take(ownerId: string) { this.state.ownerId = ownerId; this.state.active = false; }
    drop(pos: Pt) { Object.assign(this.state, { ownerId: null, active: false, pos, triggerMs: null, reload: null }); }
    
    // Holstering cancels any reload and releases the trigger
    setActive(flow: Flow, active: boolean) {
      this.state.active = active;
      if (!active) { this.state.triggerMs = null; this.state.reload = null; }
    }
    
    setTrigger(flow: Flow, on: boolean) { this.state.triggerMs = on ? flow.ms : null; }
    
    startReload(flow: Flow) {
      
      const { state } = this;
      if (state.reload || state.clip >= gunSpecs[state.kind].clip || state.reserve <= 0) return;
      state.reload = { ms: flow.ms };
      
    }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      
      const { state } = this;
      if (!state.active || state.ownerId === null) return rels;
      
      const spec = gunSpecs[state.kind];
      
      if (state.reload) rels.push({
        type: 'ent', entId: state.id, ms: state.reload.ms + spec.reloadMs, inp: { type: 'reloadDone' }
      });
      
      if (state.triggerMs !== null && state.clip > 0 && (!state.reload || spec.perRound)) {
        
        const first = Math.max(state.triggerMs, state.nextShotMs);
        const num = spec.auto ? state.clip : 1;
        for (let n = 0, ms = first; n < num && ms <= flow.ms; n++, ms += spec.fireMs)
          rels.push({ type: 'ent', entId: state.id, ms, inp: { type: 'shoot' } });
        
      }
      
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      
      const { state } = this;
      const spec = gunSpecs[state.kind];
      if (!state.active || state.ownerId === null) return;
      
      if (rel.type === 'shoot') {
        
        if (state.clip <= 0 || (state.reload && !spec.perRound)) return;
        
        const owner = entities[cl.at](state.ownerId, null);
        if (!owner || !cl.isCls(owner, Player) || owner.isBusy()) return;
        
        const tfm = owner.getTransform(flow.jumpTo(rel.ms));
        for (let n = 0; n < spec.pellets; n++) {
          
          const tur = tfm.tur + spec.spread * (0.5 - rng.nextFlt());
          const bulletId = `${Bullet.clsName}/${rng.nextFlt().toString(36).slice(2)}`;
          entities[bulletId] = new Bullet({
            id: bulletId,
            ms: rel.ms,
            anchorMs: rel.ms,
            pos: tfm.pos.add(Pt.polar({ tur, mag: Player.bound.boundingRadius() + Bullet.bound.boundingRadius() + 0.05 })),
            tur,
            vel: spec.vel,
            damage: spec.damage,
            shooterId: owner.getId(),
            shooterName: owner.getName()
          });
          
        }
        
        state.clip--;
        state.nextShotMs = Math.max(state.nextShotMs, rel.ms + spec.fireMs);
        if (!spec.auto) state.triggerMs = null;
        
        // Firing interrupts a shell-by-shell reload; an emptied clip starts reloading automatically
        state.reload = (state.clip === 0 && state.reserve > 0) ? { ms: rel.ms } : null;
        
      }
      
      if (rel.type === 'reloadDone') {
        
        const { reload } = state;
        if (!reload || rel.ms !== reload.ms + spec.reloadMs) return;
        
        if (spec.perRound) {
          state.clip++;
          state.reserve--;
          state.reload = (state.clip < spec.clip && state.reserve > 0) ? { ms: rel.ms } : null;
        } else {
          const amt = Math.min(spec.clip - state.clip, state.reserve);
          state.clip += amt;
          state.reserve -= amt;
          state.reload = null;
        }
        
      }
      
    }
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      if (this.state.ownerId !== null) return [];
      
      const { pos, tur, kind } = this.state;
      const spec = gunSpecs[kind];
      return [ { z: 1, fn: () => {
        draw.circle({ pos, r: 0.75, fill: '#18202a', line: '#fff', lineW: 0.07 });
        draw.line({ pt0: pos.add(Pt.polar({ tur, mag: spec.len * -0.5 })), pt1: pos.add(Pt.polar({ tur, mag: spec.len * +0.5 })), line: '#fff', lineW: 0.36 });
        
        draw.line({
          pt0: pos.add(Pt.polar({ tur, mag: spec.len * -0.5 })),
          pt1: pos.add(Pt.polar({ tur, mag: spec.len * +0.5 })),
          line: spec.colour,
          lineW: 0.25
        });
        draw.rect({ pos: pos.add(new Pt({ x: 0, y: 0.9 })), tur: 0, w: 2.8, h: 0.65, fill: '#111d' });
        draw.text({ x: pos.x, y: pos.y + 0.9, tur: 0, text: kind, fontSize: 0.5, fill: '#fff', align: '=' });
        
      }}];
      
    }
    
  };
  
  // Floor ammo; picking it up adds rounds to the reserve of the owned gun of the same kind
  class Ammo extends Staged {
    
    static readonly clsName: string = 'Ammo';
    
    static fromInitialState = (inp: { flow: Flow, rng: Rng, kind: GunKind, pos: Pt }) => {
      
      const { flow, rng, kind, pos } = inp;
      return new Ammo({
        ms: flow.ms,
        id: `${Ammo.clsName}/${rng.nextFlt().toString(36).slice(2)}`,
        kind,
        amt: gunSpecs[kind].clip * 2,
        pos
      });
      
    };
    
    protected state: Staged['state'] & { kind: GunKind, amt: number, pos: Pt };
    constructor(state: Ammo['state']) { super(state); this.state = state; }
    
    getKind() { return this.state.kind; }
    getAmt() { return this.state.amt; }
    getPos() { return this.state.pos; }
    
    getRenderOps(flow: Flow, draw: Draw): Play.RenderOp[] {
      
      const { pos, kind } = this.state;
      return [ { z: 1, fn: () => {
        
        draw.rect({ pos, tur: 0, w: 0.6, h: 0.45, fill: gunSpecs[kind].colour, line: '#fff', lineW: 0.1 });
        draw.rect({ pos: pos.add(new Pt({ x: 0, y: 0.8 })), tur: 0, w: 4, h: 0.65, fill: '#111d' });
        draw.text({ x: pos.x, y: pos.y + 0.8, tur: 0, text: `${kind} ammo`, fontSize: 0.5, fill: '#fff', align: '=' });
        
      }}];
      
    }
    
  };
  
  class Bullet extends Physical {
    
    static readonly clsName: string = 'Bullet';
    
    static bound = new RectBound({ w: 1.5, h: 0.1 });
    static lifeMs = 2500;
    static friendlyDamage = 25;
    
    protected state: Physical['state'] & {
      vel: number,
      damage: number,
      shooterId: string,
      shooterName: string
    };
    constructor(state: Bullet['state']) {
      super(state);
      this.state = state;
    }
    
    getDamage() { return this.state.damage; }
    getShooter() { return { id: this.state.shooterId, name: this.state.shooterName }; }
    
    getRelations(flow: Flow): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = super.getRelations(flow);
      rels.push({ type: 'ent', entId: this.state.id, ms: this.state.anchorMs + Bullet.lifeMs, inp: { type: 'expire' } });
      return rels;
      
    }
    
    advanceRelation(flow: Flow, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRelInp): void {
      if (rel.type === 'expire') delete entities[this.state.id];
    }
    
    canCollide(phys: Physical) { return !cl.isCls(phys, Bullet); }
    
    advanceCollide(inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      
      const { phys, world, flow, rng, entities } = inp;
      
      // Already spent earlier in this batch of relations
      if (entities[this.state.id] !== this) return;
      delete entities[this.state.id];
      
      if (cl.isCls(phys, Player) && entities[phys.getId()] === phys) {
        recordStat(world, flow, this.state.shooterId, this.state.shooterName, 'friendly', Math.min(Bullet.friendlyDamage, phys.getHealth()));
        damagePlayer({ flow, rng, entities, player: phys, amt: Bullet.friendlyDamage, source: 'friendly' });
      }
      
    }
    
    getBound(flow: Flow) { return Bullet.bound; }
    
    getColour(flow: Flow): `#${string}` { return '#fff36b'; }
    
    getRenderOps(flow: Flow, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 1, fn: () => {
        
        this.getBound(flow).render(tfm, draw, { fill: this.getColour(flow), line: '#111', lineW: 0.055 });
        
      }}];
      
    }
    
    getForces0(flow: Flow): Play.Force[] {
      
      const dir = Pt.polar({ tur: this.state.tur, mag: this.state.vel });
      return [
        { ms: this.state.anchorMs, type: 'vel', durMs: null, ...dir.encode() }
      ];
      
    }
    
  };
  
  // Swaps the entity registered under an id, discarding flow-cached data of the old entity
  const replaceEntity = (flow: Flow, entities: Obj<Entity>, ent: Staged) => {
    entities[ent.getId()] = ent;
    flow.cacheInvalidate(`${ent.getId()}/tfm`);
    flow.cacheInvalidate(`${ent.getId()}/forces`);
  };
  
  // Damages a living player; at zero health they're compromised (zombie strikes) or downed (friendly fire)
  const damagePlayer = (inp: { flow: Flow, rng: Rng, entities: Obj<Entity>, player: Player, amt: number, source: 'zombie' | 'friendly' }) => {
    
    const { flow, rng, entities, player, amt, source } = inp;
    if (amt > 0) emitCue(flow, entities, 'ouch', player.getTransform(flow).pos, 0, player.getId());
    if (player.hurt(amt) > 0) return;
    
    player.dropGuns(flow, entities);
    replaceEntity(flow, entities, source === 'zombie'
      ? CompromisedPlayer.fromPlayer(flow, rng, player)
      : DownedPlayer.fromPlayer(flow, player)
    );
    
  };
  
  const recordStat = (world: World, flow: Flow, id: string, name: string, key: 'damage' | 'kills' | 'friendly' | 'points' | 'revives' | 'trophies', amt: number) => {
    
    const stage = world.getStage(flow);
    if (stage instanceof Plunge) stage.addStat(id, name, key, amt);
    
  };
  
  // Damages everything in range; barrels chain-detonate, players take friendly-fire damage
  const explodeAt = (inp: { world: World, flow: Flow, rng: Rng, entities: Obj<Entity>, pos: Pt, radius: number, zombieDamage: number, playerDamage: number, shooter: { id: string, name: string } }) => {
    
    const { world, flow, rng, entities, pos, radius, zombieDamage, playerDamage, shooter } = inp;
    
    const blastId = `${Blast.clsName}/${rng.nextFlt().toString(36).slice(2)}`;
    entities[blastId] = new Blast({ id: blastId, ms: flow.ms, anchorMs: flow.ms, pos, tur: 0, radius, colour: '#ff9020' });
    
    for (const ent of Object.values(entities)) {
      
      if (!(ent instanceof Barrel) && !(ent instanceof Zombie) && !(ent instanceof Player)) continue;
      
      const dist = ent.getTransform(flow).pos.sub(pos).len();
      if (dist > radius) continue;
      const falloff = 1 - 0.5 * dist / radius;
      
      if (ent instanceof Barrel) ent.detonate(inp, shooter);
      else if (ent instanceof Zombie) ent.hurt(inp, zombieDamage * falloff, shooter);
      else if (entities[ent.getId()] === ent) {
        const amt = playerDamage * falloff;
        recordStat(world, flow, shooter.id, shooter.name, 'friendly', Math.min(amt, ent.getHealth()));
        damagePlayer({ flow, rng, entities, player: ent, amt, source: 'friendly' });
      }
      
    }
    
  };
  
  // Corridor walls for each side, ordered from the entry airlock to the exit airlock; the middle bulges outward
  const corridorGeom = (entry: Pt, exitPos: Pt) => {
    
    const airlockRadius = 15;
    const apothem = airlockRadius * Math.cos(Math.PI / 5);
    const dir = entry.getTur(exitPos);
    const len = exitPos.sub(entry).len() - apothem * 2;
    const ramp = Math.min(len * 0.3, 10);
    
    const sides = ([ -1, +1 ] as const).map(s => {
      
      const head = entry.add(Pt.polar({ tur: dir + s * 0.1, mag: airlockRadius }));
      const at = (d: number, lateral: number) => head
        .add(Pt.polar({ tur: dir, mag: d }))
        .add(Pt.polar({ tur: dir + s * 0.25, mag: lateral }));
      
      return [ head, at(ramp, Plunge.corridorFlare), at(len - ramp, Plunge.corridorFlare), at(len, 0) ];
      
    });
    
    return { dir, len, sides };
    
  };
  
  // Creates a living player holding a fresh pistol, replacing any entity under the same id
  const spawnPlayer = (flow: Flow, rng: Rng, entities: Obj<Entity>, inp: { id: string, name: string, pos: Pt, tur: number, buttons: Play.Buttons }) => {
    
    const pistol = Gun.fromInitialState({ flow, rng, kind: 'pistol', owner: inp.id });
    
    // A revived player keeps the look they had before going down or being compromised
    const prev: any = entities[inp.id];
    const look: number = typeof prev?.getLook === 'function' ? prev.getLook() : Math.floor(rng.nextFlt() * playerLooks.length);
    if (inp.buttons.act0) pistol.setTrigger(flow, true);
    entities[pistol.getId()] = pistol;
    
    replaceEntity(flow, entities, new Player({
      id: inp.id,
      ms: flow.ms,
      name: inp.name,
      anchorMs: flow.ms,
      pos: inp.pos,
      tur: inp.tur,
      buttons: { ...inp.buttons },
      guns: [ { id: pistol.getId(), kind: 'pistol' } ],
      activeInd: 0,
      health: Player.maxHealth,
      look,
      star: typeof prev?.getStar === 'function' ? prev.getStar() : false,
      aim: null,
      danceUntilMs: 0,
      grenadeReadyMs: 0,
      pillsUntilMs: 0,
      revive: null,
      slowUntilMs: null
    }));
    
  };
  
  // Everything that survives a stage change: living players and the guns they own
  const carryOver = (entities: Obj<Entity>) => {
    
    const carried: Obj<Entity> = {};
    for (const [ id, ent ] of Object.entries(entities))
      if (cl.isCls(ent, Player) || (cl.isCls(ent, Gun) && ent.getOwnerId() !== null))
        carried[id] = ent;
    return carried;
    
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
    CompromisedPlayer,
    DownedPlayer,
    WetMan,
    Glob,
    Pool,
    PregnantMan,
    AcidMan,
    Barrel,
    Grenade,
    Blast,
    Pickup,
    
    Gun,
    Ammo,
    
    Bullet,
    Cue
    
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
    maxSnapshotDurMs: 250,
    maxSnapshots: 20,
    
    state: { world: new World({
      name: 'zombies',
      stage: WaitingRoom.fromInitialState({
        flow: new Flow(0),
        players: { required: 4 }
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