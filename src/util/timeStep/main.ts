import { Rng } from '../rng.ts';
import { Wire, type WireCtor, type WireData } from '../wire/main.ts';

export type Event = { tick?: number, ms: number, [K: string]: Json };
export type StateData = WireData;
export type State = Obj<StateData>;
export type Registry = Obj<WireCtor<any> & { clsName: string }>;

export type Flow = {
  tick: number,
  ms: number, // Simply to `tick * msPerTick` (events carry their exact input `ms`)
  sc: number  // Simply to `ms / 1000`
};

export type RelationCfg<S extends State, Rel> = {
  
  // binary search size - relation timing is precise within `1 / (2 ** quality)` ticks
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  
  find:    (flow: Flow, state: S, lastRels: null | Rel[]) => Rel[]
  
};
export type TimeStepInp<Reg extends Registry, S extends State, E extends Event, Rel extends Json> = {
  
  registry: Reg,
  msPerTick: number,             // Conversion ratio from timestep ticks to real milliseconds
  minMsPerTick?: number,         // Prevents bisections that would result in less than this time elapsing in a subframe
  maxEventsPerSnapshot?: number, // Causes snapshots to roll over when they hit this limit
  maxSnapshotsToStore?: number,  // Causes older snapshots to be discarded
  seed: string | number,
  state: S,
  eventOrder?: (evt0: E, evt1: E) => '=' | '<' | '>',
  advance: (state: S, evt: E | { ms: number, op: 'timeStep.rel', rels: Rel[] }, rng: Rng, reg: Reg) => void | S,
  relationCfg?: null | RelationCfg<S, Rel>
  
};
export class TimeStep<Reg extends Registry, S extends State, E extends Event, Rel extends Json> {
  
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
  
  protected wire: Wire<Reg>;
  protected maxEventsPerSnapshot: number;
  protected maxSnapshotsToStore: number;
  protected msPerTick: number;
  protected minMsPerTick: number;
  protected scPerTick: number;
  protected historyForgetSize: number;
  protected snapshots: { rng: Rng, tick: number, historyInd: number, numEvents: number, state: S }[];
  protected history: (E & { tick: number })[];
  protected advance: (state: S, evt: E | { ms: number, op: 'timeStep.rel', rels: Rel[] }, rng: Rng, reg: Reg) => void | S;
  protected eventOrder: (src: E, trg: E) => '=' | '<' | '>';
  protected relationCfg: null | RelationCfg<S, Rel>;
  
  constructor(inp: TimeStepInp<Reg, S, E, Rel>) {
    
    this.wire = new Wire(inp.registry ?? {});
    this.msPerTick = inp.msPerTick;
    this.minMsPerTick = inp.minMsPerTick ?? 0;
    this.scPerTick = inp.msPerTick * 0.001;
    this.maxEventsPerSnapshot = inp.maxEventsPerSnapshot ?? 500;
    this.maxSnapshotsToStore = inp.maxSnapshotsToStore ?? 50;
    
    const seed = cl.isCls(inp.seed, String)
      ? inp.seed.split('').reduce((m, v, n) => m + (n + 1) * v.charCodeAt(0), 0)
      : inp.seed;
    
    this.snapshots = [
      { tick: -1, historyInd: 0, numEvents: 0, rng: new Rng(seed), state: this.wire.clone(inp.state) }, // Fallback snapshot - preserves the initial state
      { tick:  0, historyInd: 0, numEvents: 0, rng: new Rng(seed), state: this.wire.clone(inp.state) }, // Live snapshot head
    ];
    this.history = [];
    this.historyForgetSize = 0;
    this.advance = inp.advance;
    this.eventOrder = inp.eventOrder ?? TimeStep.eventOrder;
    this.relationCfg = inp.relationCfg ?? null;
    
  }
  
  public processEvent(inp: E) {
    
    // To process an event at time T, advance up to T in steps of size `this.relation.dms` - every
    // relation within these steps is precisely narrowed down and resolved first. The current
    // snapshot's `msTailInc` tracks overall advancement. Finally, advance by that event.
    
    const evt = Object.assign(this.wire.clone(inp), { tick: inp.ms / this.msPerTick });
    
    const snapshotTick = this.snapshots.at(-1)!.tick;
    
    // Processing `evt` may require reprocessing earlier events - determine all events to process
    const eventsToPlay = ((): (E & { tick: number })[] => {
      
      // If the event occurs beyond the current snapshot window it can be cleanly added
      if (evt.tick > snapshotTick) return [ evt ];
      
      // It's possible the event is within the snapshot window, with identical timing to the latest
      // event in that window, but overall later ordering (based on json comparison) - in this case
      // `evt` can also be cleanly added
      if (true
        && evt.tick === snapshotTick
        && this.history.length
        && this.eventOrder(evt, this.history.at(-1)!) === '>'
      ) return [ evt ];
      
      // At this point `evt` preceeds some existing events - rollback is needed...
      
      // Find the first snapshot SN prior to `evt`; all later snapshots are deleted and will be
      // reconstructed; replay all events beginning with the 1st event after SN's window
      const stableSnapInd = this.snapshots.findLastIndex(snp => evt.tick > snp.tick); // The 1st snapshot that is unaffected by the incoming event
      const stableSnap = this.snapshots[stableSnapInd];
      
      const replayEventInd = stableSnap.historyInd + stableSnap.numEvents - this.historyForgetSize;
      const replayEvents = this.history.slice(replayEventInd);
      
      if (globalThis.zzz) console.log('ROLLBACK - replay count: ' + replayEvents.length.toString(10));
      
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
        
        // The initial snapshot always serves as fallback; it's never used as the active snapshot
        if (curSnap !== this.snapshots[0] && curSnap.numEvents < this.maxEventsPerSnapshot) return curSnap;
        
        // Note we can't blindly terminate a snapshot at its max events - we must also ensure the
        // incoming event doesn't perfectly coincide with the latest snapshot event; if it does
        // coincide it would be flawed to stack it onto the next snapshot, whose time range has no
        // overlap with the current snapshot!
        // TODO: just ignore (or reject) duplicate events?
        if (this.history.length && this.eventOrder(evt, this.history.at(-1)!) === '=') return curSnap;
        
        const nextSnap = {
          rng:       curSnap.rng.clone(),
          tick:      curSnap.tick,
          historyInd: this.historyForgetSize + this.history.length,
          numEvents: 0,
          state:     this.wire.clone(curSnap.state)
        };
        this.snapshots.push(nextSnap);
        
        if (this.snapshots.length > this.maxSnapshotsToStore) {
          
          // Consider: maybe there's a smart way to have a denser presence of snapshots closer to
          // the present, with fewer further in the past???
          const forgetSnapshot = this.snapshots.shift()!;
          this.historyForgetSize += forgetSnapshot.numEvents;
          this.history = this.history.slice(forgetSnapshot.numEvents); // TODO: inefficient? consider linked-list for history??
          
        }
        
        return nextSnap;
        
      })();
      
      this.setTick(evt.tick); // Note this can introduce relational discontinuities
      
      this.history.push(evt);
      snap.numEvents++;
      snap.tick = evt.tick;
      snap.state = this.advance(snap.state, evt, snap.rng, this.wire.registry) ?? snap.state;
      
    }
    
    // We've only advanced time up until `evt.tick` - if the snapshot had extended further, we need
    // to readvance to that time
    if (this.snapshots.at(-1)!.tick < snapshotTick) this.setTick(snapshotTick);
    
  }
  
  public getTick() { return this.snapshots.at(-1)!.tick; }
  
  public getMs() { return this.getTick() * this.msPerTick; }
  
  protected getFlow(tick: number): Flow {
    return { tick, ms: tick * this.msPerTick, sc: tick * this.scPerTick };
  }
  
  protected setTick(tick: number) {
    
    const snap = this.snapshots.at(-1)!;
    const { find, quality } = this.relationCfg ?? { quality: 0, find: () => [] };
    const stepTicks = this.relationCfg ? 1 : Infinity; // Without relations there's nothing to resolve between events
    
    while (snap.tick < tick) {
      
      const blindNextTick = (Math.floor(snap.tick / stepTicks) + 1) * stepTicks; // The next tick-aligned step to snap to
      const naiveNextTick = Math.min(blindNextTick, tick);                       // Takes into account overshooting the requested `tick` inp
      
      const getRelCheck = (tick: number, last?: Rel[]) => ({ tick, rels: find(this.getFlow(tick), snap.state, last ?? null) });
      const earliestRelCheck = getRelCheck(naiveNextTick);
      
      // If we found relations, iterate to improve precision - note that if no relations are found
      // at the exact end of the range, we assume there are no relations anywhere in the range!
      if (earliestRelCheck.rels.length) {
        
        // We'll narrow down the window to figure out the earliest moment, based on `quality`, any
        // relations occurred
        let windowHeadTick = snap.tick;
        let windowTailTick = naiveNextTick;
        for (let i = 0; i < quality; i++) {
          
          const earlierRelCheck = getRelCheck((windowHeadTick + windowTailTick) * 0.5, earliestRelCheck.rels); // Check if there are still relations at the range's midpoint
          if (earlierRelCheck.rels.length) {
            
            const earlierMsAdvance = (earlierRelCheck.tick - snap.tick) * this.msPerTick;
            if (earlierMsAdvance < this.minMsPerTick) break;
            
            // There are still relations at the midpoint! Update to these earlier relations, prepare
            // to check even earlier (the earlier half of the remaining range)
            Object.assign(earliestRelCheck, earlierRelCheck);
            windowHeadTick = earlierRelCheck.tick;
            
          } else {
            
            // No relations found at the midpoint - prepare to check later (the later half of the
            // remaining range)
            windowTailTick = earlierRelCheck.tick;
            
          }
          
        }
        
        // Finally produce a "rel" event for the earliest moment any relations occurred
        snap.state = this.advance(
          snap.state,
          { ...this.getFlow(earliestRelCheck.tick), op: 'timeStep.rel' as const, rels: earliestRelCheck.rels },
          snap.rng,
          this.wire.registry
        ) ?? snap.state;
        
      }
      
      snap.tick = earliestRelCheck.tick;
      
    }
    
    snap.tick = tick; // Set exactly to eliminate any floating point noise
    
  }
  
  public tickUpToMs(ms: number) { return this.setTick(Math.floor(ms / this.msPerTick)); }
  
  public getState() { return this.wire.clone(this.snapshots.at(-1)!.state); }
  
  public encode() {
    
    const snap = this.snapshots[0];
    const { rng, tick, state } = snap;
    
    return {
      snap: {
        rng: rng.export(),
        tick,                           // The tick of the earliest snapshot in memory
        state: this.wire.encode({ val: state })
      },
      history: this.history.slice(snap.historyInd + snap.numEvents - this.historyForgetSize),
      tick: this.snapshots.at(-1)!.tick // The tick most recently advanced to
    };
    
  }
  
  public decode(inp: ReturnType<TimeStep<any, S, any, any>['encode']>) {
    
    const { snap, history, tick } = inp;
    
    // Move to a single stable snapshot
    this.historyForgetSize = 0;
    this.snapshots = [{
      rng: new Rng(snap.rng.state),
      tick: snap.tick,
      historyInd: 0,
      numEvents: 0,
      state: this.wire.decode(snap.state) as S
    }];
    
    // Replay all history on top of the initial stable snapshot
    this.history = [];
    for (const event of history) this.processEvent(event);
    
    // Advance any additional time
    this.setTick(tick);
    
    return tick;
    
  }
  
};
