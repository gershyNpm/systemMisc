import type { Draw, Look } from './util/draw.ts';
import { Pt } from './util/pt.ts';
import type { Rng } from './util/rng.ts';
import ticker from './util/ticker.ts';
import { TimeStep, type Flow, type TimeStepInp } from './util/timeStep/main.ts';
import { BaseCls as WireBaseCls, type Registry as WireRegistry } from './util/wire/main.ts';

export namespace Play {
  
  export type Force = { ms: number, durMs: null | number } & [
    
    // Pos
    { type: 'vel', x: number, y: number },
    { type: 'acl', x: number, y: number },
    { type: 'arc', r: number, initAng: number, vel: number },
    
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
    { type: 'sat', ents: [ string, string ], pen: number, axis: { x: number, y: number } },
    { type: 'waitingRoomLaunch', ents: [] },
    { type: 'ent', entId: string, ms: number, inp: { type: string } & Obj<Json> }
  ][number];
  
  // Subset of `Rel` which are single-entity-specific - generated and advanced by the same entity
  export type EntityRel = Rel & { type: 'ent', inp: [
    { type: 'bullet', ms: number }
  ][number] };
  
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
  
  export type RenderOp = { z: number, fn: () => void };
  
  export type Event = ClientEvent & { session: { id: string } };
  export type AckEvent = Event & { ack?: { id: string, clientUtcMs: number, serverUtcMs: number, resolvedUtcMs: number } };
  
  export type ClsRegistry = typeof registry;
  export type Registry = { [K in keyof ClsRegistry]: InstanceType<ClsRegistry[K]> };
  
};

type Tfm = { pos: Pt, tur: number };
export const registry = (() => {
  
  abstract class Bound extends WireBaseCls {
    
    public static readonly clsName: string = 'Bound';
    
    abstract axes():  Pt[];
    abstract proj(normAxis: Pt): readonly [ number, number ]; // Note the projection interval is ordered, i.e. `interval[0] <= interval[1]`
    abstract render(tfm: Tfm, draw: Draw, look: Look);
    
  };
  class CircleBound extends Bound {
    
    public static readonly clsName: string = 'CircleBound';
    
    protected r: number;
    constructor(inp: { r: number }) {
      super();
      this.r = inp.r;
    }
    encode() { return { r: this.r }; }
    
    axes()             { return []; }
    proj(normAxis: Pt) { return [ -this.r, +this.r ] as const; }
    render(tfm: Tfm, draw: Draw, look: Look) {
      draw.circle({ ...tfm, r: this.r, ...look });
    }
    
  };
  class RectBound extends Bound {
    
    public static readonly clsName: string = 'RectBound';
    
    protected w: number;
    protected h: number;
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
    render(tfm: Tfm, draw: Draw, look: Look) {
      draw.rect({ ...tfm, w: this.w, h: this.h, ...look });
    }
    
  };
  class PolygonBound extends Bound {
    
    public static readonly clsName: string = 'PolygonBound';
    
    public static project(normAxis: Pt, pts: Pt[]) {
      
      let min = Infinity;
      let max = -Infinity;
      for (const pt of pts) {
        const proj = pt.dot(normAxis);
        if (proj < min) min = proj;
        if (proj > max) max = proj;
      }
      
      return [ min, max ] as const;
      
    }
    
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
    proj(normAxis: Pt) { return PolygonBound.project(normAxis, this.cornersRh); }
    render(tfm: Tfm, draw: Draw, look: Look) {
      
      draw.polygon({
        pts: Pt.rotate(this.cornersRh, tfm.tur).map(pt => pt.add(tfm.pos)),
        ...look
      });
      
    }
    
  };
  
  class Entity extends WireBaseCls {
    
    public static readonly clsName: string = 'Entity';
    
    protected state: { ms: number };
    
    constructor(state: Entity['state']) {
      super();
      this.state = state;
    }
    
    public getRelationGroups(flow: Flow | { ms: number }): readonly Play.RelationGroup[] { return []; }
    
    public getRelations(flow: Flow | { ms: number }): Play.EntityRel[] {
      
      return [];
      
    }
    
    public advanceRelation(world: World, flow: Flow | { ms: number }, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRel['inp']) {}
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {}
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw): Play.RenderOp[] {
      
      return [ { z: 0, fn: () => {
        draw.text({ x: 0, y: 0, tur: flow.ms * 0.001, text: (this as any).constructor.clsName, fontSize: 1, fill: '#f00' })
      }}];
      
    }
    
    encode() { return this.state; }
    
  };
  
  class World extends WireBaseCls {
    
    public static readonly clsName: string = 'World';
    
    protected state: { name: string, stage: Stage };
    
    constructor(state: World['state']) {
      super();
      this.state = state;
    }
    public encode() { return this.state; }
    
    public getStage(flow: Flow | { ms: number }) { return this.state.stage; }
    public setStage(stage: Stage)                { this.state.stage = stage; }
    
    public getRelations(flow: Flow | { ms: number }, lastRels: null | Play.Rel[]): Play.Rel[] {
      
      return this.getStage(flow).getRelations(flow, lastRels).rels;
      
    }
    
    public advance(rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      this.getStage(evt).advance(this, rng, evt);
      
    }
    
  };
  class Stage extends WireBaseCls {
    
    public static readonly clsName: string = 'Stage';
    
    protected state: {
      ms: number,
      entities: Obj<Entity>
    };
    constructor(state: Stage['state']) {
      super();
      this.state = state;
    }
    encode() { return this.state; }
    
    public getEntities(flow: Flow | { ms: number }) { return this.state.entities; }
    
    public getRelations(flow: Flow | { ms: number }, lastRels: null | Play.Rel[]) {
      
      const ents = this.getEntities(flow);
      const entities = lastRels
        ? new Set(lastRels[cl.map](rel => ((rel as { ents?: string[] }).ents ?? []).map(id => ents[id])).flat(1))
        : (function*() { for (const k in ents) yield ents[k] })();
      
      const relGroups: { [K in Play.RelationGroup]?: Entity[] } = {};
      const rels: Play.Rel[] = [];
      
      for (const ent of entities) {
        
        for (const timeRel of ent.getRelations(flow))
          rels.push(timeRel);
        
        for (const group of ent.getRelationGroups(flow))
          (relGroups[group] ??= []).push(ent)
        
      }
      
      const { physics = [] } = relGroups;
      (() => {
        
        const len = physics.length;
        for (let i = 1; i < len; i++) { for (let j = 0; j < i; j++) {
          
          const phys0 = physics[i] as Play.Registry['Physical'];
          const phys1 = physics[j] as Play.Registry['Physical'];
          
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
    
    public advanceRelation(world: World, flow: Flow | { ms: number }, entities: Obj<Entity>, rng: Rng, rel: Play.Rel) {
      
      if (rel.type === 'sat') {
        
        const [ ent0, ent1 ] = rel.ents.map(id => entities[cl.at](id, null) as null | Play.Registry['Physical']); // I'm preeetty sure that if `relationCfg.find` saw an entity id, that id is guaranteed to exist when we process the timeStep.rel event here...
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
        
        ent.advanceRelation(world, flow, entities, rng, (rel as Play.EntityRel).inp);
        
      }
      
    }
    
    public advance(world: World, rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      const entities = this.getEntities(evt);
      
      if (evt.op === 'timeStep.rel')
        for (const rel of evt.rels)
          this.advanceRelation(world, evt, entities, rng, rel);
      
      if (evt.op === 'player.key' && entities[cl.has](`${Player.clsName}/${evt.session.id}`)) {
        
        const ent = entities[`${Player.clsName}/${evt.session.id}`] as Play.Registry['Player'];
        
        const btn = evt.btn.slice(1) as Play.Button;
        const act = evt.btn[0] === '+';
        ent.advanceButton(evt, rng, btn, act);
        
      }
      
      return entities;
      
    }
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {}
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw): Play.RenderOp[] {
      
      return [ { z: 0, fn: () => {
        draw.text({ x: 0, y: 0, tur: flow.ms * 0.001, text: (this as any).constructor.clsName, fontSize: 1, fill: '#f00' })
      }}];
      
    }
    
  };
  class WaitingRoom extends Stage {
    
    public static readonly clsName: string = 'WaitingRoom';
    
    public static fromInitialState(state: Omit<WaitingRoom['state'], 'entities'>) {
      
      const wallBound = new PolygonBound({ cornersRh: [
        new Pt({ x: +2, y:   0 }),
        new Pt({ x: -1, y: +50 }),
        new Pt({ x: -1, y: -50 }),
      ]});
      const mysteryBound = new PolygonBound({
        cornersRh: (3)[cl.toArr](v => Pt.polar({ tur: v / 3, mag: 10 }))
      });
      
      return new WaitingRoom({
        ...state,
        entities: {
          
          ...(5)[cl.toObj](v => {
            
            const id = `${Obstacle.clsName}/wall${v}`;
            return [ id, new Obstacle({
              id,
              ms: 0,
              anchorMs: 0,
              pos: Pt.polar({ tur: v / 5, mag: 30 }),
              tur: v / 5,
              bound: wallBound,
              forces: []
            })];
            
          }),
          
          [`${Obstacle.clsName}/mystery0`]: new Obstacle({
            id: `${Obstacle.clsName}/mystery0`,
            ms: 0,
            anchorMs: 0,
            pos: new Pt(),
            tur: 0,
            bound: mysteryBound,
            forces: [ { ms: 0, durMs: null, type: 'turVel', amt: 0.06 } ]
          }),
          
          [`${Obstacle.clsName}/mystery1`]: new Obstacle({
            id: `${Obstacle.clsName}/mystery1`,
            ms: 0,
            anchorMs: 0,
            pos: new Pt(),
            tur: 0,
            bound: mysteryBound,
            forces: [ { ms: 0, durMs: null, type: 'turVel', amt: -0.06 } ]
          }),
          
        }
      });
      
    }
    
    protected state: Stage['state'] & {
      players: { total: number, required: number, fulfilledMs: null | number, delayLaunchMs: number }
    };
    
    constructor(state: WaitingRoom['state']) { super(state); this.state = state; }
    
    public getRelations(flow: Flow | { ms: number }, lastRels: null | Play.Rel[]) {
      
      const r = super.getRelations(flow, lastRels);
      
      const { fulfilledMs, delayLaunchMs }  = this.state.players;
      if (flow.ms > (fulfilledMs ?? Infinity) + delayLaunchMs)
        r.rels.push({ type: 'waitingRoomLaunch', ents: [] })
      
      return r;
      
    }
    
    public advanceRelation(world: World, flow: Flow | { ms: number }, entities: Obj<Entity>, rng: Rng, rel: Play.Rel) {
      
      super.advanceRelation(world, flow, entities, rng, rel);
       
      if (rel.type === 'waitingRoomLaunch') {
        
        this.state.players.fulfilledMs = null;
        this.state.players.required += 100;
        
        const [ , wall1 ] = this.state.entities[cl.find](v => cl.isCls(v, Obstacle)) as [ string, Obstacle ];
        
        // Open up a wall...
        wall1.reanchor<Obstacle['state']>(flow, state => {
          state.forces.push({ ms: flow.ms, durMs: 5000, type: 'vel', ...state.pos.norm().mult(1.5).encode() });
        });
        
        world.setStage(new Plunge({
          ms: flow.ms,
          entities: this.state.entities
        }));
        
      }
      
    }
    
    public advance(world: World, rng: Rng, evt: Play.Event | { ms: number, op: 'timeStep.rel', rels: Play.Rel[] }) {
      
      const entities = super.advance(world, rng, evt);
      
      if (evt.op === 'player.launch' && this.state.players.total < this.state.players.required) {
        
        this.state.players.total++;
        
        const tur = rng.nextFlt();
        entities[`${Player.clsName}/${evt.session.id}`] = new Player({
          id: `${Player.clsName}/${evt.session.id}`,
          ms: evt.ms,
          name: evt.name,
          anchorMs: evt.ms,
          pos: Pt.polar({ tur, mag: 15 }),
          tur: tur + 0.5,
          buttons: ([ 'dirL', 'dirR', 'dirU', 'dirD', 'turL1', 'turL2', 'turR1', 'turR2', 'mod0', 'act0', 'act1', 'act2', 'act3', 'act4', 'act5', 'act6' ] as const)[cl.toObj](v => [ v, false ]),
          shootMs: null,
          bulletRearmMs: 0
        });
        
        if (this.state.players.total === this.state.players.required) this.state.players.fulfilledMs = evt.ms;
        
      }
      
      if (evt.op === 'player.cancel') {
        
        this.state.players.total--;
        
        delete entities[`${Player.clsName}/${evt.session.id}`];
        
      }
      
      return entities;
      
    }
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {
      draw.circle({ pos: new Pt(), r: 4 }); // Reveal the center counter
    }
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw) {
      
      return [ { z: 1, fn: () => {
        
        const { players } = this.state;
        const ms = players.fulfilledMs
          ? Math.max(0, (players.fulfilledMs + players.delayLaunchMs) - flow.ms)
          : null;
          
        draw.text({
          x: 0, y: ms ? -0.75 : 0, tur: 0,
          text: `${players.total} / ${players.required}`,
          fontSize: 1.2,
          align: 'center',
          fill: '#f55'
        });
        if (ms) draw.text({
          x: 0, y: 0.75, tur: 0,
          text: ms.toString(10),
          fontSize: 1.2,
          align: 'center',
          fill: '#f55'
        });
        
      }}];
      
    }
    
  };
  class Plunge extends Stage {
    
    public static readonly clsName: string = 'Plunge';
    
    protected state: Stage['state'] & {
    };
    constructor(state: Plunge['state']) { super(state); this.state = state; }
    
  };
  
  class Staged extends Entity {
    
    public static readonly clsName: string = 'Staged';
    
    protected state: Entity['state'] & { id: string };
    constructor(state: Staged['state']) { super(state); this.state = state; }
    
    public getId() { return this.state.id; }
    
  };
  
  abstract class Physical extends Staged {
    
    public static readonly clsName: string = 'Physical';
    
    protected state: Staged['state'] & {
      anchorMs: number,
      pos: Pt,
      tur: number
    };
    
    constructor(state: Physical['state']) {
      super(state);
      this.state = state;
    }
    
    protected getForces(flow: Flow | { ms: number }): Play.Force[] { return []; }
    
    protected calcForce(flow: Flow | { ms: number }, force: Play.Force): { x: number, y: number, tur: number } {
      
      const durSc = Math.min(flow.ms - force.ms, force.durMs ?? Infinity) * 0.001;
      
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
    
    public abstract getBound(flow: Flow | { ms: number }): Bound;
    
    public canCollide(phys: Physical) { return true; }
    
    public advanceCollide(inp: { world: World, flow: Flow | { ms: number }, rng: Rng, entities: Obj<Entity>, phys: Physical }) {}
    
    public getWeight(flow: Flow | { ms: number }) { return 1; }
    
    public getRelationGroups(flow: Flow | { ms: number }): Play.RelationGroup[] { return [ 'physics' ]; }
    
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
    
    public reanchor<S extends Physical['state']>(flow: Flow | { ms: number }, fn: (state: S) => void = () => {}) {
      
      const { pos, tur } = this.getTransform(flow);
      this.state.anchorMs = flow.ms;
      this.state.pos = pos;
      this.state.tur = tur;
      fn(this.state as S);
      
    }
    
    public getColour(flow: Flow | { ms: number }): `#${string}` { return '#f00'; }
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      
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
    
    public static readonly clsName: string = 'Obstacle';
    
    protected state: Physical['state'] & {
      bound: Bound,
      tur: number,
      forces: Play.Force[]
    };
    
    constructor(state: Obstacle['state']) {
      super(state);
      this.state = state;
    }
    
    encode() { return this.state; }
    
    public canCollide(phys: Physical) { return !cl.isCls(phys, Obstacle); }
    
    public getForces() { return this.state.forces; }
    
    public getWeight() { return Infinity; }
    
    public getBound() { return this.state.bound; }
    
    public getColour(): `#${string}` { return '#000'; }
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        const { bound } = this.state;
        bound.render(tfm, draw, { fill: this.getColour() });
        
      }}];
      
      
    }
    
  };
  
  abstract class Member extends Physical {
    
    public static readonly clsName: string = 'Member';
    
  };
  
  class Player extends Member {
    
    public static readonly clsName: string = 'Player';
    
    protected static bound = new CircleBound({ r: 0.3 });
    
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
    
    protected getBaseStats() { return {
      posSpeed: 5,
      turSpeed: 0.5,
      visionSweep: 0.18,
      visionRange: 120
    }; }
    
    protected getForces(flow: Flow | { ms: number; }) {
      
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
        
        const tur = +buttons.turR1 - +buttons.turL1;
        
        const { posSpeed: basePosSpeed, turSpeed: baseTurSpeed } = this.getBaseStats();
        const posSpeed = basePosSpeed * (1 + (+buttons.mod0 * +1.0));
        const turSpeed = baseTurSpeed * (1 + (+buttons.mod0 * -0.25));
        
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
          .mult(posSpeed * walkVelMult) // apply walk vel mult
          .addTur(this.state.tur);      // Align with rotation
        
        const walkVelLen = walkVel.len();
        if (walkVelLen) {
          
          if (tur) {
            
            const secsPerTurn = 1 / turSpeed;
            const circum = secsPerTurn * walkVelLen;
            const r = circum / (2 * Math.PI);
            const initAng = this.state.tur - tur * 0.25; // Quarter turn offset in the direction of turning
            
            // TODO: this seems buggy for anything other than pure forward motion
            forces.push({ ms: this.state.anchorMs, durMs: null, type: 'arc', r, initAng, vel: tur * walkPol * turSpeed });
            
          } else {
            
            forces.push({ ms: this.state.anchorMs, durMs: null, type: 'vel', ...walkVel })
            
          }
          
        }
        
        if (tur) {
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'turVel', amt: tur * turSpeed });
        }
        
      })();
      
      return forces;
      
    }
    
    public getRelationGroups(flow: Flow | { ms: number }): Play.RelationGroup[] {
      return [ ...super.getRelationGroups(flow), 'player' ];
    }
    
    public advanceButton(flow: Flow | { ms: number }, rng: Rng, button: Play.Button, act: boolean) {
      
      this.reanchor<Player['state']>(flow, state => {
        
        state.buttons[button] = act;
        if (button === 'act0') this.state.shootMs = act ? flow.ms : null;
        
      });
      
    }
    
    public getRelations(flow: Flow | { ms: number; }): Play.EntityRel[] {
      
      const rels: Play.EntityRel[] = [];
      
      if (this.state.shootMs !== null) {
        
        const msPerBullet = 150;
        const firstBulletMs = Math.max(this.state.shootMs, this.state.bulletRearmMs);
        for (let ms = firstBulletMs; ms <= flow.ms; ms += msPerBullet) {
          rels.push({ type: 'ent', entId: this.state.id, ms, inp: {
            type: 'bullet',
            ms
          }});
        }
        
      }
      
      return rels;
      
    }
    
    public advanceRelation(world: World, flow: Flow | { ms: number }, entities: Obj<Entity>, rng: Rng, rel: Play.EntityRel['inp']): void {
      
      if (rel.type === 'bullet') {
        
        const msPerBullet = 150;
        
        const bulletId = `${Bullet.clsName}/${rng.nextFlt().toString(36).slice(2)}`
        const tfm = this.getTransform({ ms: rel.ms });
        
        entities[bulletId] = new Bullet({
          id: bulletId,
          ms: rel.ms,
          anchorMs: rel.ms,
          pos: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 0.5 })),
          tur: tfm.tur,
          vel: 10
        });
        
        this.state.bulletRearmMs = Math.max(this.state.bulletRearmMs, rel.ms + msPerBullet);
        
      }
      
    }
    
    public getBound() { return Player.bound; }
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {
      const { visionSweep, visionRange } = this.getBaseStats();
      const { pos, tur } = this.getTransform(flow);
      draw.cone({ pos, tur, sweep: visionSweep, r: visionRange });
      draw.circle({ pos, r: 2 });
    }
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        const colour = this.getColour(flow);
        this.getBound().render(tfm, draw, { fill: colour });
        
        draw.line({
          pt0: tfm.pos,
          pt1: tfm.pos.add(Pt.polar({ tur: tfm.tur, mag: 20 })),
          line: colour,
          lineW: 0.1
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
  
  class Bullet extends Physical {
    
    public static readonly clsName: string = 'Bullet';
    
    protected static bulletBound = new CircleBound({ r: 0.1 });
    
    protected state: Physical['state'] & {
      vel: number
    };
    constructor(state: Bullet['state']) {
      super(state);
      this.state = state;
    }
    
    public canCollide(phys: Physical) { return !cl.isCls(phys, Bullet); }
    
    public advanceCollide(inp: { world: World, flow: Flow | { ms: number }, rng: Rng, entities: Obj<Entity>, phys: Physical }) {
      
      // TODO: HEEERE
      // - enough berth from the player?
      // - how to handle future-timed events (like an entity expiry...)
      //   - I think TimeStep can offer a registry of future events - they don't get stepped to,
      //     but they get processed when they're reached. Registry of such events is deterministic,
      //     maybe really `World` should implement this via timeStep.rel?? But the main thing that
      //     would be lacking is an ability to emit a definitively-timed, no-binary-search-required
      //     timeStep.rel event... it's doable I think!! It's the `setTimeout` of TimeStep - maybe
      //     "timeStep.moment"?
      if (globalThis.zzz) console.log('ZZZ COLLIDE', { p0: this, p1: inp.phys });
      delete inp.entities[this.state.id];
      
    }
    
    public getBound(flow: Flow | { ms: number }) { return Bullet.bulletBound; }
    
    public getColour(flow: Flow | { ms: number }): `#${string}` { return '#a00'; }
    
    public getRenderOps(flow: Flow | { ms: number }, draw: Draw, tfm = this.getTransform(flow)) {
      
      return [ { z: 0, fn: () => {
        
        this.getBound(flow).render(tfm, draw, { fill: this.getColour(flow) });
        
      }}];
      
    }
    
    public getForces(flow: Flow | { ms: number; }): Play.Force[] {
      
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
    Stage,
    WaitingRoom,
    Plunge,
    
    Physical,
    Obstacle,
    Player,
    Bullet
    
  } satisfies WireRegistry;
  for (const k in classes) if (k !== classes[k].clsName) throw Error('clsName missing')[cl.mod]({ k })
  
  return classes;
  
})();

export default (signals?: TimeStepInp<any, any, any, any>['signals']) => {
  
  const pendingEvents: Play.Event[] = [];
  
  const { World, WaitingRoom } = registry;
  const playTimeStep = new TimeStep<Play.ClsRegistry, Play.State, Play.Event, Play.Rel>({
    
    seed: 'gershy misc zombies fun times',
    registry,
    msPerTick: 9, // 60fpsc is 16.666mspf - 9mspt is just less than 2 ticks per 60fpsc frame
    minMsPerTick: 1.5,
    
    maxEventsPerSnapshot: 100,
    maxSnapshotsToStore: 50,
    
    state: { world: new World({
      name: 'zombies',
      stage: WaitingRoom.fromInitialState({ ms: 0, players: { total: 0, required: 3, fulfilledMs: null, delayLaunchMs: 1000 * 10 } })
    }) },
    advance: (state, evt, rng) => state.world.advance(rng, evt),
    relationCfg: {
      quality: 4,
      find: (flow, state, lastRels) => state.world.getRelations(flow, lastRels)
    },
    
    ...(signals && { signals })
    
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
    getPendingEvents: ()                   => pendingEvents,
    setPendingEvents: (evts: Play.Event[]) => { pendingEvents.length = 0; pendingEvents.push(...evts); },
    setPatienceMs:    (pMs: number)        => patienceMs = pMs,
    setOffsetMs:      (oMs: number)        => offsetMs = oMs,
    getOffsetMs:      ()                   => offsetMs,
    addEvent:         (event: Play.Event)  => pendingEvents.push(event)
  };
  
};