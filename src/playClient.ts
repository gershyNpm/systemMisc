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
      body.setAttribute('inert', '');
      
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
      
      tick: inp => (inp.elapsedPms > 8) && logger.log({ $$: 'timeStep.tick', ...inp[cl.map](v => Math.round(v)) })
      
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
            
          logger.log({ $: 'ignore', event });
          
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
      
      while (true) {
        
        const { done, value: event } = await hear.next() as { done: boolean, value: Play.AckEvent };
        if (done) break;
        
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
        if (!honoured) logger.log({ msg: 'event dishonoured', input, honoured, offsetToServer });
        
        // An honoured input is already in the timeline exactly as the server resolved it
        if      (!input)    play.addEvent(serverEvent as Play.Event);
        else if (!honoured) play.replaceEvent(input.event, serverEvent as Play.Event);
        
      }
      
      connected = false;
      
    }).catch(() => logger.log({ $: 'sokt.glitch' }));
    
    await stateJoinedPrm;
    
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
        act5: 'KeyC',
        act6: 'KeyV'
        
      };
      const actMap = binds[cl.mapk]((v, k) => [ v, k ]); // Maps key codes to their corresponding action
      const btnState = binds[cl.map](v => '-');
      for (const dir of [ '+', '-' ] as const) elems.html.addEventListener({ '+': 'keydown', '-': 'keyup' }[dir], (evt: { timeStamp: number, code: string }) => {
        
        // Event can be delayed due to event loop and other factors - ignore excessively late
        // events as the server will reject them either way!
        const evtNow = performance.timeOrigin + evt.timeStamp;
        if (evtNow < (Date.now() - 100)) return;
        
        const btn = actMap[cl.at](evt.code, null);
        if (btn === null) return;
        
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
    
    const { Player } = play.registry;
    const patienceMs = 20;
    const offsetMs = play.getOffsetMs();
    const draw = new Draw({ canvas: elems.canvas });
    let nextSampleMs = -Infinity;
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
      
      const debugView = true;
      
      const vertMeters = debugView ? 50 : 25; // Vertical height in meters of viewbox
      const amtBack = 0.7;                    // At 1 the player renders right at the bottom edge of the viewbox; at 0 they render in the middle
      
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
          shift.trn({ x: 0, y: vertMeters * 0.5 * amtBack });  // Shift focus towards bottom of screen
          shift.tur(-(off.tur + 0.25));
          shift.trn(off.pos.mult(-1));
          
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
            // draw.clip(() => {
            //   stage.renderAreaClip(flow, draw); // Clips, e.g., only the interiors of spaces!
            // });
            
            if (!debugView) draw.clip(() => {
              stage.renderClip(flow, draw);
              for (const k in entities) entities[k].renderClip(flow, draw);
            });
            
            // Set the base visible ground to this colour (TODO: let `Stage.prototype.render` handle this?)
            draw.circle({ pos: off.pos, r: 1000, fill: '#ccc' });
            
            // This skips past all `z < 0` then renders from lowest to highest (only where (`z >= 0`)
            for (const renderOp of renderOps)
              if (renderOp.z >= 0)
                renderOp.fn();
            
          });
          
          // Render on top of the clipped game world
          for (const { z, fn } of renderOps) {
            
            if (z >= 0) break;
            fn();
            
          }
          
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
        
      });
      
      if (ms > nextSampleMs) {
        nextSampleMs = ms + 30 * 1000;
        logger.log({ $$: 'flowCacheSample', ...flow.stats });
      }
      
    }
    
  });
  
};