import '@gershy/clearing';
import { PollenSession } from '@gershy/lilac-platformer/main/pollenSession';
import Logger from '@gershy/logger';
import { Draw } from './util/draw.ts';
import playFn, { Flow, type Play } from './play.ts';
import { Pt } from './util/pt.ts';

export namespace Browser {
  
  export namespace Node {
    
    export type Script = Node & {
      src: string
    };
    export type Canvas = Node & {
      getContext: (type: '2d') => any
    };
    
  };
  export type Node = {
    
    width: number, height: number,
    textContent: string,
    getBoundingClientRect: () => { x: number, y: number, width: number, height: number },
    appendChild: (node: Node) => void,
    
    setAttribute:        (k: string, v: string) => void,
    addEventListener:    (type: string, fn: (evt: any) => void) => void,
    removeEventListener: (type: string, fn: (evt: any) => void) => void,
    
    style: Obj<string>
    
  };
  export type Window = {
    lilacData: {
      dnsHost: string
    },
    document: {
      querySelector: (sel: string) => null | Node,
      currentScript: Browser.Node.Script,
      createElement: (type: string) => Node
    },
    requestAnimationFrame: (fn: () => any) => void,
    addEventListener: {
      (term: 'error',              fn: (evt: { error: any }) => any): void,
      (term: 'unhandledrejection', fn: (evt: { reason: any }) => any): void,
    },
    location: {
      hostname: `${string}.${string}`
    }
  };
  
};
const createMusic = () => {
  
  const AudioCtx = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!AudioCtx) return null;
  const tracks = [
    { bpm: 140, roots: [33, 29, 26, 28], bass: [0,-1,0,12,-1,7,0,-1,0,0,-1,10,7,-1,0,12], lead: [24,-1,-1,27,-1,31,-1,-1,26,-1,-1,24,-1,22,-1,-1], wobble: [2,4,8,3], kicks: [0,6,11] },
    { bpm: 144, roots: [30, 30, 25, 28], bass: [0,0,-1,0,7,-1,12,-1,-1,0,3,-1,0,12,7,-1], lead: [24,-1,31,-1,27,-1,-1,-1,29,-1,26,-1,24,-1,-1,22], wobble: [8,3,6,4], kicks: [0,5,14] },
    { bpm: 138, roots: [31, 27, 34, 29], bass: [0,-1,-1,12,0,-1,10,7,0,-1,0,-1,3,7,-1,12], lead: [31,-1,-1,-1,29,-1,27,-1,26,-1,24,-1,-1,-1,22,-1], wobble: [3,2,4,8], kicks: [0,7,10] },
    { bpm: 150, roots: [28, 31, 24, 26], bass: [0,7,0,-1,12,0,-1,7,0,-1,10,0,-1,3,7,12], lead: [24,27,-1,31,-1,-1,34,-1,31,-1,29,-1,27,-1,26,-1], wobble: [4,8,6,12], kicks: [0,3,12] },
    { bpm: 142, roots: [26, 22, 24, 21], bass: [0,-1,0,-1,3,0,-1,-1,12,10,-1,7,0,-1,0,7], lead: [36,-1,-1,34,-1,-1,31,-1,29,-1,-1,27,26,-1,-1,-1], wobble: [6,4,3,8], kicks: [0,6,13] },
    { bpm: 146, roots: [35, 30, 31, 28], bass: [0,12,-1,7,-1,0,3,-1,0,-1,12,10,7,0,-1,0], lead: [24,-1,26,27,-1,31,-1,34,-1,31,29,-1,27,-1,26,-1], wobble: [8,6,4,2], kicks: [0,4,11,15] }
  ];
  const track = tracks[Math.floor(Math.random() * tracks.length)];
  const stepSec = 60 / track.bpm / 4;
  const hz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);
  let ctx: any = null;
  let master: any = null;
  let effects: any = null;
  let noise: any = null;
  let timer: any = null;
  let step = 0;
  let nextTime = 0;
  const init = () => {
    if (ctx) { ctx.resume?.(); return; }
    ctx = new AudioCtx();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 12;
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);
    effects = ctx.createGain();
    effects.gain.value = 0.3;
    effects.connect(limiter);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  };
  const tone = (type: string, freq: number, time: number, dur: number, vol: number, dest = master, endFreq = freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + dur);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  };
  const hiss = (time: number, dur: number, vol: number, cutoff: number, dest = master) => {
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(time);
    src.stop(time + dur);
  };
  const wobble = (freq: number, time: number, dur: number, rate: number) => {
    const filter = ctx.createBiquadFilter();
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let index = 0; index < curve.length; index++) curve[index] = Math.tanh((index / 127.5 - 1) * 4);
    drive.curve = curve;
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(700, time);
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = rate * track.bpm / 60;
    depth.gain.value = 620;
    lfo.connect(depth);
    depth.connect(filter.frequency);
    filter.connect(drive);
    drive.connect(master);
    tone('sawtooth', freq * 1.003, time, dur, 0.1, filter);
    tone('sawtooth', freq * 0.997, time, dur, 0.1, filter);
    tone('sine', freq / 2, time, dur, 0.4);
    lfo.start(time);
    lfo.stop(time + dur + 0.02);
  };
  const schedule = (num: number, time: number) => {
    const bar = Math.floor(num / 16) % 4;
    const beat = num % 16;
    const phrase = Math.floor(num / 64) % 4;
    const root = track.roots[bar];
    if (track.kicks.includes(beat)) tone('sine', 150, time, 0.19, 0.9, master, 38);
    if (beat === 8) {
      tone('triangle', 190, time, 0.14, 0.35, master, 110);
      hiss(time, 0.22, 0.5, 1100);
    }
    if (beat % 2 === 0 || phrase === 3) hiss(time, beat % 4 ? 0.035 : 0.07, 0.07, 6500);
    const bass = track.bass[(beat + (phrase % 2) * 4) % 16];
    if (bass >= 0) wobble(hz(root + bass), time + 0.014, stepSec * 0.85, track.wobble[(bar + phrase) % 4]);
    const lead = track.lead[beat];
    if (lead >= 0 && phrase !== 2) tone('triangle', hz(root + lead + 12), time, stepSec * 1.8, 0.07);
    if (phrase === 3 && bar === 3 && beat >= 12) hiss(time, 0.05, 0.14, 1800);
  };
  const setEnabled = (on: boolean) => {
    init();
    if (!on) {
      if (timer) clearInterval(timer);
      timer = null;
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      return;
    }
    if (timer) return;
    master.gain.setTargetAtTime(0.16, ctx.currentTime, 0.03);
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(() => {
      if (nextTime < ctx.currentTime - 0.3) nextTime = ctx.currentTime;
      while (nextTime < ctx.currentTime + 0.15) { schedule(step++, nextTime); nextTime += stepSec; }
    }, 40);
  };
  const sound = (kind: 'scream' | 'ouch', volume: number, pan: number) => {
    if (!ctx || ctx.state !== 'running') return;
    const spatial = ctx.createStereoPanner();
    spatial.pan.value = Math.max(-1, Math.min(1, pan));
    spatial.connect(effects);
    const time = ctx.currentTime;
    if (kind === 'scream') {
      tone('sawtooth', 620, time, 0.42, 0.12 * volume, spatial, 120);
      tone('triangle', 930, time, 0.38, 0.08 * volume, spatial, 180);
      hiss(time, 0.3, 0.1 * volume, 1900, spatial);
    } else {
      tone('triangle', 290, time, 0.18, 0.4 * volume, spatial, 95);
      tone('sawtooth', 145, time, 0.13, 0.09 * volume, spatial, 65);
    }
    setTimeout(() => spatial.disconnect(), 650);
  };
  return { setEnabled, sound };
};

export type HealthBarState = { target: number, fill: number, trail: number, charge: number, loss: number, waiting: boolean, hitMs: number };
export const advanceHealthBar = (state: HealthBarState, target: number, dt: number, now: number) => {
  target = Math.max(0, Math.min(1, target));
  if (target < state.target) {
    state.trail = Math.max(state.trail, state.fill, state.target);
    state.loss = state.trail - target;
    state.waiting = true;
    state.hitMs = now;
  }
  if (target > state.target) state.charge = state.fill;
  state.target = target;
  let remaining = Math.min(0.25, Math.max(0, dt));
  while (remaining > 0) {
    const step = Math.min(remaining, 1 / 120);
    remaining -= step;
    if (state.fill > target) state.fill = Math.max(target, state.fill - Math.max((state.fill - target) * 12, 0.4) * step);
    else if (state.fill < target) {
      state.charge = Math.min(target, Math.max(state.charge, state.fill) + 1.5 * step);
      state.fill = state.charge >= target ? target : Math.max(state.fill, Math.floor((state.charge + 1e-8) * 10) / 10);
    }
    if (state.fill - target <= state.loss * 0.2) state.waiting = false;
    if (!state.waiting) state.trail = Math.max(state.fill, state.trail - (state.trail - state.fill) * 14 * step);
    if (state.fill <= target && target > state.trail) state.trail = state.fill;
  }
  return state;
};

const renderHealthBar = (draw: Draw, state: HealthBarState, pos: Pt, width: number, now: number) => {
  const shake = now - state.hitMs < 250 ? 2 * Math.sin((now - state.hitMs) * 0.13) : 0;
  const centre = pos.add(new Pt({ x: shake, y: now - state.hitMs < 250 ? 2 * Math.cos(now * 0.11) : 0 }));
  const height = 8;
  const left = centre.x - width / 2;
  draw.rect({ pos: centre, tur: 0, w: width + 3, h: height + 3, line: '#fff', lineW: 1 });
  draw.rect({ pos: centre, tur: 0, w: width + 1, h: height + 1, line: '#000', lineW: 1 });
  draw.rect({ pos: centre, tur: 0, w: width, h: height, fill: '#0008' });
  const fillRect = (fraction: number, fill: `#${string}`) => {
    if (fraction <= 0) return;
    draw.rect({ pos: new Pt({ x: left + width * fraction / 2, y: centre.y }), tur: 0, w: width * fraction, h: height, fill });
  };
  if (state.target > state.fill && Math.floor(now / 62.5) % 2 === 0) fillRect(state.target, '#69db7c66');
  fillRect(state.trail, '#ffc9c9');
  const channel = (empty: number, full: number) => Math.round(empty + (full - empty) * state.fill).toString(16).padStart(2, '0');
  fillRect(state.fill, `#${channel(250, 105)}${channel(82, 219)}${channel(82, 124)}`);
  if (now - state.hitMs < 150) draw.rect({ pos: centre, tur: 0, w: width, h: height, fill: '#fff' });
  for (let segment = 1; segment < 5; segment++) draw.line({
    pt0: new Pt({ x: left + width * segment / 5, y: centre.y - height / 2 + 1 }),
    pt1: new Pt({ x: left + width * segment / 5, y: centre.y + height / 2 - 1 }),
    line: '#0000001f', lineW: 1
  });
};

export default async () => {
  
  // TODO: HEEERE1 hot load works
  // [X] Websocket connection can fail (but maybe the task just timed out??)
  // [X] Work on event/replay multiplayer logic
  // [ ] Consider esbuild improvement (tolerate node modules when bundling for web; only fail if final resolved/tree-shaken bundle still includes them - addresses an "undesirable" esbuild feature, which considers it a failure if unbundlable imports are hit, even if they would later be tree-shaken away)
  // [ ] Eliminate references to `global` and `process` where possible - they break sovereignty
  // [ ] Still a lot of todos in Platformer (priority concern: admin-over-non-tls-http)
  
  type BrowserInp = {
    platform: {
      ipHost: 'self' | `${string}.${string}`,
      dnsHost: null | 'self' | `${string}.${string}`
    }
  };
  
  // TODO: ZZZ code everywhere must avoid `process` and `global` - they're nodejs-only!
  const browser: Browser.Window = Object.assign(globalThis, { process: {}, global: globalThis, zzz: true }) as any;
  
  const logger = new Logger('browser', {}, { maxStrLen: 1000 }, (ctx: any) => {
    
    const now = performance.now();
    const time = (() => {
      
      let t = now;
      const hours = Math.floor(now / (1000 * 60 * 60));
      t -= hours * 1000 * 60 * 60;
      
      const mins = Math.floor(now / (1000 * 60));
      t -= mins * 1000 * 60;
      
      const secs = Math.floor(now / 1000);
      t -= secs * 1000;
      
      return [ hours, mins, secs ]
        .map(v => v.toString(10).padStart(2, '0'))
        .join(':');
      
    })();
    
    const { $, msg, ...more } = ctx;
    const hasMore = !more[cl.empty]();
    console.log(
      
      ...(msg
        ? [ `%c ${time}: ${$.$}\n%c ${msg}${hasMore ? '\n' : ''}` ]
        : [ `%c ${time}: ${$.$}${''      }${hasMore ? '\n' : ''}` ]
      ),
      
      'font-weight: bold;',
      ...(msg ? [ 'font-style: italic;' ] : []),
      
      ...(hasMore ? [ more ] : [])
      
    );
    
  });
  
  let pingMs = 50;
  let connected = false;
  const verboseLogging = false; // Temporarily off for performance; errors and connection logs stay on
  await logger.scope(null, {}, async logger => {
    
    // Timing functions
    let clientOffMs = 0;
    const { perfUtcMs, clientUtcMs, inputUtcMs } = (() => {
      
      const { timeOrigin } = performance;
      const perfUtcMs = () => timeOrigin + performance.now();
      
      const clientUtcMs = (now = perfUtcMs()) => {
        
        // Replacement for `Date.now()` intended to be continuously calibrated so that client ms
        // queries correspond as closely as possible to server ms
        // (TODO: use `performance` for more precision?)
        
        return now += clientOffMs;
        
      };
      
      let last = { now: -Infinity, reps: 0 };
      const inputUtcMs = (now = clientUtcMs()) => {
        
        // Returns unique timestamps for inputs / rapid events - closely-spaced calls use
        // small-decimal-place increments to achieve stable ordering
        
        if (now > last.now) last = { now, reps: 0 };
        return last.now + (last.reps++) * 0.00001;
        
      };
      
      return { perfUtcMs, clientUtcMs, inputUtcMs };
      
    })();
    
    const errHandler = (err: any) => {
      console.log('TOP LEVEL ERROR', { err });
    };
    browser.addEventListener('error',              evt => errHandler(evt.error));
    browser.addEventListener('unhandledrejection', evt => errHandler(evt.reason));
    
    const elems = (() => {
      
      const html = browser.document.querySelector('html')!;
      const body = browser.document.querySelector('body')!;
      for (const elem of [ html, body ]) Object.assign(elem.style, {
        position: 'absolute',
        left: '0', top: '0',
        width: '100%', height: '100%',
        margin: '0', padding: '0',
        fontFamily: 'monospace'
      });
      
      const canvas = browser.document.createElement('canvas') as Browser.Node.Canvas;
      Object.assign(body.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        boxShadow: '0 0 2px 0 #f00'
      });
      Object.assign(canvas.style, {
        width: '100vmin', height: '100vmin',
        pointerEvents: 'none',
        backgroundColor: '#fff'
      });
      body.appendChild(canvas);
      
      const status = browser.document.createElement('div');
      Object.assign(status.style, {
        position: 'absolute', boxSizing: 'border-box',
        left: '0', bottom: '0',
        width: '100%', height: '30px', lineHeight: '30px', padding: '0 0.6em',
        backgroundColor: '#8883',
        color: '#fff',
        pointerEvents: 'none'
      });
      // body.appendChild(status); // TODO: No longer appending this element... reconsider? It's nice during loading
      
      let statusPrm = Promise.resolve();
      const queueStatus = (text: string) => {
        statusPrm = statusPrm.then(async () => {
          status.textContent = text;
          await new Promise(r => setTimeout(r, 300));
        });
      };
      
      status.textContent = '(status bar)';
      
      return { html, canvas, queueStatus };
      
    })();
    
    elems.queueStatus('loading session...');
    
    const session = await logger.scope('sessionLaunch', {}, async logger => {
      
      const browserInp: BrowserInp = browser.document.currentScript.src.split('?')[1]
        .split('&')
        [cl.toObj](v => v[cl.cut]('=', 1))
        [cl.map](v => cl.safe(() => JSON.parse(decodeURIComponent(v)), () => v)) as any;
      
      const { dnsHost, ipHost } = browserInp.platform;
      const browserHost = dnsHost ?? ipHost; // Prefer dns host
      const host = browserHost === 'self'
        ? browser.location.hostname
        : browserHost;
      
      logger.log({ $$: 'gameConnection', dnsHost, ipHost, resolvedHost: host });
      
      const session = new PollenSession({ flowerId: `domain/${host}` as const });
      const { sessionId } = await session.getDef(logger);
      logger.log({ $$: 'result', sessionId });
      return Object.assign(session, { id: sessionId });
      
    });
    connected = true;
    
    elems.queueStatus('loaded session!');
    
    const play = (browser as any).play = playFn({ observe: {
      
      tick: inp => verboseLogging && (inp.elapsedPms > 8) && logger.log({ $$: 'timeStep.tick', ...inp[cl.map](v => Math.round(v)) })
      
    }});
    const stateJoinedPrm = Promise[cl.later]();
    
    // Sokt event processing
    const inputs: Obj<{ event: Play.Event, pms: number }> = {}; // Local inputs awaiting a server ack, by input id
    let serverStartUtcMs = 0;
    logger.scope('sokt', {}, async () => {
      
      const hear = await session.hear(logger);
      
      // Listen for the "state.launch" event which allows us to initialize our TimeStep
      elems.queueStatus('waiting for state data...');
      const stateData = await (async () => {
        
        while (true) {
          
          const { value: event, done } = (await hear.next()) as { value: Obj<Json>, done: boolean };
          if (done) throw Error('sokt close while joining unexpected');
          
          if (event.op === 'state.launch') return event as { state: Json, pendingEvents: Play.Event[], startUtcMs: number, utcMs: number };
            
          if (verboseLogging) logger.log({ $: 'ignore', event });
          
        }
        
      })();
      elems.queueStatus('got state data!');
      
      const receivedStateDataUtcMs = perfUtcMs();
      const estimatedLatencyMs = 4;
      clientOffMs = -receivedStateDataUtcMs + (stateData.utcMs + estimatedLatencyMs);
      
      elems.queueStatus('joining state...');
      play.timeStep.decode(stateData.state as any);
      play.setPendingEvents(stateData.pendingEvents as any);
      play.setOffsetMs(clientUtcMs(play.ticker.startUtcMs) - stateData.startUtcMs);
      serverStartUtcMs = stateData.startUtcMs;
      elems.queueStatus('joined state!');
      stateJoinedPrm.resolve();
      let syncing = false;
      const requestStateSync = (error: unknown) => {
        if (syncing) return;
        syncing = true;
        logger.log({ $$: 'timeStep.resync', error: error instanceof Error ? error.message : String(error) });
        void session.tell({ logger, msg: { op: 'state.sync' } }).catch(cause => {
          syncing = false;
          logger.log({ $$: 'timeStep.resyncRequestFailed', cause: String(cause) });
        });
      };
      
      while (true) {
        
        const { done, value: event } = await hear.next() as { done: boolean, value: Play.AckEvent | { op: 'state.sync', state: Json, pendingEvents: Play.Event[] } };
        if (done) break;
        
        if (event.op === 'state.sync') {
          try {
            play.timeStep.decode(event.state as any);
            play.setPendingEvents(event.pendingEvents);
            for (const id in inputs) delete inputs[id];
            syncing = false;
          } catch (cause) {
            requestStateSync(cause);
          }
          continue;
        }
        if (syncing) continue;
        
        try {
          const pms = performance.now();
          const { ack = null, ...serverEvent } = event;
          if (!ack) { play.addEvent(event); continue; }
          
          const input = inputs[cl.at](ack.id, null);
          if (input) {
            delete inputs[ack.id];
            const inputPingMs = pms - input.pms;
            pingMs = 0.9 * pingMs + 0.1 * inputPingMs;
          }
          
          const honoured = ack.resolvedMs === ack.clientMs;
          const offsetToServer = Math.max(0, Math.round(ack.serverMs - ack.clientMs));
          if (verboseLogging && !honoured) logger.log({ msg: 'event dishonoured', input, honoured, offsetToServer });
          
          // An honoured input is already in the timeline exactly as the server resolved it
          if      (!input)    play.addEvent(serverEvent as Play.Event);
          else if (!honoured) play.replaceEvent(input.event, serverEvent as Play.Event);
        } catch (cause) {
          requestStateSync(cause);
        }
        
      }
      
      connected = false;
      
    }).catch(() => logger.log({ $: 'sokt.glitch' }));
    
    await stateJoinedPrm;

    let chatOpen = false;
    let releaseControls = () => {};
    const chatBox = browser.document.createElement('input') as any;
    chatBox.setAttribute('type', 'text');
    chatBox.setAttribute('maxlength', '160');
    chatBox.setAttribute('aria-label', 'Chat message');
    chatBox.setAttribute('autocomplete', 'off');
    Object.assign(chatBox.style, {
      position: 'fixed', left: '50%', bottom: '110px', transform: 'translateX(-50%)',
      width: 'min(440px, 85vw)', boxSizing: 'border-box', padding: '12px',
      background: '#101014', color: '#fff', border: '2px solid #fff',
      font: '16px monospace', borderRadius: '4px', display: 'none', zIndex: '10'
    });
    browser.document.querySelector('body')!.appendChild(chatBox);
    elems.html.addEventListener('keydown', (evt: any) => {
      if (evt.isComposing || evt.repeat) return;
      if (evt.code !== 'Enter' && !(chatOpen && evt.code === 'Escape')) return;
      evt.preventDefault();
      if (!chatOpen) {
        releaseControls();
        sendButton('-act6', { aim: null });
        chatOpen = true;
        chatBox.style.display = 'block';
        chatBox.focus();
      } else {
        if (evt.code === 'Enter' && chatBox.value.trim()) sendButton('-act6', { chat: chatBox.value });
        chatBox.value = '';
        chatBox.blur();
        chatBox.style.display = 'none';
        chatOpen = false;
      }
    });
    
    // Input setup
    (() => {
      
      const binds = {
        
        dirL: 'KeyA', // evt.code === 'KeyL'
        dirR: 'KeyD',
        dirU: 'KeyW',
        dirD: 'KeyS',
        
        turL1: 'KeyK',
        turL2: 'KeyI',
        turR1: 'KeyL',
        turR2: 'KeyO',
        
        mod0: 'ShiftLeft',
        
        act0: 'Space',
        act1: 'Semicolon',
        act2: 'Quote',
        act3: 'KeyQ',
        act4: 'KeyE',
        act5: 'KeyG',
        act6: 'KeyB'
        
      };
      const actMap = binds[cl.mapk]((v, k) => [ v, k ]); // Maps key codes to their corresponding action
      const btnState = binds[cl.map](v => '-');
      releaseControls = () => {
        for (const btn of Object.keys(btnState) as (keyof typeof binds)[]) {
          if (btnState[btn] !== '+') continue;
          btnState[btn] = '-';
          sendButton(`-${btn}`);
        }
      };
      (globalThis as any).addEventListener('blur', () => { releaseControls(); sendButton('-act6', { aim: null }); });
      for (const dir of [ '+', '-' ] as const) elems.html.addEventListener({ '+': 'keydown', '-': 'keyup' }[dir], (evt: { timeStamp: number, code: string, isComposing: boolean, preventDefault: () => void }) => {
        if (chatOpen || evt.isComposing) return;
        
        // Event can be delayed due to event loop and other factors - ignore excessively late
        // events as the server will reject them either way!
        const evtNow = performance.timeOrigin + evt.timeStamp;
        if (evtNow < (Date.now() - 100)) return;
        
        const btn = actMap[cl.at](evt.code, null);
        if (btn === null) return;
        evt.preventDefault();
        
        // Don't resend the same button state (by default key events repeat when held)
        if (btnState[btn] === dir) return;
        btnState[btn] = dir;
        
        const id = Math.random().toString(36).slice(2);
        const timeStepMs = inputUtcMs(clientUtcMs(evtNow)) - serverStartUtcMs;
        
        // Apply the input locally right away; the server's ack later confirms or replaces it
        const event: Play.Event = {
          ms: timeStepMs,
          op: 'player.key',
          btn: `${dir}${btn}`,
          session: { id: session.id }
        };
        inputs[id] = { event, pms: performance.now() }
        play.addEvent(event);
        
        session.tell({ logger, msg: { ms: timeStepMs, id, op: event.op, btn: event.btn } });
        
      });
      
    })();
    
    // Settings, persisted per browser; press M to toggle whether the map or the player spins
    const settings = { rotateMap: true, music: true, mouseAim: false };
    try {
      const saved = (globalThis as any).localStorage?.getItem('zombiesSettings');
      if (saved) Object.assign(settings, JSON.parse(saved));
    } catch {}
    const sendButton = (btn: `${'+' | '-'}${Play.Button}`, payload: { chat?: string, aim?: number | null } = {}) => {
      
      const id = Math.random().toString(36).slice(2);
      const timeStepMs = inputUtcMs() - serverStartUtcMs;
      
      const event: Play.Event = { ms: timeStepMs, op: 'player.key', btn, ...payload, session: { id: session.id } };
      inputs[id] = { event, pms: performance.now() };
      play.addEvent(event);
      
      session.tell({ logger, msg: { ms: timeStepMs, id, op: event.op, btn: event.btn, ...payload } });
      
    };
    
    const music = createMusic();
    elems.html.addEventListener('keydown', (evt: any) => {
      if (chatOpen || evt.repeat || evt.isComposing) return;
      
      if (evt.code === 'KeyN') {
        settings.music = !settings.music;
        try { (globalThis as any).localStorage?.setItem('zombiesSettings', JSON.stringify(settings)); } catch {}
      }
      
      music?.setEnabled(settings.music);
      
    });
    
    const pointer: { pos: Pt | null } = { pos: null };
    elems.html.addEventListener('mousemove', (evt: any) => {
      const rect = elems.canvas.getBoundingClientRect();
      const pos = new Pt({ x: evt.clientX - rect.x, y: evt.clientY - rect.y });
      pointer.pos = pos.x >= 0 && pos.y >= 0 && pos.x <= rect.width && pos.y <= rect.height ? pos : null;
    });
    elems.html.addEventListener('keydown', (evt: any) => {
      if (chatOpen || evt.repeat || evt.isComposing) return;
      if (evt.code === 'KeyP') {
        settings.mouseAim = !settings.mouseAim;
        sendButton('-act6', { aim: null });
        sendButton(settings.rotateMap && !settings.mouseAim ? '-mapFixed' : '+mapFixed');
        try { (globalThis as any).localStorage?.setItem('zombiesSettings', JSON.stringify(settings)); } catch {}
        return;
      }
      
      if (evt.code !== 'KeyM') return;
      settings.rotateMap = !settings.rotateMap;
      try { (globalThis as any).localStorage?.setItem('zombiesSettings', JSON.stringify(settings)); } catch {}
      
      // The simulation needs to know: with a fixed map, movement is screen-relative
      sendButton(settings.rotateMap && !settings.mouseAim ? '-mapFixed' : '+mapFixed');
      
    });
    
    const { Player } = play.registry;
    const debugView = false;
    const patienceMs = 20;
    const offsetMs = play.getOffsetMs();
    const draw = new Draw({ canvas: elems.canvas });
    let nextSampleMs = -Infinity;
    let nextSyncMs = -Infinity;
    let nextAimMs = -Infinity;
    let lastAim: number | null = null;
    let lastAimSentMs = -Infinity;
    let lastFrameMs = performance.now();
    const healthBars = new Map<string, HealthBarState>();
    const heard = new Map<string, number>();
    let zoom = 1;
    while (true) {
      
      await new Promise<void>(r => browser.requestAnimationFrame(r));
      
      const { canvas } = elems;
      const bound = canvas.getBoundingClientRect();
      const [ cw, ch ] = [ Math.ceil(bound.width), Math.ceil(bound.height) ];
      if (canvas.width  !== cw) canvas.width  = cw;
      if (canvas.height !== ch) canvas.height = ch;
      
      const ms = (perfUtcMs() - play.ticker.startUtcMs) + offsetMs - patienceMs;
      const flow = new Flow(ms);
      
      const stage = play.timeStep.getState().world.getStage(flow);
      const entities = stage.getEntities(flow);
      const player = entities[cl.at](`${Player.clsName}/${session.id}`, null) as null | Play.Registry['Player'];
      const rotateMap = settings.rotateMap && !settings.mouseAim;
      const now = performance.now();
      const dt = (now - lastFrameMs) / 1000;
      lastFrameMs = now;
      for (const [ id ] of healthBars) if (!cl.isCls(entities[id], Player)) healthBars.delete(id);
      for (const ent of Object.values(entities)) {
        if (!cl.isCls(ent, Player)) continue;
        const target = ent.getHealth() / Player.maxHealth;
        const bar = healthBars.get(ent.getId()) ?? { target, fill: target, trail: target, charge: target, loss: 0, waiting: false, hitMs: -Infinity };
        healthBars.set(ent.getId(), advanceHealthBar(bar, target, dt, now));
      }
      let voices = 0;
      for (const [ id, heardMs ] of heard) if (ms - heardMs > 2500) heard.delete(id);
      for (const ent of Object.values(entities)) {
        if (!(ent instanceof play.registry.Cue)) continue;
        const cue = ent.getCue();
        if ((cue.kind !== 'scream' && cue.kind !== 'ouch') || heard.has(cue.id) || cue.ms > ms) continue;
        heard.set(cue.id, ms);
        if (!player || ms - cue.ms > 600) continue;
        const offset = cue.pos.sub(player.getTransform(flow).pos);
        const dist = offset.len();
        if (dist > 28 || voices >= 6) continue;
        const relative = rotateMap ? offset.addTur(-(player.getTransform(flow).tur + 0.25)) : offset;
        music?.sound(cue.kind, Math.pow(1 - dist / 28, 2), relative.x / 12);
        voices++;
      }
      
      // Keep the simulated movement mode in line with the local setting (events can be missed around spawning)
      if (player && cl.isCls(player, Player) && player.getButtons().mapFixed === rotateMap && ms > nextSyncMs) {
        nextSyncMs = ms + 500;
        sendButton(rotateMap ? '-mapFixed' : '+mapFixed');
      }
      
      // Sprinting eases the view out a little for a sense of speed (purely visual)
      const sprinting = !!(player && cl.isCls(player, Player) && player.getButtons().mod0);
      zoom += ((sprinting ? 1.18 : 1) - zoom) * 0.08;
      const vertMeters = (debugView ? 50 : 25) * zoom; // Vertical height in meters of viewbox
      if (settings.mouseAim && !chatOpen && player && cl.isCls(player, Player) && ms > nextAimMs) {
        nextAimMs = ms + 80;
        const offset = pointer.pos?.sub(new Pt({ x: cw / 2, y: ch / 2 }));
        const aim = offset && offset.len() > 8 ? new Pt().getTur(offset) : null;
        if (aim === null ? lastAim !== null : lastAim === null || Math.abs(((aim - lastAim) % 1 + 1.5) % 1 - 0.5) > 0.002 || ms - lastAimSentMs > 400) {
          sendButton('-act6', { aim });
          lastAim = aim;
          lastAimSentMs = ms;
        }
      }
      
      draw.fresh({ fill: '#400' }, ({ w, h, mid }) => {
        
        draw.frame(shift => {
          
          const h = mid.y * 2;
          const off = player ? player.getTransform(flow) : (() => {
            
            let x = 0; let y = 0; let tur = 0;
            let num = 0;
            for (let k in entities) {
              
              const ent = entities[k];
              if (!cl.inCls(ent, Player)) continue;
              
              const tfm = ent.getTransform(flow);
              num++;
              x += tfm.pos.x;
              y += tfm.pos.y;
              tur += (tfm.tur % 1);
              
            }
            
            return { pos: new Pt({ x: x / num, y: y / num }), tur: tur / num };
            
          })();
          
          shift.trn(mid);                                      // Relative to center of canvas
          shift.scl(h / vertMeters);
          if (rotateMap) shift.tur(-(off.tur + 0.25)); // Otherwise the map stays fixed and the player spins
          shift.trn(off.pos.mult(-1));
          const project = (pos: Pt) => {
            const relative = pos.sub(off.pos);
            return (rotateMap ? relative.addTur(-(off.tur + 0.25)) : relative).mult(h / vertMeters).add(mid);
          };
          
          // Determine all rendering operations including the Stage
          const opsUnsorted = new Array(entities[cl.count]() + 1);
          let opInd = 0;
          for (const k in entities) opsUnsorted[opInd++] = entities[k].getRenderOps(flow, draw);
          opsUnsorted.push(stage.getRenderOps(flow, draw));
          
          const renderOps = opsUnsorted.flat(1).sort((a, b) => a.z - b.z);
          
          // Render all clipped stuff
          draw.frame(() => {
            
            // TODO: simply prefixing the rendering with the following allows the clip swept by
            // player vision to only apply within the specified zone!
            draw.clip(() => {
              stage.renderAreaClip(flow, draw); // Clips, e.g., only the interiors of spaces!
            });
            
            if (!debugView) draw.clip(() => {
              stage.renderClip(flow, draw);
              for (const k in entities) entities[k].renderClip(flow, draw);
            });
            
            // The stage paints its own ground (colour and texture)
            stage.renderGround(flow, draw, off.pos);
            
            // This skips past all `z < 0` then renders from lowest to highest (only where (`z >= 0`)
            for (const renderOp of renderOps)
              if (renderOp.z >= 0)
                renderOp.fn();
            draw.absolute(() => {
              for (const ent of Object.values(entities)) {
                if (!cl.isCls(ent, Player)) continue;
                const at = project(ent.getTransform(flow).pos);
                if (at.x < -80 || at.y < -40 || at.x > w + 80 || at.y > h + 40) continue;
                draw.rect({ pos: at.add(new Pt({ x: 0, y: 29 })), tur: 0, w: Math.max(50, ent.getName().length * 7 + 10), h: 16, fill: '#000b' });
                draw.text({ x: at.x, y: at.y + 29, tur: 0, text: ent.getName(), fontSize: 12, fill: '#fff' });
                renderHealthBar(draw, healthBars.get(ent.getId())!, at.add(new Pt({ x: 0, y: 44 })), 58, now);
              }
            });
            
          });
          
          // Render on top of the clipped game world
          for (const { z, fn } of renderOps) {
            
            if (z >= 0) break;
            fn();
            
          }
          draw.absolute(() => {
            for (const ent of Object.values(entities)) {
              if (!(ent instanceof play.registry.Cue)) continue;
              const cue = ent.getCue();
              if (cue.kind !== 'chat' || cue.ms > ms) continue;
              const owner = entities[cue.owner];
              const pos = owner && 'getTransform' in owner ? (owner as Play.Registry['Player']).getTransform(flow).pos : cue.pos;
              const at = project(pos).add(new Pt({ x: 0, y: -35 }));
              const offscreen = at.x < 30 || at.x > w - 30 || at.y < 30 || at.y > h - 110;
              const distance = pos.sub(off.pos).len();
              const fontSize = offscreen ? Math.max(3, 12 / (1 + distance / 22)) : 13;
              const lines: string[] = [];
              for (const word of cue.text.split(/\s+/)) {
                for (let start = 0; start < word.length; start += 32) {
                  const part = word.slice(start, start + 32);
                  if (lines.length && lines[lines.length - 1].length + part.length < 32) lines[lines.length - 1] += ` ${part}`;
                  else lines.push(part);
                }
              }
              const bubbleW = Math.min(w - 12, Math.max(...lines.map(line => line.length)) * fontSize * 0.62 + 12);
              const bubbleH = lines.length * fontSize * 1.25 + 10;
              const edgeScale = Math.min(1, (w / 2 - bubbleW / 2 - 8) / Math.max(1, Math.abs(at.x - mid.x)), (h / 2 - bubbleH / 2 - 30) / Math.max(1, Math.abs(at.y - mid.y)));
              const centre = offscreen ? at.sub(mid).mult(Math.max(0, edgeScale)).add(mid) : at;
              centre.x = Math.max(bubbleW / 2 + 6, Math.min(w - bubbleW / 2 - 6, centre.x));
              centre.y = Math.max(bubbleH / 2 + 6, Math.min(h - bubbleH / 2 - 100, centre.y));
              draw.rect({ pos: centre, tur: 0, w: bubbleW, h: bubbleH, fill: '#101014ed', line: '#fff', lineW: offscreen ? 0.5 : 1 });
              lines.forEach((text, index) => draw.text({ x: centre.x, y: centre.y + (index - (lines.length - 1) / 2) * fontSize * 1.25, tur: 0, text, fontSize, fill: '#fff' }));
            }
          });
          
        });
        
        draw.rect({ pos: new Pt({ x: 65, y: h - 10 }), tur: 0, w: 130, h: 20, fill: '#0004' });
        draw.text({
          x: 65, y: h - 7,
          tur: Math.sqrt(Math.min(0, pingMs - 100) * 0.001),
          text: connected ? `ping: ${Math.round(pingMs).toString(10)}ms` : 'disconnected! X_X',
          fontSize: 12,
          align: '=',
          fill: '#0dd'
        });
        
        draw.text({
          x: 10, y: h - 34,
          tur: 0,
          text: `map: ${rotateMap ? 'rotates' : 'fixed'} (M)  music: ${settings.music ? 'on' : 'off'} (N)  mouse: ${settings.mouseAim ? 'on' : 'off'} (P)`,
          fontSize: 12,
          align: '<',
          fill: '#fff8'
        });
        
        // Your entity may be a compromised or downed player, which have no gun HUD
        if (player && cl.isCls(player, Player)) {
          
          const hud = player.getHud(entities, flow);
          
          // Pills tint the whole view through shifting colours
          if (hud.pillsMs > 0) {
            const hue = (ms / 3000) % 1;
            const chan = (off: number) => Math.round(128 + 127 * Math.sin(Math.PI * 2 * (hue + off))).toString(16).padStart(2, '0');
            draw.rect({ pos: mid, tur: 0, w, h, fill: `#${chan(0)}${chan(1 / 3)}${chan(2 / 3)}40` });
          }
          
          draw.text({
            x: w - 10, y: h - 86,
            tur: 0,
            text: `grenade (G): ${hud.grenadeMs ? (hud.grenadeMs / 1000).toFixed(1) + 's' : 'ready'}`,
            fontSize: 14,
            align: '>',
            fill: '#fffa'
          });
          renderHealthBar(draw, healthBars.get(player.getId())!, new Pt({ x: w - 72, y: h - 62 }), 120, now);
          const status = hud.reviving ? 'reviving...' : hud.reloading ? 'reloading...' : '';
          draw.text({
            x: w - 10, y: h - 34,
            tur: 0,
            text: hud.guns.length ? `${hud.clip} / ${hud.reserve} ${status}` : '',
            fontSize: 22,
            align: '>',
            fill: '#fff'
          });
          // Rotate so the active gun is first; the rest follow in swap order
          const activeInd = Math.max(0, hud.guns.findIndex(g => g.active));
          const ordered = [ ...hud.guns.slice(activeInd), ...hud.guns.slice(0, activeInd) ];
          draw.text({
            x: w - 10, y: h - 10,
            tur: 0,
            text: ordered.map(g => g.active ? `[${g.kind}]` : g.kind).join('  '),
            fontSize: 14,
            align: '>',
            fill: '#fffa'
          });
          
        }
        
        // Results of the plunge that was just beaten
        const statRows = stage.getStatsView(flow);
        if (statRows) {
          
          const lineH = 24;
          const panelW = 720;
          const panelH = (statRows.length + 2) * lineH;
          const left = w * 0.5 - panelW * 0.5;
          const top = h * 0.2;
          const cols = [ left + 16, left + 330, left + 420, left + 500, left + 590, left + panelW - 16 ];
          
          draw.rect({ pos: new Pt({ x: w * 0.5, y: top + panelH * 0.5 }), tur: 0, w: panelW, h: panelH, fill: '#000a' });
          [ 'player', 'points', 'damage', 'kills', 'friendly', 'revives' ].forEach((text, c) => draw.text({
            x: cols[c], y: top + lineH, tur: 0, text, fontSize: 14, align: c ? '>' : '<', fill: '#fff8'
          }));
          statRows.forEach((row, n) => [ row.name, row.points, Math.round(row.damage), row.kills, Math.round(row.friendly), row.revives ].forEach((val, c) => draw.text({
            x: cols[c], y: top + lineH * (n + 2), tur: 0, text: String(val), fontSize: 16, align: c ? '>' : '<', fill: '#fff'
          })));
          
        }
        
      });
      
      if (verboseLogging && ms > nextSampleMs) {
        nextSampleMs = ms + 30 * 1000;
        logger.log({ $$: 'flowCacheSample', ...flow.stats });
      }
      
    }
    
  });
  
};