import '@gershy/clearing';
import { assertEqual, testRunner } from '../../../build/utils.test.ts';
import { entry } from '@gershy/entry';
import { TimeStep, TimeStepBeing } from './main.ts';
import { Random } from '../random.ts';

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
  
  const getStackTimestep = () => {
    
    type State = { stack: string[] };
    type Event = { ms: number } & [
      { op: 'push', item: string },
      { op: 'pop' }
    ][number];
    type Rel = null;
    
    return new TimeStep<{}, State, Event, Rel>({
      registry: {},
      maxEventsPerSnapshot: 3,
      seed: 0,
      state: { stack: [] } as { stack: string[] },
      advance: (state, evt) => {
        
        if (evt.op === 'push') state.stack.push(evt.item);
        if (evt.op === 'pop')  state.stack.pop();
        return state;
        
      },
      relationCfg: {
        tickMs: 1000 / 60,
        quality: 4,
        find: _state => []
      }
    });
    
  };
  
  await testRunner({ logger, reg, effort, inp, cases: [
    
    { name: 'basic', fn: async logger => {
      
      const timeStep = getStackTimestep();
      
      timeStep.processEvent({ ms:  0, op: 'push', item: 'a' });
      timeStep.processEvent({ ms: 10, op: 'push', item: 'b' });
      timeStep.processEvent({ ms: 20, op: 'push', item: 'c' });
      
      assertEqual(timeStep.getState(), {
        stack: [ 'a', 'b', 'c' ]
      });
      
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
    
    { name: 'random + reorder (permutations)', fn: async logger => {
      
      const getRandomTimeStep = (inp: { maxEventsPerSnapshot: number }) => {
        
        type State = {
          num: number
        };
        type Event = { ms: number } & ({ op: 'add', min: number, max: number } | { op: 'mult', min: number, max: number });
        
        return new TimeStep<{}, State, Event, null>({
          registry: {},
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
      
      const rng = new Random(2 ** 32 - 99999);
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
    
    { name: 'random + reorder + being', fn: async logger => {
      
      const getTimeStep = () => {
        
        const registry = (() => {
          
          class Func extends TimeStepBeing {
            
            static clsName: 'Func';
            
            protected data: { ms: number, type: 'vel' | 'acl', x: number, y: number };
            
            constructor(data: Func['data']) {
              super();
              this.data = data;
            }
            
            public update(inp: { x: number, y: number }) { Object.assign(this.data, inp); }
            
            protected getJsonData() { return this.data; }
            
          };
          
          return { Func };
          
        })();
        type Registry = typeof registry;
        
        type State = {
          num: number,
          funcs: { [K: string]: InstanceType<Registry['Func']> }
        };
        type Event = { ms: number } & [
          { op: 'launch', id: string, type: 'vel' | 'acl', val: { x: [ number, number ], y: [ number, number ] } },
          { op: 'update', id: string,                      val: { x: [ number, number ], y: [ number, number ] } },
          { op: 'cancel', id: string }
        ][number];
        
        return new TimeStep<Registry, State, Event, null>({
          registry,
          maxEventsPerSnapshot: 3,
          seed: 0,
          state: { num: 0, funcs: {} },
          advance: (state, evt, rng, { Func }) => {
            
            if (evt.op === 'launch') state.funcs[evt.id] = new Func({
              ms: evt.ms,
              type: evt.type,
              x: rng.nextInt(evt.val.x[0], evt.val.x[1]),
              y: rng.nextInt(evt.val.y[0], evt.val.y[1])
            });
            
            if (evt.op === 'update') state.funcs[evt.id].update({
              x: rng.nextInt(evt.val.x[0], evt.val.x[1]),
              y: rng.nextInt(evt.val.y[0], evt.val.y[1])
            });
            
            if (evt.op === 'cancel') delete state.funcs[evt.id];
            
            return state;
            
          }
        });
        
      };
      
      void getTimeStep; // TODO
      
      
    }},
    
    { name: 'random + reorder + being + rel', fn: async logger => {
      
      // TODO
      
    }}
    
  ]});
  
}});