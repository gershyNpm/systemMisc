import { Rng } from '../rng.ts';
import { Wire, type WireCtor, type WireData } from '../wire/main.ts';

export type Event = { tick?: number, ms: number, [K: string]: Json };
export type StateData = WireData;
export type State = Obj<StateData>;
export type Registry = Obj<WireCtor<any> & { clsName: string }>;
export type Relation = Obj<Json> & { ms?: number };

export type Flow = {
  tick: number,
  ms: number, // Simply to `tick * msPerTick` (events carry their exact input `ms`)
  sc: number  // Simply to `ms / 1000`
};

export class StepPerf {
  
  advanceMs: number;
  subticks: number;
  relChecks: number;
  
  constructor(inp = { advanceMs: 0, subticks: 0, relChecks: 0 }) {
    this.advanceMs = inp.advanceMs;
    this.subticks = inp.subticks;
    this.relChecks = inp.relChecks;
  }
  
  add(inp: { advanceMs: number, subticks: number, relChecks: number }) {
    return new StepPerf({
      advanceMs: this.advanceMs + inp.advanceMs,
      subticks: this.subticks + inp.subticks,
      relChecks: this.relChecks + inp.relChecks
    });
  }
  
};

export type RelationCfg<S extends State, Rel extends Relation> = {
  
  // binary search size - relation timing is precise within `1 / (2 ** quality)` ticks
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  
  find:    (flow: Flow, state: S, lastRels: null | Rel[]) => Rel[]
  
};
export type TimeStepInp<Reg extends Registry, S extends State, E extends Event, Rel extends Relation> = {
  
  registry:              Reg,
  msPerTick:             number,          // Conversion ratio from timestep ticks to real milliseconds
  minMsPerTick?:         number,          // Prevents bisections that would result in less than this time elapsing in a subframe
  maxSnapshots?:         number,          // Causes older snapshots to be discarded
  maxSnapshotEvents?:    number,          // Causes snapshots to roll over when they hit this limit
  maxSnapshotDurMs?:     number,          // Cut over snapshots when a snapshot becomes too long
  seed:                  string | number, // Random seed
  state:                 S,
  
  // Comparison function to determine which of two events comes first
  eventOrder?:           (evt0: E, evt1: E) => '=' | '<' | '>',
  
  // Function which mutates state in response to an event
  advance:               (state: S, evt: E | { ms: number, op: 'timeStep.rel', rels: Rel[] }, rng: Rng, reg: Reg) => void | S,
  
  // Configuration for how to detect state relationships over time
  relationCfg?: null | RelationCfg<S, Rel>,
  
};
export class TimeStep<Reg extends Registry, S extends State, E extends Event, Rel extends Relation> {
  
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
    return this.jsonOrder(src, trg);
    
  };
  static jsonOrder = (src: Json, trg: Json): '=' | '<' | '>' => {
    
    if (src === trg) return '='; // Handles null, undefined, boolean, number, string
    
    const srcClsName = cl.getClsName(src);
    const trgClsName = cl.getClsName(trg);
    if (srcClsName < trgClsName) return '<';
    if (srcClsName > trgClsName) return '>';
    
    // Now we know `src` and `trg` have the same class
    
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
  protected maxSnapshots: number;
  protected maxSnapshotEvents: number;
  protected maxSnapshotDurMs: number;
  protected msPerTick: number;
  protected tickPerMs: number;
  protected minMsPerTick: number;
  protected scPerTick: number;
  protected historyForgetSize: number;
  protected snapshots: { rng: Rng, headTick: number, tick: number, historyInd: number, numEvents: number, state: S }[];
  protected history: E[]; // The consumer's own objects, by identity - consumers must never mutate events they feed in
  protected advance: (state: S, evt: E | { ms: number, op: 'timeStep.rel', rels: Rel[] }, rng: Rng, reg: Reg) => void | S;
  protected eventOrder: (src: E, trg: E) => '=' | '<' | '>';
  protected relationCfg: null | RelationCfg<S, Rel>;
  
  constructor(inp: TimeStepInp<Reg, S, E, Rel>) {
    
    this.wire = new Wire(inp.registry ?? {});
    this.msPerTick = inp.msPerTick;
    this.tickPerMs = 1 / this.msPerTick;
    this.minMsPerTick = inp.minMsPerTick ?? 0;
    this.scPerTick = inp.msPerTick * 0.001;
    this.maxSnapshots = inp.maxSnapshots ?? 50;
    this.maxSnapshotEvents = inp.maxSnapshotEvents ?? 500;
    this.maxSnapshotDurMs = inp.maxSnapshotDurMs ?? Infinity;
    
    const seed = cl.isCls(inp.seed, String)
      ? inp.seed.split('').reduce((m, v, n) => m + (n + 1) * v.charCodeAt(0), 0)
      : inp.seed;
    
    this.snapshots = [
      { headTick: -1, tick: -1, historyInd: 0, numEvents: 0, rng: new Rng(seed), state: this.wire.clone(inp.state) }, // Fallback snapshot - preserves the initial state
      { headTick: -1, tick:  0, historyInd: 0, numEvents: 0, rng: new Rng(seed), state: this.wire.clone(inp.state) }, // Live snapshot head
    ];
    this.history = [];
    this.historyForgetSize = 0;
    this.advance = inp.advance;
    this.eventOrder = inp.eventOrder ?? TimeStep.eventOrder;
    this.relationCfg = inp.relationCfg ?? null;
    
  }
  
  protected getFlow(tick: number): Flow { return { tick, ms: tick * this.msPerTick, sc: tick * this.scPerTick }; }
  
  protected setTick(requestedTick: number) {
    
    // Processes all ticks up until `requestedTick`, and advances any relations in the timeframe
    
    let snap = this.snapshots.at(-1)!;
    
    const sp = new StepPerf();
    if (requestedTick < snap.tick) return sp;
    
    const { find, quality } = this.relationCfg ?? { quality: 0, find: () => [] };
    const stepTicks = this.relationCfg ? 1 : Infinity; // With no relations, there's no action at all between events
    
    sp.advanceMs = (requestedTick - snap.tick) * this.msPerTick;
    const getRelCheck = (headTick: number, tailTick: number, lastFreeRels?: Rel[]) => {
      
      // Given a time window, find relations at the end of that window
      
      sp.relChecks++;
      
      const headMs = headTick * this.msPerTick;
      const tailMs = tailTick * this.msPerTick;
      
      const freeRels: Rel[] = [];
      const timeRels: { ms: number, rel: Rel }[] = [];
      for (const rel of find(this.getFlow(tailTick), snap.state, lastFreeRels ?? null)) {
        if (rel.ms == null  ) { freeRels.push(rel);                                   continue; }
        if (rel.ms <= tailMs) { timeRels.push({ ms: Math.max(rel.ms, headMs), rel }); continue; } // Overdue rels fire immediately; later rels are ignored until their window
      }
      
      return { tick: tailTick, freeRels, timeRels };
      
    };
    
    // Free rels have unknown timing; narrow it down by binary search - the result is a rel check
    // with no free rels; they're converted to timed rels at the earliest tick (within `quality`,
    // and never closer to `headTick` than `minMsPerTick`) at which they were still observed
    const relCheckToTimeRels = (headTick: number, tailCheck: ReturnType<typeof getRelCheck>) => {
      
      // Given a relCheck, returns a simple array of Rels where:
      // - Every Rel has `{ ms: number }`
      // - Free rels have been assigned `ms` using a binary search
      
      if (!tailCheck.freeRels.length) return tailCheck.timeRels;
      
      let windowHeadTick = headTick;
      let windowTailTick = tailCheck.tick;
      let relCheck = tailCheck;
      for (let i = 0; i < quality; i++) {
        
        const windowMid = (windowHeadTick + windowTailTick) * 0.5;
        
        // Prevent excessively small time steps due to binary search
        if ((windowMid - headTick) * this.msPerTick < this.minMsPerTick) break;
        
        const earlierRelCheck = getRelCheck(headTick, windowMid, relCheck.freeRels);
        if (earlierRelCheck.freeRels.length) {
          
          // Free rels still occur at the midpoint - the earliest moment is in the earlier half
          relCheck = earlierRelCheck;
          windowTailTick = windowMid;
          
        } else {
          
          // No free rels at the midpoint - the earliest moment is in the later half
          windowHeadTick = windowMid;
          
        }
        
      }
      
      const ms = relCheck.tick * this.msPerTick;
      return [ ...tailCheck.timeRels, ...relCheck.freeRels.map(rel => ({ ms, rel })) ];
      
    };
    
    // Return the tick at which `snap`'s time window expires
    const windowTailTick = () => Math.ceil(snap.headTick + this.maxSnapshotDurMs * this.tickPerMs);
    
    while (snap.tick < requestedTick) {
      
      sp.subticks++;
      
      // Bound snapshot length even when no events arrive
      if (snap.tick >= windowTailTick()) snap = this.snapshotCutover(snap);
      
      const blindNextTick = (Math.floor(snap.tick / stepTicks) + 1) * stepTicks; // The next integer tick to step to
      const naiveNextTick = Math.min(blindNextTick, requestedTick, windowTailTick()); // Takes into account overshooting the requested `tick` and snapshot window
      
      // Check for a discontinuity in the advancement window
      const relCheck = getRelCheck(snap.tick, naiveNextTick);
      const timeRels = relCheckToTimeRels(snap.tick, relCheck);
      if (!timeRels.length) { snap.tick = naiveNextTick; continue; }
      
      const ms = Math.min(...timeRels.map(r => r.ms));
      const tick = ms * this.tickPerMs;
      const rels = timeRels.filter(r => r.ms === ms).map(r => r.rel);
      
      snap.state = this.advance(
        snap.state,
        { ...this.getFlow(tick), ms, op: 'timeStep.rel' as const, rels },
        snap.rng,
        this.wire.registry
      ) ?? snap.state;
      
      // Later rels in the window are found again on the next pass; `advance` must consume timed rels
      snap.tick = Math.min(Math.max(snap.tick, tick), naiveNextTick);
      
    }
    
    snap.tick = requestedTick; // Set exactly to eliminate any floating point noise
    
    return sp;
    
  }
  
  protected rollback(tick: number) {
    
    // Find the first snapshot SN prior to `tick`; all later snapshots are deleted and will be
    // reconstructed; returns all events beginning with the 1st event after SN's window, which the
    // caller must replay
    const stableSnapInd = this.snapshots.findLastIndex(snp => tick > snp.tick); // The 1st snapshot that is unaffected by changes at `tick`
    if (stableSnapInd === -1) throw Error('rollback exceeds retention')[cl.mod]({ tick });
    
    const stableSnap = this.snapshots[stableSnapInd];
    
    const replayEventInd = stableSnap.historyInd + stableSnap.numEvents - this.historyForgetSize;
    const replayEvents = this.history.slice(replayEventInd);
    
    this.snapshots = this.snapshots.slice(0, stableSnapInd + 1); // Maintain all snapshots up to and including the stable snapshot; discard the rest
    this.history = this.history.slice(0, replayEventInd);
    
    return replayEvents;
    
  }
  
  public processEvent(inp: E) {
    
    // To process an event at time T, advance up to T in steps of size `this.relation.dms` - every
    // relation within these steps is precisely narrowed down and resolved first. The current
    // snapshot's `msTailInc` tracks overall advancement. Finally, advance by that event.
    
    const pms = performance.now();
    const evt = inp;
    const evtTick = evt.ms / this.msPerTick;
    
    const snapshotTick = this.snapshots.at(-1)!.tick;
    
    // Processing `evt` may require reprocessing earlier events - determine all events to process
    const eventsToPlay = ((): E[] => {
      
      // If the event occurs beyond the current snapshot window it can be cleanly added
      if (evtTick > snapshotTick) return [ evt ];
      
      // It's possible the event is within the snapshot window, with identical timing to the latest
      // event in that window, but overall later ordering (based on json comparison) - in this case
      // `evt` can also be cleanly added
      if (true
        && evtTick === snapshotTick
        && this.history.length
        && this.eventOrder(evt, this.history.at(-1)!) === '>'
      ) return [ evt ];
      
      // At this point `evt` preceeds some existing events - rollback is needed...
      const replayEvents = this.rollback(evtTick);
      
      let insertInd = 0;
      while (insertInd < replayEvents.length && this.eventOrder(replayEvents[insertInd], evt) !== '>') insertInd++;
      
      return [ ...replayEvents.slice(0, insertInd), evt, ...replayEvents.slice(insertInd) ];
      
    })();
    
    const stats = this.playEvents(eventsToPlay);
    
    // We've only advanced time up until `evtTick` - if the snapshot had extended further, we need
    // to readvance to that time
    if (this.snapshots.at(-1)!.tick < snapshotTick) {
      const ticked = this.setTick(snapshotTick);
      stats.subticks += ticked.subticks;
      stats.relChecks += ticked.relChecks;
    }
    
    return {
      elapsedPms: Math.round(performance.now() - pms),
      numEvents: eventsToPlay.length,
      ...stats,
    };
    
  }
  
  public replaceEvent(old: E, next: null | E) {
    
    // Retracts `old` (matched by identity) and inserts `next` wherever it belongs in the event
    // ordering - which may differ from `old`'s position - with a single rollback
    
    const snapshotTick = this.snapshots.at(-1)!.tick;
    const oldTick = old.ms / this.msPerTick;
    const nextTick = next ? next.ms / this.msPerTick : Infinity;
    
    if (!this.history.includes(old)) throw Error('event missing')[cl.mod]({ event: old }); // Must be checked before `rollback` mutates anything
    
    const replayEvents = this.rollback(Math.min(oldTick, nextTick));
    const oldInd = replayEvents.lastIndexOf(old);
    if (oldInd === -1) throw Error('event missing')[cl.mod]({ event: old });
    const eventsToPlay = [ ...replayEvents.slice(0, oldInd), ...replayEvents.slice(oldInd + 1) ];
    
    if (next) {
      let insertInd = 0;
      while (insertInd < eventsToPlay.length && this.eventOrder(eventsToPlay[insertInd], next) !== '>') insertInd++;
      eventsToPlay.splice(insertInd, 0, next);
    }
    
    const stats = this.playEvents(eventsToPlay);
    
    if (this.snapshots.at(-1)!.tick < snapshotTick) {
      const t = this.setTick(snapshotTick);
      stats.advanceMs += t.advanceMs;
      stats.relChecks += t.relChecks;
      stats.subticks += t.subticks;
    }
    
    return stats;
    
  }
  
  protected snapshotCutover(curSnap = this.snapshots.at(-1)!) {
    
    const nextSnap = {
      rng:       curSnap.rng.clone(),
      headTick:  curSnap.tick,
      tick:      curSnap.tick,
      historyInd: this.historyForgetSize + this.history.length,
      numEvents: 0,
      state:     this.wire.clone(curSnap.state)
    };
    this.snapshots.push(nextSnap);
    
    if (this.snapshots.length > this.maxSnapshots) {
      
      const forgetSnapshot = this.snapshots.shift()!;
      this.historyForgetSize += forgetSnapshot.numEvents;
      this.history = this.history.slice(forgetSnapshot.numEvents); // TODO: inefficient? consider linked-list for history??
      
    }
    
    return nextSnap;
    
  }
  
  protected playEvents(events: E[]) {
    
    // `events` is an ordered array of events suffixing `this.history`
    const sp = new StepPerf();
    let tick0 = this.snapshots.at(-1)!.tick;
    for (const evt of events) {
      
      const curSnap = this.snapshots.at(-1)!;
      
      // The initial snapshot always serves as fallback; it's never used as the active snapshot
      const full = false
        || curSnap === this.snapshots[0]
        || curSnap.numEvents                                  >= this.maxSnapshotEvents
        || (curSnap.tick - curSnap.headTick) * this.msPerTick >= this.maxSnapshotDurMs;
      
      // Note we can't blindly terminate a snapshot at its max events - we must also ensure the
      // incoming event doesn't perfectly coincide with the latest snapshot event; if it does
      // coincide it would be flawed to stack it onto the next snapshot, whose time range has no
      // overlap with the current snapshot!
      // TODO: just ignore (or reject) duplicate events?
      const duplicate = this.history.length > 0 && this.eventOrder(evt, this.history.at(-1)!) === '=';
      
      if (full && !duplicate) this.snapshotCutover();
      
      const playTick = evt.ms / this.msPerTick;
      sp.add(this.setTick(playTick)); // Note this can introduce relational discontinuities, and push snapshots
      
      const snap = this.snapshots.at(-1)!;
      this.history.push(evt);
      snap.numEvents++;
      snap.tick = playTick;
      snap.state = this.advance(snap.state, evt, snap.rng, this.wire.registry) ?? snap.state;
      
    }
    
    sp.advanceMs = (this.snapshots.at(-1)!.tick - tick0) * this.msPerTick;
    return sp;
    
  }
  
  public getTick() { return this.snapshots.at(-1)!.tick; }
  
  public getMs() { return this.getTick() * this.msPerTick; }
  
  public tickUpToMs(ms: number) { return this.setTick(Math.floor(ms / this.msPerTick)); }
  
  public getState() { return this.snapshots.at(-1)!.state; }
  
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
      headTick: snap.tick,
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
