import { rootFact } from '@gershy/disk';
import Logger from '@gershy/logger';
import { launchFn, invokeFn } from './playServer.ts';
import * as play from './play.ts';
import runServer from '@gershy/nodejs-http-server';
import { WebSocketServer } from 'ws';

export default async (inp: { debug: boolean, host: string, port: number, lagMs: () => number }) => {
  
  const { debug, host, port, lagMs } = inp;
  
  const waitLag = () => {
    const lms = lagMs();
    if (lms === 0) return;
    return new Promise(rsv => setTimeout(rsv, lms));
  };
  const orderedLag = () => {
    
    let prm: Promise<any> = Promise.resolve();
    return () => prm = Promise.all([ prm, waitLag() ]);
    
  };
  
  type Session = {
    alive: boolean,
    ms: number,
    id: string,
    sokt: any,
    send: (inp: Json) => void,
    init?: { cancel: () => void },
    cancel: () => void
  };
  const sessionKeeper = {
    sessions: new Map<Session['id'], Session>(),
    launch: (session: Session) => ({ cancel: () => {} }),
  };
  
  const logFact = rootFact.kid([ import.meta.dirname ]).par().kid([ 'infra', 'log', `localGame-${Date.now()}.log.txt` ]);
  const logHeadStream = await logFact.getDataHeadStream();
  const logger = new Logger('localGame', {}, { maxStrLen: 500 }, obj => {
    logHeadStream.write(JSON.stringify({ ...obj, $: { ms: Date.now(), ...obj.$ } }));
    logHeadStream.write('\n');
  });
  const jsfnImport = (inp: string) => {
    if (inp === './play.ts') return play;
    throw Error('no');
  };
  
  const launchData = await launchFn({
    jsfnImport,
    debug,
    logger: logger.kid('launch'),
    localData: {},
    sessionKeeper
  });
  const server = await runServer({
    host,
    port,
    logger: logger.kid('server'),
    type: 'http',
    fn: async inp => {
      
      await waitLag();
      inp.utcMs = Date.now();
      
      if (inp.path === '/ping') return { code: 200, body: { msg: 'pong' } };
      
      const sessionId = inp.path.split('/').at(-1)!; // Ignore all but last component?
      const session = sessionKeeper.sessions.get(sessionId);
      if (!session) return { code: 400, body: { msg: 'bad request' } };
      
      const res = { code: 200, body: await invokeFn({
        jsfnImport,
        logger,
        launchData,
        sessionKeeper,
        session,
        utcMs: inp.utcMs,
        channel: { type: 'http', path: inp.path, method: inp.method, query: inp.query },
        inp: inp.body
      })};
      await waitLag();
      return res;
      
    }
  });
  
  const soktServer = new WebSocketServer({ server });
  soktServer.on('connection', sokt => {
    
    const headLag = orderedLag();
    const tailLag = orderedLag();
    
    const session: Session = {
      alive: true,
      ms: Date.now(),
      id: Math.random().toString(36).slice(2),
      sokt,
      send: async (inp: Json) => {
        await headLag();
        sokt.send(
          JSON.stringify(inp),
          (err?: null | Error) => {
            
            if (!err) return;
            
            const worrisome = true
              && !/^websocket is not open/i.test(err.message);
            
            if (worrisome) 
              logger.log({ $$: 'sokt.session.glitch', session: { id: session.id }, sokt: { readyState: sokt.readyState }, inp, err });
            
            session.cancel();
            
          }
        );
      },
      cancel: () => {
        
        if (!session.alive) return;
        logger.log({ $$: 'sokt.session.cancel', session: { id: session.id }, sokt: { readyState: sokt.readyState } });
        session.alive = false;
        
        sessionKeeper.sessions.delete(session.id);
        session.init?.cancel();
        cl.safe(() => sokt.close(), () => {});
        
      }
    };
    
    sessionKeeper.sessions.set(session.id, session);
    logger.log({ $$: 'sokt.session.open', session: { id: session.id } });
    session.send({ t: 'id', id: session.id });
    session.init = sessionKeeper.launch(session);
    
    sokt.on('message', async inp => {
      
      await tailLag();
      
      const utcMs = Date.now();
      if (cl.isCls(inp, Array)) inp = Buffer.concat(inp);
      if (cl.isCls(inp, ArrayBuffer)) inp = Buffer.from(new Uint8Array(inp));
      inp = JSON.parse(inp);
      
      await invokeFn({
        jsfnImport,
        logger,
        launchData,
        sessionKeeper,
        session,
        utcMs,
        channel: { type: 'sokt' },
        inp
      });
      
    });
    sokt.on('close', (code, reason) => {
      logger.log({
        $$: 'sokt.cancel',
        session: { id: session.id, durationMs: Date.now() - session.ms },
        code,
        reason: reason.toString('utf8'),
        sokt: { readyState: sokt.readyState }
      });
      session.cancel();
    });
    sokt.on('error', err => {
      logger.log({ $$: 'sokt.glitch', session: { id: session.id }, sokt: { readyState: sokt.readyState }, err });
      session.cancel();
    });
    
  });
  
  return {
    task: { desc: 'mock task' },
    '!adminPass': 'adminpass',
    ipHost: `${host}:${port.toString(10)}`,
    dnsHost: null
  };
  
};