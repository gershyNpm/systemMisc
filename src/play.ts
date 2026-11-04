import type { Draw } from './util/draw.ts';
import { Pt } from './util/pt.ts';
import ticker from './util/ticker.ts';
import { TimeStep, TimeStepBeing, type Flow } from './util/timeStep/main.ts';

export type Registry = typeof registry;
export type Beings = { [K in keyof Registry]: InstanceType<Registry[K]> };
export const registry = (() => {
  
  type Force = { ms: number, durMs: null | number } & [
    
    // Pos
    { type: 'vel', x: number, y: number },
    { type: 'acl', x: number, y: number },
    { type: 'arc', r: number, initAng: number, vel: number },
    
    // Ang
    { type: 'angVel', vel: number },
    
  ][number];
  
  class Entity extends TimeStepBeing {
    
    static clsName = 'Entity';
    
    public state: {
      ms: number
    };
    
    constructor(inp: Entity['state']) {
      super();
      this.state = inp;
    }

    public renderClip(flow: Flow | { ms: number }, draw: Draw) {}
    
    public render(flow: Flow | { ms: number }, draw: Draw) {
      draw.circle({ x: 0, y: 0, r: 100 + 50 * Math.sin(Math.PI * 2 * flow.ms * 0.001), fill: '#f00' });
    }
    
    getJsonData() { return this.state; }
    
  };
  
  class Physical extends Entity {
    
    static clsName = 'Physical';
    
    public state: Entity['state'] & {
      anchorMs: number,
      pos: { x: number, y: number },
      rot: number
    };
    
    constructor(inp: Physical['state']) {
      super(inp);
      this.state = inp;
    }
    
    protected getForces(flow: Flow | { ms: number }): Force[] { return []; }
    
    protected calcForce(flow: Flow | { ms: number }, force: Force): { x: number, y: number, rot: number } {
      
      const durSc = Math.max(flow.ms - force.ms, force.durMs ?? -Infinity) * 0.001;
      
      if (durSc <= 0) return { x: 0, y: 0, rot: 0 };
      
      if (force.type === 'vel') return { x: force.x * durSc, y: force.y * durSc, rot: 0 };
      
      if (force.type === 'acl') {
        
        const acl = 0.5 * durSc * durSc;
        return { x: force.x * acl, y: force.y * acl, rot: 0 };
        
      }
      
      if (force.type === 'arc') {
        
        const { initAng, r, vel } = force;
        const { x, y } = Pt.add([
          Pt.polar({ ang: initAng + vel * durSc, mag: r }), // Circular motion around the origin
          Pt.polar({ ang: initAng + 0.5, mag: r })          // Constant offset by the circle radius so at t=0 the force is { x: 0, y: 0
        ]);
        return { x, y, rot: 0 };
        
      }
      
      if (force.type === 'angVel') return { x: 0, y: 0, rot: force.vel * durSc };
      
      throw Error('ow')[cl.mod]({ force });
      
    }
    
    public getVals(flow: Flow | { ms: number }) { // TODO: surely there's a better term than "vals" to encompass position + rotation
      
      const { anchorMs } = this.state;
      
      let pos = new Pt(this.state.pos);
      let rot = this.state.rot;
      
      for (const force of this.getForces(flow)) {
        
        const f = this.calcForce(flow, force);
        pos = pos.add(f);
        rot += f.rot;
        
        // Subtract any part of the force which predates our anchor; that offset from the force is
        // already baked into the anchor!
        if (force.ms < anchorMs) {
          const f = this.calcForce({ ms: anchorMs }, force);
          pos = pos.sub(f);
          rot -= f.rot;
        }
        
      }
      
      return { pos, rot };
      
    }
    
    public anchor(flow: Flow | { ms: number }) {
      
      const { pos, rot } = this.getVals(flow);
      Object.assign(this.state, {
        anchorMs: flow.ms,
        pos: { ...pos },
        rot
      });
      
    }
    
    public getColour(): `#${string}` { return '#f00'; }
    
    public render(flow: Flow | { ms: number }, draw: Draw, vals = this.getVals(flow)) {
      draw.circle({ ...vals.pos, r: 50, fill: this.getColour() });
      draw.line({
        pt0: vals.pos,
        pt1: vals.pos.add(Pt.polar({ ang: vals.rot, mag: 100 })),
        line: this.getColour()
      });
    }
    
  };
  
  class Obstacle extends Physical {
    
    static clsName = 'Obstacle';
    
    public state: Physical['state'] & {
      rot: number,
      bound: { type: 'circle', r: number }
    };
    
    constructor(inp: Obstacle['state']) {
      super(inp);
      this.state = inp;
    }
    
    public getColour(): `#${string}` { return '#000'; }
    
    public render(flow: Flow | { ms: number }, draw: Draw, vals = this.getVals(flow)) {
      
      const { bound } = this.state;
      draw.circle({ ...vals.pos, r: bound.r, fill: this.getColour() }); // TODO: non-circle bounds
      
    }
    
  };
  
  class Player extends Physical {
    
    static clsName = 'Player';
    
    public state: Physical['state'] & {
      name: string,
      buttons: { [K in Play.Button]: boolean }
    };
    constructor(inp: Player['state']) {
      super(inp);
      this.state = inp;
    }
    
    protected getBaseStats() { return {
      speed: 5,
      turnSpeed: 0.5,
      visionAngle: 0.3,
      visionDistance: 120
    }; }

    protected getForces(flow: Flow | { ms: number; }) {
      
      const { buttons } = this.state;
      const turn = +(buttons.rotR1 || buttons.rotR2) - +(buttons.rotL1 || buttons.rotL2);
      
      const { speed, turnSpeed: baseTurnSpeed } = this.getBaseStats();
      const turnSpeed = baseTurnSpeed * (false ? 1
        : (buttons.rotL2 || buttons.rotR2) ? 0.1
        : 1
      );
      
      // Movement penalties; strafing is slower; backwards is slowest
      const walkVelMult = false                                ? 1
        : this.state.buttons.dirD                              ? 0.3
        : (this.state.buttons.dirR || this.state.buttons.dirL) ? 0.55
        :                                                        1;
      
      // Direction of movement based on facing direction and buttons
      const walkVel = new Pt({
        x: +this.state.buttons.dirU - 1.0 * +this.state.buttons.dirD,
        y: +this.state.buttons.dirR - 1.0 * +this.state.buttons.dirL
      })
        .norm()                     // fixed-length
        .mult(speed * walkVelMult)          // apply walk vel mult
        .rotateBy(this.state.rot);  // Align with rotation
      
      const walkVelLen = walkVel.len();
      
      const forces: Force[] = [];
      
      if (walkVelLen) {
        
        if (turn) {
          
          const secsPerTurn = 1 / turnSpeed;
          const circum = secsPerTurn * walkVelLen;
          const r = circum / (2 * Math.PI);
          const initAng = this.state.rot - turn * 0.25; // Quarter turn offset in the direction of turning
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'arc', r, initAng, vel: turn * turnSpeed });
          
        } else {
          
          forces.push({ ms: this.state.anchorMs, durMs: null, type: 'vel', ...walkVel })
          
        }
        
      }
      
      if (turn) {
        forces.push({ ms: this.state.anchorMs, durMs: null, type: 'angVel', vel: turn * turnSpeed });
      }
      
      return forces;
      
    }
    
    public renderClip(flow: Flow | { ms: number }, draw: Draw) {
      const { visionAngle, visionDistance } = this.getBaseStats();
      const { pos, rot } = this.getVals(flow);
      draw.cone({ x: pos.x, y: pos.y, dir: rot, ang: visionAngle, r: visionDistance });
      draw.circle({ x: pos.x, y: pos.y, r: 10 });
    }
    
    public render(flow: Flow | { ms: number }, draw: Draw, vals = this.getVals(flow)) {
      draw.circle({ ...vals.pos, r: 0.3, fill: this.getColour() });
      draw.line({
        pt0: vals.pos,
        pt1: vals.pos.add(Pt.polar({ ang: vals.rot, mag: 30 })),
        line: this.getColour(),
        lineW: 0.1
      });
    }
    
  };
  
  return {
    Entity,
    Physical,
    Obstacle,
    Player
  } satisfies Obj<new (...args: any[]) => TimeStepBeing>;
  
})();

export namespace Play {
  
  export type Bound = never
    | { type: 'circle', ext: number }
    | { type: 'square', ext: number };
  
  export type State = {
    entities: Obj<Beings['Entity']>
  };
  export type Rel = null;
  
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
  
};

export default () => {
  
  const pendingEvents: Play.Event[] = [];
  
  const { Obstacle } = registry;
  const playTimeStep = new TimeStep<Registry, Play.State, Play.Event, Play.Rel>({
    seed: 1000,
    registry,
    msPerTick: 9, // Less than 2 ticks per frame at 60fpsc (which is 16.666mspf)
    state: {
      entities: {
        
        [`${Obstacle.clsName}/aaaaaaaa`]: new Obstacle({
          ms: 0,
          anchorMs: 0,
          pos: { x: 0, y: 0 },
          rot: 0,
          bound: { type: 'circle', r: 50 }
        })
        
      }
    },
    advance: (state, evt, rng, { Player }) => {
      
      if (evt.op === 'player.launch') state.entities[`${Player.clsName}/${evt.session.id}`] = new Player({
        ms: evt.ms,
        name: evt.name,
        anchorMs: evt.ms,
        pos: { ...Pt.polar({ ang: rng.nextFlt(), mag: 20 + rng.nextInt(0, 20) }) },
        rot: rng.nextFlt(),
        buttons: ([ 'dirL', 'dirR', 'dirU', 'dirD', 'rotL1', 'rotL2', 'rotR1', 'rotR2', 'act0', 'act1', 'act2', 'act3', 'act4', 'act5', 'act6' ] as const)[cl.toObj](v => [ v, false ])
      });
      
      if (evt.op === 'player.cancel') delete state.entities[`${Player.clsName}/${evt.session.id}`];
      
      if (evt.op === 'player.key') {
        
        const ent = state.entities[cl.at](`${Player.clsName}/${evt.session.id}`, null) as null | Beings['Player'];
        if (!ent) return;
        
        ent.anchor(evt);
        ent.state.buttons[evt.btn.slice(1)] = evt.btn[0] === '+';
        
      }
      
    }
  });
  
  let offsetMs = 0;
  const playTicker = ticker(60, ({ ms }) => {
    
    const events = [ ...pendingEvents ].sort((evt0, evt1) => evt0.ms - evt1.ms);
    pendingEvents.length = 0;
    
    for (const event of events) playTimeStep.processEvent(event);
    
    playTimeStep.tickUpToMs(Math.max(0, (ms + offsetMs) - 2));
    
  });
  
  return {
    timeStep: playTimeStep,
    ticker: playTicker,
    setOffsetMs: (oMs: number) => offsetMs = oMs,
    getOffsetMs: ()            => offsetMs,
    addEvent: (event: Play.Event) => pendingEvents.push(event)
  };
  
};