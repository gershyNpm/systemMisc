import type { Draw } from '../draw.ts';
import { Random } from '../random.ts';

export type Event = { ms: number, [K: string]: Json };
export type StateData = null | number | string | TimeStepBeing | StateData[] | { [K in string]: StateData };
export type State = Obj<StateData>;

export type Flow = {
  ms: number,
  sc: number // Simply to `ms / 1000`
};
export abstract class TimeStepBeing {
  
  public static clsName = 'TimeStepBeing';
  
  public render(flow: Flow, draw: Draw) {
    draw.circle({ x: 0, y: 0, r: 100 + 50 * Math.sin(Math.PI * 2 * flow.sc), fill: '#f00' });
  }
  
  protected abstract getJsonData(): Obj<Json>
  
  public getJson() { return { $: (this.constructor as any as { clsName: string }).clsName, ...this.getJsonData() }; }
  
};

export type RelationCfg<S extends State, Rel> = {
  tickMs:  number,                                                 // sub-step size for long time advancements
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,             // binary search size - relation timing is precise within `tickMs / (2 ** precision)` millis
  find:    (flow: Flow, state: S, lastRels: null | Rel[]) => Rel[]
};
export type TimeStepInp<Reg extends Obj<new (...args: any[]) => TimeStepBeing>, S extends State, E extends Event, Rel> = {
  
  registry: Reg,
  maxEventsPerSnapshot?: number,
  maxSnapshotsToStore?: number,
  seed: string | number,
  state: S,
  eventOrder?: (evt0: E, evt1: E) => '=' | '<' | '>',
  advance: (state: S, evt: E | { ms: number, op: 'timeStep.rel', rels: Rel[] }, rng: Random, reg: Reg) => S,
  relationCfg?: null | RelationCfg<S, Rel>
  
};
export class TimeStep<Reg extends Obj<new (...args: any[]) => TimeStepBeing>, S extends State, E extends Event, Rel> {
  
  // Time advance plan:
  // There are a few components:
  // 1. Discontinuities in the form of events (unpredictable; from external source)
  // 2. Discontinuities in the form of relations (predictable based on cross-cutting dynamics
  //    within current state)
  // The idea is:
  // - Determine the advancement time interval
  //   - Aim to advance a fixed amount of time forwards (e.g. 1000 / 60 millis)
  //   - If an event occurs earlier, advance exactly up until that event
  //   - Check if any relations have occurred after that step forward
  //     - If a relation has occurred, binary search backwards to get precise moment timing
  //   - Now we have the final time interval; it's either (1) a full time step forwards, (2) an
  //     exact step up to an event, or (3)
  // - To process an event advance the exact amount of time up to that event
  // - When no events, virtually advance a fixed amount of time forward (e.g. 10ms)
  //    - Check the virtually advanced state for moments
  //    - If there are moments, binary search backwards to determine precise moment timing
  //    - Resolve the advance to the precise moment if one exists, otherwise to the full time step
  
  static eventOrder = (src: Event, trg: Event): '=' | '<' | '>' => {
    
    if (src.ms < trg.ms) return '<';
    if (src.ms > trg.ms) return '>';
    return this.jsonOrder(src, trg) ?? '=';
    
  };
  static jsonOrder = (src: Json, trg: Json): '=' | '<' | '>' => {
    
    const srcClsName = cl.getClsName(src);
    const trgClsName = cl.getClsName(trg);
    if (srcClsName < trgClsName) return '<';
    if (srcClsName > trgClsName) return '>';
    
    // Now we know `src` and `trg` have the same class
    
    if (src === trg) return '='; // Handles `null` and `undefined` too
    
    if ([ Boolean, Number, String ].some(Cls => cl.isCls(src, Cls)))
      return (src as any) < (trg as any) ? '<' : '>';
    
    if (cl.isCls(src, Array)) {
      
      if (src.length < (trg as any).length) return '<';
      if (src.length > (trg as any).length) return '>';
      
      for (let i = 0; i < src.length; i++) {
        const r = this.jsonOrder(src[i], (trg as any)[i]);
        if (r !== '=') return r;
      }
      
      return '=';
      
    }
    
    // `src` and `trg` can only be objects
    const srcKeys = Object.keys(src as any).sort();
    const trgKeys = Object.keys(trg as any).sort();
    const keyR = this.jsonOrder(srcKeys, trgKeys);
    if (keyR !== '=') return keyR;
    
    for (const k of srcKeys) {
      const r = this.jsonOrder((src as any)[k], (trg as any)[k]);
      if (r !== '=') return r;
    }
    
    return '=';
    
  };
  
  protected registry: Reg;
  protected maxEventsPerSnapshot: number;
  protected maxSnapshotsToStore: number;
  protected snapshots: { rng: Random, ms: number, numEvents: number, state: S }[];
  protected history: E[];
  protected advance: (state: S, evt: E | { ms: number, op: 'timeStep.rel', rels: Rel[] }, rng: Random, reg: Reg) => S
  protected eventOrder: (src: E, trg: E) => '=' | '<' | '>';
  protected relationCfg: RelationCfg<S, Rel>;
  
  constructor(inp: TimeStepInp<Reg, S, E, Rel>) {
    
    // Ensure every registry class has a unique static `clsName` property - protects against poor
    // `TimeStepBeing` subclasses which fail to define a unique `clsName` property
    if (inp.registry) Error[cl.assert](inp.registry, reg => {
      
      const classNames = reg[cl.toArr](Cls => (Cls as any).clsName as string);
      if (classNames.some(n => !cl.isCls(n, String))) return false;
      
      const uniqueNames = new Set(classNames);
      return classNames.length === uniqueNames.size;
      
    });
    
    this.registry = inp.registry ?? ({} as any);
    this.maxEventsPerSnapshot = inp.maxEventsPerSnapshot ?? 500;
    this.maxSnapshotsToStore = inp.maxSnapshotsToStore ?? 50;
    
    const seed = cl.isCls(inp.seed, String)
      ? inp.seed.split('').reduce((m, v, n) => m + (n + 1) * v.charCodeAt(0), 0)
      : inp.seed;
    
    this.snapshots = [
      { ms: -1, numEvents: Infinity, rng: new Random(seed), state: this.beingClone(inp.state) }, // Fallback snapshot - preserves the initial state
      { ms:  0, numEvents: 0,        rng: new Random(seed), state: this.beingClone(inp.state) }, // Live snapshot head
    ];
    this.history = [ { ms: -1 } as E ];
    this.advance = inp.advance;
    this.eventOrder = inp.eventOrder ?? TimeStep.eventOrder;
    this.relationCfg = inp.relationCfg ?? {
      tickMs: Infinity,
      quality: 0,
      find: () => []
    };
    
  }
  
  protected beingLaunch(json: Obj<Json> & { $: keyof Reg }): TimeStepBeing {
    
    const { $: clsName, ...more } = json;
    const Cls = this.registry[clsName];
    return new Cls(more);
    
  }
  
  protected beingClone<V extends StateData>(v: V, seen: Map<StateData, StateData> = new Map()): V {
    
    // Note this method works perfectly well for pure json as json is a subset of StateData
    
    if (seen.has(v)) return seen.get(v) as V;
    
    if (cl.isCls(v, Object)) {
      const obj = {};
      seen.set(v, obj);
      for (const k in v) obj[k] = this.beingClone(v[k] as StateData, seen);
      return obj as V;
    }
    
    if (cl.isCls(v, Array)) {
      const arr: Json[] = [];
      seen.set(v, arr as StateData);
      for (const vv of v) arr.push(this.beingClone(vv, seen));
      return arr as V;
    }
    
    if (cl.inCls(v, TimeStepBeing)) {
      return this.beingLaunch(v.getJson()) as V;
    }
    
    return v;
    
  }
  
  public processEvent(evt: E) {
    
    // To process an event at time T, advance up to T in steps of size `this.relation.dms` - every
    // relation within these steps is precisely narrowed down and resolved first. The current
    // snapshot's `msTailInc` tracks overall advancement. Finally, advance by that event.
    
    evt = this.beingClone(evt as StateData) as E;
    
    const snapshotMs = this.snapshots.at(-1)!.ms;
    
    // Processing `evt` may require reprocessing earlier events - determine all events to process
    const eventsToPlay = ((): E[] => {
      
      // If the event occurs beyond the current snapshot window it can be cleanly added
      if (evt.ms > snapshotMs) return [ evt ];
      
      // It's possible the event is within the snapshot window, with identical timing to the latest
      // event in that window, but overall later ordering (based on json comparison) - in this case
      // `evt` can also be cleanly added
      if (evt.ms === snapshotMs && this.eventOrder(evt, this.history.at(-1)!) === '>') return [ evt ];
      
      // At this point `evt` preceeds some existing events - rollback is needed...
      
      // Find the first snapshot SN prior to `evt`; all later snapshots are deleted and will be
      // reconstructed; replay all events beginning with the 1st event after SN's window
      const stableSnapInd = this.snapshots.findLastIndex(snp => evt.ms > snp.ms); // The 1st snapshot that is unaffected by the incoming event
      const stableSnapshot = this.snapshots[stableSnapInd];
      
      // TODO: inefficient; can search through a lot of events, should be a binary search, consider @gershy/util-sorted-array
      const stableEventInd = this.history.findLastIndex(evt => evt.ms <= stableSnapshot.ms); // Index of last event of the stable snapshot
      const replayEventInd = stableEventInd + 1;                                             // The 1st event that follows the stable snapshot i.e. 1st event that needs to be replayed
      const replayEvents = this.history.slice(replayEventInd);
      
      let insertInd = 0;
      while (insertInd < replayEvents.length && this.eventOrder(replayEvents[insertInd], evt) !== '>') insertInd++;
      
      this.snapshots = this.snapshots.slice(0, stableSnapInd + 1); // Maintain all snapshots up to and including the stable snapshot; discard the rest
      this.history = this.history.slice(0, replayEventInd);
      
      return [ ...replayEvents.slice(0, insertInd), evt, ...replayEvents.slice(insertInd) ];
      
    })();
    
    // Now `eventsToPlay` is an ordered array of events suffixing `this.history`
    for (const evt of eventsToPlay) {
      
      const snap = (() => {
        
        const curSnap = this.snapshots.at(-1)!;
        
        if (curSnap.numEvents < this.maxEventsPerSnapshot) return curSnap;
        
        // Note we can't blindly terminate a snapshot at its max events - we must also ensure the
        // incoming event doesn't perfectly coincide with the latest snapshot event; if it does
        // coincide it would be flawed to stack it onto the next snapshot, whose time range has no
        // overlap with the current snapshot!
        // TODO: just ignore (or reject) duplicate events?
        if (this.eventOrder(evt, this.history.at(-1)!) === '=') return curSnap;
        
        const nextSnap = {
          rng:       curSnap.rng.clone(),
          ms:        curSnap.ms,
          numEvents: 0,
          state:     this.beingClone(curSnap.state)
        };
        this.snapshots.push(nextSnap);
        
        if (this.snapshots.length > this.maxSnapshotsToStore) {
          
          // Consider: maybe there's a smart way to have a denser presence of snapshots closer to
          // the present, with fewer further in the past???
          const forgetSnapshot = this.snapshots.shift()!;
          this.history = this.history.slice(forgetSnapshot.numEvents); // TODO: inefficient? consider linked-list for history??
          
        }
        
        return nextSnap;
        
      })();
      
      this.setTimeMs(evt.ms); // Note this can introduce relational discontinuities
      
      this.history.push(evt);
      snap.numEvents++;
      snap.ms = evt.ms;
      snap.state = this.advance(snap.state, evt, snap.rng, this.registry);
      
    }
    
    // We've only advanced time up until `evt.ms` - if the snapshot had extended further, we need
    // to readvance to that time
    if (this.snapshots.at(-1)!.ms < snapshotMs) this.setTimeMs(snapshotMs);
    
  }
  
  public getTimeMs() { return this.snapshots.at(-1)!.ms; }
  
  public setTimeMs(ms: number) {
    
    const snap = this.snapshots.at(-1)!;
    if (ms < snap.ms) throw Error('negative time advancement invalid')[cl.mod]({ curMs: snap.ms, setMs: ms });
    
    const { tickMs, find, quality } = this.relationCfg;
    
    while (snap.ms < ms) {
      
      const blindNextMs = (Math.floor(snap.ms / tickMs) + 1) * tickMs; // The next tick-aligned step to snap to
      const naiveNextMs = Math.min(blindNextMs, ms);                   // Takes into account overshooting the requested `ms` inp
      
      const getRelCheck = (ms: number, last?: Rel[]) => ({ ms, rels: find({ ms, sc: ms * 0.001 }, snap.state, last ?? null) });
      const earliestRelCheck = getRelCheck(naiveNextMs);
      
      // If we found relations, iterate to improve precision - note that if no relations are found
      // at the exact end of the range, we assume there are no relations anywhere in the range!
      if (earliestRelCheck.rels.length) {
        
        // We'll narrow down the window to figure out the earliest moment, based on `quality`, any
        // relations occurred
        let windowHeadMs = snap.ms;
        let windowTailMs = naiveNextMs;
        for (let i = 0; i < quality; i++) {
          
          const earlierRelCheck = getRelCheck((windowHeadMs + windowTailMs) * 0.5, earliestRelCheck.rels); // Check if there are still relations at the range's midpoint
          if (earlierRelCheck.rels.length) {
            
            // There are still relations at the midpoint! Update to these earlier relations, prepare
            // to check even earlier (the earlier half of the remaining range)
            Object.assign(earliestRelCheck, earlierRelCheck);
            windowHeadMs = earlierRelCheck.ms;
            
          } else {
            
            // No relations found at the midpoint - prepare to check later (the later half of the
            // remaining range)
            windowTailMs = earlierRelCheck.ms;
            
          }
          
        }
        
        // Finally produce a "rel" event for the earliest moment any relations occurred
        this.advance(
          snap.state,
          { ms: earliestRelCheck.ms, op: 'timeStep.rel' as const, rels: earliestRelCheck.rels },
          snap.rng,
          this.registry
        );
        
      }
      
      snap.ms = earliestRelCheck.ms;
      
    }
    
    snap.ms = ms; // Set exactly to eliminate any floating point noise
    
  }
  
  public getState() { return this.beingClone(this.snapshots.at(-1)!.state); }
  
};
