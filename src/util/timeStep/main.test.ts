import '@gershy/clearing';
import { assertEqual, testRunner } from '../../../build/utils.test.ts';
import { entry } from '@gershy/entry';
import { TimeStep } from './main.ts';
import { Rng } from '../rng.ts';

const codec = { type: 'rec', props: {
  reg:    { type: 'str', map: (str: string) => new RegExp(str) },
  effort: { type: 'enum', opts: [ 0, 1, 2, 3, 4, 5, 6 ] }
}} as const;
entry({ name: 'test', codec, inp: { reg: '^', effort: 0 }, fn: async (logger, { reg, effort, ...inp }) => {
  
  // Type testing
  (async () => {
    
    type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
    
    type Tests = {
      1: Enforce<{ x: 'y' }, { x: 'y' }>,
    };
    if (0) ((v?: Tests) => void 0)();
    
  })();
  
  const getStackTimestep = (maxSnapshotsToStore = 50) => {
    
    type State = { stack: string[] };
    type Event = { ms: number } & [
      { op: 'push', item: string },
      { op: 'pop' }
    ][number];
    
    return new TimeStep<{}, State, Event, Obj<Json>>({
      registry: {},
      msPerTick: 1000 / 60,
      maxEventsPerSnapshot: 3,
      maxSnapshotsToStore,
      seed: 0,
      state: { stack: [] } as { stack: string[] },
      advance: (state, evt) => {
        
        if (evt.op === 'push') state.stack.push(evt.item);
        if (evt.op === 'pop')  state.stack.pop();
        return state;
        
      },
      relationCfg: {
        quality: 4,
        find: () => []
      }
    });
    
  };
  
  // A ball flies toward a wall (free rel: "hit", timing found by binary search) while fuses
  // (timed rels: "fuse", exact timing) can kill it
  const getBallTimeStep = (inp: { vx: number, wall: number, fuses: number[] }) => {
    
    type State = { x0: number, t0: number, vx: number, alive: boolean, fuses: number[], log: { ms: number, types: string[] }[] };
    type Event = { ms: number, op: 'none' };
    type Rel = { type: 'hit', ms?: undefined } | { type: 'fuse', ms: number };
    
    const getX = (state: State, ms: number) => state.x0 + state.vx * (ms - state.t0) * 0.001;
    
    return new TimeStep<{}, State, Event, Rel>({
      registry: {},
      msPerTick: 10,
      seed: 0,
      state: { x0: 0, t0: 0, vx: inp.vx, alive: true, fuses: inp.fuses, log: [] },
      advance: (state, evt) => {
        
        if (!('rels' in evt)) return state;
        
        state.log.push({ ms: evt.ms, types: evt.rels.map(r => r.type) });
        for (const rel of evt.rels) {
          if (rel.type === 'hit')  Object.assign(state, { x0: Math.min(getX(state, evt.ms), inp.wall), t0: evt.ms, vx: -state.vx });
          if (rel.type === 'fuse') Object.assign(state, { alive: false, vx: 0, fuses: state.fuses.filter(f => f !== rel.ms) });
        }
        return state;
        
      },
      relationCfg: { quality: 4, find: (flow, state) => [
        ...state.fuses.map(ms => ({ type: 'fuse' as const, ms })),
        ...(state.alive && getX(state, flow.ms) >= inp.wall ? [ { type: 'hit' as const } ] : [])
      ]}
    });
    
  };
  
  await testRunner({ logger, reg, effort, inp, cases: [
    
    { name: 'basic', fn: async logger => {
      
      const timeStep = getStackTimestep();
      
      timeStep.processEvent({ ms:  0, op: 'push', item: 'a' });
      timeStep.processEvent({ ms: 10, op: 'push', item: 'b' });
      timeStep.processEvent({ ms: 20, op: 'push', item: 'c' });
      
      assertEqual(timeStep.getState(), { stack: [ 'a', 'b', 'c' ] });
      
    }},
    
    { name: 'reorder single snapshot', fn: async logger => {
      
      const timeStep = getStackTimestep();
      
      timeStep.processEvent({ ms:  5, op: 'push', item: 'c' });
      timeStep.processEvent({ ms:  3, op: 'push', item: 'b' });
      timeStep.processEvent({ ms:  1, op: 'push', item: 'a' });
      
      assertEqual(timeStep.getState(), {
        stack: [ 'a', 'b', 'c' ]
      });
      
    }},
    
    { name: 'reorder multi snapshot', fn: async logger => {
      
      const timeStep = getStackTimestep();
      
      timeStep.processEvent({ ms:  0, op: 'push', item: 'a' });
      timeStep.processEvent({ ms:  1, op: 'push', item: 'b' });
      timeStep.processEvent({ ms:  2, op: 'push', item: 'c' });
      timeStep.processEvent({ ms:  4, op: 'push', item: 'e' });
      timeStep.processEvent({ ms:  5, op: 'push', item: 'f' });
      timeStep.processEvent({ ms:  6, op: 'push', item: 'g' });
      timeStep.processEvent({ ms:  7, op: 'push', item: 'h' });
      timeStep.processEvent({ ms:  8, op: 'push', item: 'i' });
      timeStep.processEvent({ ms:  9, op: 'push', item: 'j' });
      timeStep.processEvent({ ms: 10, op: 'push', item: 'k' });
      timeStep.processEvent({ ms: 11, op: 'push', item: 'l' });
      timeStep.processEvent({ ms:  3, op: 'push', item: 'd' }); // out of order
      timeStep.processEvent({ ms: 12, op: 'push', item: 'm' });
      timeStep.processEvent({ ms: 13, op: 'push', item: 'n' });
      timeStep.processEvent({ ms: 14, op: 'push', item: 'o' });
      
      assertEqual(timeStep.getState(), {
        stack: 'abcdefghijklmno'.split('')
      });
      
    }},

    { name: 'reorder after snapshot pruning', fn: async logger => {
      
      const timeStep = getStackTimestep(3);
      for (let i = 0; i < 12; i++) {
        timeStep.processEvent({ ms: i, op: 'push', item: String.fromCharCode(97 + i) });
      }
      timeStep.processEvent({ ms: 7.5, op: 'push', item: 'x' });
      
      assertEqual(timeStep.getState(), {
        stack: [ ...'abcdefgh', 'x', ...'ijkl' ]
      });
      
    }},
    
    { name: 'random + reorder (permutations)', fn: async logger => {
      
      const getRandomTimeStep = (inp: { maxEventsPerSnapshot: number }) => {
        
        type State = {
          num: number
        };
        type Event = { ms: number } & ({ op: 'add', min: number, max: number } | { op: 'mult', min: number, max: number });
        
        return new TimeStep<{}, State, Event, Obj<Json>>({
          registry: {},
          msPerTick: 1,
          maxEventsPerSnapshot: inp.maxEventsPerSnapshot,
          seed: 0,
          state: { num: 0 },
          advance: (state, evt, rng) => {
            
            if (evt.op === 'add')  state.num += rng.nextInt(evt.min, evt.max);
            if (evt.op === 'mult') state.num *= rng.nextInt(evt.min, evt.max);
            return state;
            
          }
        });
        
      };
      
      const rng = new Rng(2 ** 32 - 99999);
      const events = (20)[cl.toArr](v => ({
        ms: (() => {
          
          // Insert a few identical events on ms=10
          
          if (v <= 10)            return v;
          if (v >= 11 && v <= 14) return 10;
          return v - 4;
          
        })(),
        min: 1,
        ...((v % 2) === 0 ? { op: 'add' as const, max: 10 } : { op: 'mult' as const, max: 4 })
      }));
      
      // Get the baseline expected value
      const timeStep1 = getRandomTimeStep({ maxEventsPerSnapshot: 1000 });
      for (const e of events) timeStep1.processEvent(e);
      const expected = timeStep1.getState();
      
      for (const maxEventsPerSnapshot of [ 1, 2, 3, 50, 1000 ]) for (let i = 0; i < 50; i++) {
        
        const timeStep = getRandomTimeStep({ maxEventsPerSnapshot });
        for (const e of rng.shuffle(events)) timeStep.processEvent(e);
        assertEqual(timeStep.getState(), expected);
        
      }
      
      
    }},
    
    { name: 'timed rel fires at its exact ms', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 0, wall: 1000, fuses: [ 25 ] });
      timeStep.tickUpToMs(60);
      assertEqual(timeStep.getState().log, [ { ms: 25, types: [ 'fuse' ] } ]);
      
    }},
    
    { name: 'timed rels in one tick fire separately, in order', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 0, wall: 1000, fuses: [ 15, 12 ] });
      timeStep.tickUpToMs(60);
      assertEqual(timeStep.getState().log, [ { ms: 12, types: [ 'fuse' ] }, { ms: 15, types: [ 'fuse' ] } ]);
      
    }},
    
    { name: 'simultaneous timed rels fire together', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 0, wall: 1000, fuses: [ 12, 12 ] })
      timeStep.tickUpToMs(60);
      assertEqual(timeStep.getState().log, [ { ms: 12, types: [ 'fuse', 'fuse' ] } ]);
      
    }},
    
    { name: 'timed rel waits for its window', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 0, wall: 1000, fuses: [ 25 ] });
      timeStep.tickUpToMs(20);
      assertEqual(timeStep.getState().log, []);
      timeStep.tickUpToMs(40);
      assertEqual(timeStep.getState().log, [ { ms: 25, types: [ 'fuse' ] } ]);
      
    }},
    
    { name: 'overdue timed rel fires immediately', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 0, wall: 1000, fuses: [ -5 ] });
      timeStep.tickUpToMs(60);
      assertEqual(timeStep.getState().log, [ { ms: 0, types: [ 'fuse' ] } ]);
      
    }},
    
    { name: 'free rel is hydrated to within precision', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 1000, wall: 33, fuses: [] });
      timeStep.tickUpToMs(60);
      
      const { log, vx } = timeStep.getState();
      assertEqual(log.length, 1);
      assertEqual(log[0].types, [ 'hit' ]);
      assertEqual(log[0].ms >= 33 && log[0].ms <= 33 + 10 / 16, true); // Precise within `1 / (2 ** quality)` ticks
      assertEqual(vx, -1000);
      
    }},
    
    { name: 'timed rel before a free rel can prevent it', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 1000, wall: 33, fuses: [ 25 ] });
      timeStep.tickUpToMs(60);
      assertEqual(timeStep.getState().log, [ { ms: 25, types: [ 'fuse' ] } ]);
      
    }},
    
    { name: 'timed rel in the same tick, before a free rel, fires first', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 1000, wall: 33, fuses: [ 31 ] });
      timeStep.tickUpToMs(60);
      assertEqual(timeStep.getState().log, [ { ms: 31, types: [ 'fuse' ] } ]);
      
    }},
    
    { name: 'timed rel in the same tick, after a free rel, still fires', fn: async logger => {
      
      const timeStep = getBallTimeStep({ vx: 1000, wall: 33, fuses: [ 35 ] });
      timeStep.tickUpToMs(60);
      
      const { log } = timeStep.getState();
      assertEqual(log.map(l => l.types), [ [ 'hit' ], [ 'fuse' ] ]);
      assertEqual(log[1].ms, 35);
      
    }}
    
  ]});
  
}});