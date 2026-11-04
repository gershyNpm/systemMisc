import '@gershy/clearing';
import gif from '../gif.ts';
import { TimeStep, type Flow } from './main.ts';
import { BaseCls } from '../wire/main.ts';
import type { Draw } from '../draw.ts';
import { rootFact } from '@gershy/disk';
import { Pt } from '../pt.ts';
import png from '../png.ts';

const lagMs = 750; // Delays events being sent to the TimeStep for this duration

(async () => {
  
  const dims = { l: 0, r: 500, u: 0, d: 500 };
  
  type Wall = 'l' | 'r' | 'u' | 'd';
  type State = {
    balls: Obj<Ball>
  };
  type Event = { ms: number } & [
    { op: 'ball.launch', id: string, colour: `#${string}` }
  ][number];
  type Rel = [
    { op: 'balls', balls: [ string, string ], distSqr: number },
    { op: 'walls', ball: string, wallDists: { [K in Wall]?: number } }
  ][number];
  
  class Ball extends BaseCls {
    
    public static readonly clsName = 'Ball';
    
    public state: {
      id: string,
      ms: number,
      r: number,
      colour: `#${string}`,
      anch: {
        ms: number,
        x: number,
        y: number,
        vel: { x: number, y: number }
      },
    };
    constructor(state: Ball['state']) {
      super();
      this.state = state;
    }
    
    public getVel() { return this.state.anch.vel; }
    public setVel(flow: { ms: number }, vel: { x: number, y: number }) {
      const { x, y } = vel;
      this.state.anch = { ms: flow.ms, ...this.getPos(flow), vel: { x, y } };
    }
    public setPos(flow: { ms: number }, pos: { x: number, y: number }) {
      Object.assign(this.state.anch, { ms: flow.ms, x: pos.x, y: pos.y });
    }
    
    public setAnch(anch: Ball['state']['anch']) { this.state.anch = anch; }
    
    public getPosOffset(flow: Flow | { ms: number }) {
      const { anch } = this.state;
      const sc = (flow.ms - anch.ms) * 0.001;
      return new Pt({ x: anch.vel.x * sc, y: anch.vel.y * sc });
    }
    
    public getPos(flow: Flow | { ms: number }) {
      return this.getPosOffset(flow).add(this.state.anch);
    }
    
    public getAnchVel() { return new Pt(this.state.anch.vel); }
    
    public render(flow: Flow | { ms: number }, draw: Draw) {
      draw.circle({ pos: this.getPos(flow), r: this.state.r, fill: this.state.colour });
    }
    
    encode() { return this.state; }
    
  };
  
  const registry = { Ball };
  type Registry = typeof registry;
  const timeStep = new TimeStep<Registry, State, Event, Rel>({
    registry,
    msPerTick: 10,
    seed: 'gershyTimeStepBallTest',
    state: { balls: {} },
    advance: (state, evt, rng, { Ball }) => {
      
      if (evt.op === 'ball.launch') state.balls[evt.id] = new Ball({
        id: evt.id,
        ms: evt.ms,
        r: rng.nextInt(10, 50),
        colour: evt.colour,
        anch: {
          ms: evt.ms,
          x: rng.nextInt(50, 450),
          y: rng.nextInt(50, 450),
          vel: Pt.polar({ tur: rng.nextFlt(), mag: 30 + rng.nextFlt() * 200 }).encode()
        }
      });
      
      if (evt.op === 'timeStep.rel') for (const rel of evt.rels) {
        
        if (rel.op === 'walls') {
          
          const ball = state.balls[rel.ball];
          
          const { wallDists } = rel;
          
          const vel = { ...ball.state.anch.vel };
          const pos = { ...ball.getPos(evt) };
          
          for (const [ wall, dist ] of Object.entries(wallDists)) {
            
            if (dist >= 0) continue;
            if (wall === 'l') { pos.x += Math.abs(dist); vel.x *= -1; }
            if (wall === 'r') { pos.x -= Math.abs(dist); vel.x *= -1; }
            if (wall === 'u') { pos.y += Math.abs(dist); vel.y *= -1; }
            if (wall === 'd') { pos.y -= Math.abs(dist); vel.y *= -1; }
            
          }
          
          ball.setPos(evt, pos);
          ball.setVel(evt, vel);
          
          continue;
          
        }
        
        if (rel.op === 'balls') {
          
          const balls = rel.balls.map(id => state.balls[id]);
          const [ ball0, ball1 ] = balls;
          const [ pos0, pos1 ] = balls.map(ball => ball.getPos(evt));
          const [ vel0, vel1 ] = balls.map(ball => new Pt(ball.state.anch.vel));
          
          const posOff = pos1.sub(pos0);
          const dist = posOff.len() || 1;
          
          // Decollision
          const penLen = (ball0.state.r + ball1.state.r) - dist; // The balls collide; this value must be positive (consider: add an epsilon value to ensure they're no longer touching??)
          const posOffMult = penLen / posOff.len();
          ball0.setPos(evt, pos0.add(posOff.mult(-0.5 * posOffMult)));
          ball1.setPos(evt, pos1.add(posOff.mult(+0.5 * posOffMult)));
          
          const velOff = vel1.sub(vel0);
          const posOffNorm = posOff.mult(1 / dist);
          const pointedVel = velOff.dot(posOffNorm);
          if (pointedVel < 0) { // Check if the balls are travelling towards each other (based on dot of velocity with offset) - they really always should be; the check is paranoia
            
            const [ elastic0, elastic1 ] = [ 1, 1 ]; // 1 = completely elastic, 0 = completely inelastic
            const [ mass0, mass1 ] = [ 1, 1 ];
            const [ inertia0, inertia1 ] = [ mass0, mass1 ].map(v => 1 / v);
            
            // Note the first multiplied term - the `1` cancels out the velocity entirely, and the
            // elastic component applies some amount of reflection
            const impact = (1 + elastic0 * elastic1) * pointedVel / (inertia0 + inertia1);
            
            ball0.setVel(evt, vel0.add(posOffNorm.mult(+1 * impact * inertia0)));
            ball1.setVel(evt, vel1.add(posOffNorm.mult(-1 * impact * inertia1)));
            
          }
          
          // ball0.setVel(evt, new Pt(ball0.state.anch.vel).mult(-1));
          // ball1.setVel(evt, new Pt(ball1.state.anch.vel).mult(-1));
          
          continue;
          
        }
        
        throw Error('ow');
        
      }
      
      return state;
      
    },
    relationCfg: {
      quality: 5,
      find: (flow, state, lastRels) => {
        
        const balls = lastRels
          ? [ ...new Set(lastRels.map(rel => rel.op === 'balls' ? rel.balls : rel.ball).flat(1).map(id => state.balls[id])) ]
          : state.balls[cl.toArr](v => v);
        
        const rels: Rel[] = [];
        
        for (const ball of balls) {
          
          const pos1 = ball.getPos(flow);
          const { r } = ball.state;
          
          // The distance between the ball and each wall - negative value indicates collision
          const wallDists = {
            l: -dims.l + (pos1.x - r),
            r: +dims.r - (pos1.x + r),
            u: -dims.u + (pos1.y - r),
            d: +dims.d - (pos1.y + r)
          }[cl.map](v => v >= 0 ? cl.skip : v);
          
          if (!wallDists[cl.empty]()) rels.push({ op: 'walls', ball: ball.state.id, wallDists });
          
        }
        
        for (let i = 1; i < balls.length; i++) { for (let j = 0; j < i; j++) {
          
          const ball1 = balls[i];
          const ball2 = balls[j];
          
          const pos1 = ball1.getPos(flow);
          const pos2 = ball2.getPos(flow);
          const distSqr = (pos1.x - pos2.x) ** 2 + (pos1.y - pos2.y) ** 2;
          const rSqr = (ball1.state.r + ball2.state.r) ** 2;
          if (distSqr < rSqr) rels.push({ op: 'balls', balls: [ ball1.state.id, ball2.state.id ], distSqr });
          
        }}
        
        return rels;
        
      }
    }
  });
  
  const evts: Event[] = [
    { ms:  400, op: 'ball.launch', id: 'aaa', colour: '#f00' },
    { ms:  800, op: 'ball.launch', id: 'bbb', colour: '#97f' },
    { ms: 1200, op: 'ball.launch', id: 'ccc', colour: '#ff0' },
    { ms: 1600, op: 'ball.launch', id: 'ddd', colour: '#f60' },
    { ms: 2500, op: 'ball.launch', id: 'eee', colour: '#f58' },
    { ms: 4000, op: 'ball.launch', id: 'fff', colour: '#0c8' },
    { ms: 5500, op: 'ball.launch', id: 'ggg', colour: '#08c' }
  ];
  
  await gif({
    fact: rootFact.kid([ import.meta.dirname, `balls.${lagMs.toString(10)}ms.gif` ]),
    w: 500,
    h: 500,
    quality: 1,
    fpsc: 20,
    frame: { ms: 10000, fn: ({ draw, ms }) => {
      
      const nextMs = ms;
      
      const perfMs = Date.now();
      while (evts.length && evts[0].ms <= (nextMs - lagMs)) {
        const evt = evts.shift()!;
        timeStep.processEvent(evt);
      }
      timeStep.tickUpToMs(nextMs);
      
      const state = timeStep.getState();
      for (const ball of state.balls[cl.toArr](v => v)) ball.render({ ms }, draw);
      
      console.log(`${ms} / 10000 (${Date.now() - perfMs})`);
      
    }}
  });
  
  const state = timeStep.getState();
  await png({
    fact: rootFact.kid([ import.meta.dirname, `balls.${lagMs.toString(10)}ms.png` ]),
    w: 500,
    h: 500,
    frame: draw => {
      for (const ball of state.balls[cl.toArr](v => v))
        ball.render({ ms: timeStep.getMs() }, draw);
    }
  });
  
})();