import '@gershy/clearing';
import { PollenSession } from '@gershy/lilac-platformer/main/pollenSession';
import Logger from '@gershy/logger';
import type { Platform } from '@gershy/lilac-platformer';
import type { PlayOp } from './gardenGrow.ts';

namespace Browser {
  
  export namespace Node {
    
    export type Script = Node & {
      src: string
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
    
    style: Obj<string>,
  };
  
  export type Window = {
    lilacData: {
      dnsHost: string
    },
    document: {
      querySelector: (sel: string) => null | Node,
      currentScript: Browser.Node.Script,
      createElement: (type: string) => Node
    }
  };
  
};
export default async () => {
  
  // TODO: HEEERE1 hot load works
  // [X] Websocket connection can fail (but maybe the task just timed out??)
  // [ ] Work on event/replay multiplayer logic
  // [ ] Consider esbuild improvement (tolerate node modules when bundling for web; only fail if resolved/tree-shaken bundle still includes them)
  // [ ] Eliminate references to `global` and `process` where possible
  // [ ] Still a lot of todos in Platformer (priority concern: admin-over-non-tls-http)
  
  type BrowserInp = {
    platform: Omit<Platform, '!adminPass'>
  };
  
  Object.assign(globalThis, { process: {}, global: globalThis }); // TODO: Really should avoid using these references anywhere... they're nodejs-only!
  
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
    
    const browser = globalThis as any as Browser.Window;
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
      
      const canvas = browser.document.createElement('canvas');
      Object.assign(canvas.style, {
        position: 'absolute',
        left: '0', top: '0',
        width: '100%', height: 'calc(100% - 30px)',
        pointerEvents: 'none'
      });
      body.appendChild(canvas);
      
      const status = browser.document.createElement('div');
      Object.assign(status.style, {
        position: 'absolute', boxSizing: 'border-box',
        left: '0', bottom: '0',
        width: '100%', height: '30px', lineHeight: '30px', padding: '0 0.6em',
        backgroundColor: '#000',
        color: '#fff',
        pointerEvents: 'none'
      });
      status.textContent = 'loading ...';
      body.appendChild(status);
      
      return { html, canvas, status };
      
    })();
    
    const session = await logger.scope('sessionLaunch', {}, async logger => {
      const session = new PollenSession({ flowerId: `domain/${browserInp.platform.dnsHost!}` as const });
      const { sessionId } = await session.getDef();
      logger.log({ $$: 'result', sessionId });
      return Object.assign(session, { id: sessionId });
    });
    
    for await (const msg of await session.hear(logger)) {
      
      const { tick, numOnline } = msg as {
        tick: number,
        numOnline: number
      };
      elems.status.textContent = `id: ${session.id}; num online: ${numOnline}; tick: ${tick}`;
      
    }
    
    const binds = {
      
      dirL: 'KeyA', // evt.code === 'KeyL'
      dirR: 'KeyD',
      dirU: 'KeyW',
      dirD: 'KeyS',
      
      act0: 'Space',
      act1: 'KeyK',
      act2: 'KeyL',
      act3: 'Semicolon',
      act4: 'Quote'
      
    };
    const actMap = binds[cl.mapk]((v, k) => [ v, k ]); // Maps key codes to their corresponding action
    
    for (const dir of [ 'up', 'dn' ] as const) elems.html.addEventListener({ dn: 'keydown', up: 'keyup' }[dir], (evt: { code: string }) => {
      
      const key = actMap[cl.at](evt.code, null);
      if (key === null) return;
      
      session.tell({ logger, msg: {
        
        op: 'play',
        utcMs: Date.now(),
        key,
        dir
        
      } satisfies PlayOp });
      
    });
    
  });
  
};