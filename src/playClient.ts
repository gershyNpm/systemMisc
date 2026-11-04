import '@gershy/clearing';
import { PollenSession } from '@gershy/lilac-platformer/main/pollenSession';
import Logger from '@gershy/logger';
import { Draw } from './util/draw.ts';
import type { Platform } from '@gershy/lilac-platformer';
import playFn, { type Play } from './play.ts';
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
    performance: {
      timeOrigin: number,
      now: () => number
    }
  };
  
};
export default async () => {
  
  // TODO: HEEERE1 hot load works
  // [X] Websocket connection can fail (but maybe the task just timed out??)
  // [X] Work on event/replay multiplayer logic
  // [ ] Consider esbuild improvement (tolerate node modules when bundling for web; only fail if resolved/tree-shaken bundle still includes them)
  // [ ] Eliminate references to `global` and `process` where possible - they break sovereignty
  // [ ] Still a lot of todos in Platformer (priority concern: admin-over-non-tls-http)
  
  type BrowserInp = {
    platform: Omit<Platform, '!adminPass'>
  };
  
  Object.assign(globalThis, { process: {}, global: globalThis, zzz: true }); // TODO: ZZZ Really should avoid using these references anywhere... they're nodejs-only!
  
  const logger = new Logger('browser', {}, { maxStrLen: 1000 }, (ctx: any) => {
    
    const { $, msg, ...more } = ctx;
    const hasMore = !more[cl.empty]();
    console.log(
      
      ...(msg
        ? [ `%c ${$.$}\n%c ${msg}${hasMore ? '\n' : ''}` ]
        : [ `%c ${$.$}${''      }${hasMore ? '\n' : ''}` ]
      ),
      
      'font-weight: bold;',
      ...(msg ? [ 'font-style: italic;' ] : []),
      
      ...(hasMore ? [ more ] : [])
      
    );
    
  });
  
  await logger.scope(null, {}, async logger => {
    
    let nowOffMs = 0;
    const clientNow = (now = Date.now()) => {
      
      // Replacement for `Date.now()` intended to be continuously calibrated so that client ms
      // queries correspond as closely as possible to server ms
      // (TODO: use `performance` for more precision?)
      
      return now += nowOffMs;
      
    };
    
    let last = { now: -Infinity, reps: 0 };
    const inputNow = (now = clientNow()) => {
      
      // Returns timestamps for inputs / rapid events - calls within the same millisecond use a low
      // decimal place to achieve stable ordering
      
      if (now <= last.now) return last.now + (++last.reps) * 0.00001;
      
      last = { now, reps: 0 };
      return now;
      
    };
    
    const browser = globalThis as any as Browser.Window;
    const errHandler = (err: any) => {
      console.log('TOP LEVEL ERROR', { err });
    };
    browser.addEventListener('error',              evt => errHandler(evt.error));
    browser.addEventListener('unhandledrejection', evt => errHandler(evt.reason));
    
    const browserInp: BrowserInp = browser.document.currentScript.src.split('?')[1]
      .split('&')
      [cl.toObj](v => v[cl.cut]('=', 1))
      [cl.map](v => cl.safe(() => JSON.parse(decodeURIComponent(v)), () => v)) as any;
    
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
      body.appendChild(status);
      
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
      const session = new PollenSession({ flowerId: `domain/${browserInp.platform.dnsHost!}` as const });
      const { sessionId } = await session.getDef(logger);
      logger.log({ $$: 'result', sessionId });
      return Object.assign(session, { id: sessionId });
    });
    
    elems.queueStatus('loaded session!');
    
    const play = (browser as any).play = playFn();
    const stateJoinedPrm = Promise[cl.later]();
    
    // Sokt event processing
    const myEvts: (Play.ClientEvent & { id: string })[] = [];
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
      
      const receivedStateDataUtcMs = Date.now();
      const estimatedLatencyMs = 4;
      nowOffMs = -receivedStateDataUtcMs + (stateData.utcMs + estimatedLatencyMs);
      
      elems.queueStatus('joining state...');
      play.timeStep.decode(stateData.state as any);
      play.setPendingEvents(stateData.pendingEvents as any);
      play.setOffsetMs(clientNow(play.ticker.startUtcMs) - stateData.startUtcMs);
      elems.queueStatus('joined state!');
      stateJoinedPrm.resolve();
      
      while (true) {
        
        const { done, value: event } = await hear.next() as { done: boolean, value: Play.AckEvent };
        if (done) break;
        
        const { ack = null } = event;
        if (ack) {
          const corr = myEvts.find(evt => evt.id === ack.id);
          if (corr) logger.log({ ping: Date.now() - corr.ms, honoured: ack.resolvedUtcMs === ack.clientUtcMs, offsetToServer: ack.serverUtcMs - ack.clientUtcMs });
        }
        
        play.addEvent(event);
        
      }
      
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
        const evtNow = browser.performance.timeOrigin + evt.timeStamp;
        if (evtNow < (Date.now() - 100)) return;
        
        const btn = actMap[cl.at](evt.code, null);
        if (btn === null) return;
        
        if (btnState[btn] === dir) return;
        btnState[btn] = dir;
        
        const event: Play.ClientEvent & { id: string } = {
          ms: inputNow(clientNow(evtNow)),
          id: Math.random().toString(36).slice(2),
          op: 'player.key',
          btn: `${dir}${btn}` as const,
        };
        myEvts.push({ ...event, ms: Date.now() });
        while (myEvts.length > 30) myEvts.shift();
        
        session.tell({ logger, msg: event });
        
      });
      
    })();
    
    const { Player } = play.registry;
    const offsetMs = play.getOffsetMs();
    const draw = new Draw({ canvas: elems.canvas });
    while (true) {
      
      await new Promise<void>(r => browser.requestAnimationFrame(r));
      
      const { canvas } = elems;
      const bound = canvas.getBoundingClientRect();
      const [ cw, ch ] = [ Math.ceil(bound.width), Math.ceil(bound.height) ];
      if (canvas.width  !== cw) canvas.width  = cw;
      if (canvas.height !== ch) canvas.height = ch;
      
      const ms = (Date.now() - play.ticker.startUtcMs) + offsetMs;
      const flow = { ms, sc: ms * 0.001 };
      
      const stage = play.timeStep.getState().world.getStage(flow);
      const entities = stage.getEntities(flow);
      const player = entities[cl.at](`${Player.clsName}/${session.id}`, null) as null | Play.Registry['Player'];
      
      const vertMeters = 40;       // Vertical height in meters of viewbox
      const amtBack = 0.7;          // At 1 the player renders right at the bottom edge of the viewbox; at 0 they render in the middle
      
      draw.fresh({ fill: '#400' }, () => {
        
        draw.frame(shift => {
          
          const drawMid = draw.mid();
          const h = drawMid.y * 2;
          const off = player
            ? player.getTransform(flow)
            : { pos: new Pt({ x: 0, y: 0 }), tur: 0 }; // TODO: midpoint of squad
          
          shift.trn(drawMid);                                  // Relative to center of canvas
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
            
            draw.clip(() => {
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
        
      });
      
    }
    
  });
  
};