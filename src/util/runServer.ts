import type Logger from '@gershy/logger';
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createServerHttps } from 'node:https';
import phrasing from '@gershy/util-phrasing'
import type Stream from 'node:stream';

// TODO: Consider creating @gershy/http-server - note this exact server is also spawned on
// Platformer Platforms

export type RunServerInpFnOut = { code: number | 'kill' | 'ignore', body: Json, headers: Obj<string> };
export type RunServerInp = {
  host?: string,
  port?: number,
  maxHeaderSize?: number,
  headersTimeout?: number,
  requestTimeout?: number,
  type: 'http' | 'https',
  logger: Logger,
  fn: (inp: { method: string, path: `/${string}`, query: `?${string}`, fragment: `#${string}`, body: Json, req: IncomingMessage, res: ServerResponse }) => Promise<RunServerInpFnOut>
};
export type Server = {
  rake: () => Promise<void>
};
export default async (inp: RunServerInp): Promise<Server> => {
  
  const {
    host = '0.0.0.0',
    port: rawPort,
    maxHeaderSize = 3000,
    headersTimeout = 3 * 1000,
    requestTimeout = 5 * 1000,
    type,
    logger,
    fn
  } = inp;
  const port = rawPort ?? { http: 80, https: 443 }[inp.type];
  
  const createServer = ({ http: createServerHttp, https: createServerHttps })[type] as typeof createServerHttps;
  const server = createServer({ maxHeaderSize, headersTimeout, requestTimeout });
  const sokts = new Set<Stream.Duplex>();
  server.on('connection', sokt => {
    sokts.add(sokt);
    sokt.once('close', () => sokts[cl.rem](sokt));
  });
  server.on('request', async (req, res) => logger.scope('invoke', { addr: req.socket.address() }, async () => {
    
    const method = (req.method ?? 'get')[cl.lower]();
    const [ , path='/', query='?', fragment='#' ] = ((req.url ?? '/').match(/^([/][^?#]*)([?][^#]*)?([#].*)?$/) ?? []) as [ unknown, `/${string}`, `?${string}`, `#${string}` ];
    
    const { code, body, headers = {} } = await cl.safe(async () => {
      
      const reqBodyRaw = await new Promise<string>((rsv, rjc) => {
        
        let len = 0;
        const chunks: Buffer[] = [];
        const timeout = setTimeout(() => end(Error('reject')[cl.mod]({ http: { code: 400, body: { msg: 'body sluggish' } } })), 5000);
        
        const end = (err: null | any) => {
          req.off('data', onData);
          req.off('end', end);
          if (!err) { rsv(Buffer.concat(chunks).toString('utf8')); }
          else      { rjc(err); req.socket.destroy(); }
          clearTimeout(timeout);
        };
        
        const onData = chunk => {
          if ((len += chunk.length) > (2 ** 15)) end(Error('reject')[cl.mod]({ http: { code: 400, body: { msg: 'body oversized' } } }));
          chunks.push(chunk);
        };
        const onEnd = () => end(null);
        req.on('data', onData);
        req.on('end', onEnd);
        
      });
      const reqBody = cl.safe(() => JSON.parse(reqBodyRaw || 'null') as Json, () => {
        throw Error('reject')[cl.mod]({ http: { code: 400, body: { msg: 'body json invalid', body: reqBodyRaw } } })
      });
      logger.log({ $$: 'parsed', path, method, query, fragment, body: reqBody });
      
      return await fn({ path, method, fragment, query, body: reqBody, req, res });
      
    }, err => {
      
      const { code, body, headers } = (err.http ?? {
        code: 500,
        body: { msg: 'unexpected error' },
        headers: { contentType: 'application/json' }
      }) as { code: number, body: Json, headers: Obj<string> };
      
      logger.log({ $$: code >= 500 ? 'glitch' : 'reject', err });
      return { code, body, headers };
      
    });
    
    if (code === 'ignore') return;
    
    if (code === 'kill') {
      req.socket.destroy();
      res.socket?.destroy();
      return;
    }
    
    const resType = cl.isCls(body, String) ? 'text' : 'json';
    const resBody = resType === 'json' ? JSON.stringify(body) : (body as string);
    res.writeHead(code, {
      contentType: ({ text: 'text/plain', json: 'application/json' } as const)[resType],
      contentLength: Buffer.byteLength(resBody).toString(10),
      ...headers
    }[cl.mapk]((v, k) => [ phrasing('camel->kebab', k), v ] as const));
    res.end(resBody);
    
  }));
  server.listen(port, host);
  
  await new Promise(rsv => server.once('listening', rsv));
  
  return Object.assign(server, { rake: async () => {
    
    server.removeAllListeners('request');
    server.removeAllListeners('connection');
    server.on('request',    req  => req.socket.destroy());
    server.on('connection', sokt => sokt.destroy());
    for (const sokt of sokts) sokt.destroy();
    sokts.clear();
    
    await new Promise(rsv => server.close(rsv));
    
  }});
  
};