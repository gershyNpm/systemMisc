import { rootFact } from '@gershy/disk';
import scriptBundle from '@gershy/script-bundle';
import type { Platform } from '@gershy/lilac-platformer';
import type { RunServerInpFnOut } from './util/runServer.ts';
import type Logger from '@gershy/logger';

const htmlRes = (inp: { body: string, head?: string }) => ({ code: 200, headers: { contentType: 'text/html' }, body: String[cl.baseline](`
  | <!doctype html>
  | <html>
  |   <head>
  |     <style>
  |       html { background-color: #ccc; }
  |       html, body { position: absolute; width: 100%; height: 100%; }
  |       pre { font-family: monospace; }
  |     </style>
  ${(inp.head ?? '').split('\n').map(ln => `|   ${ln}`).join('\n')}
  |   </head>
  |   <body>
  ${(inp.body      ).split('\n').map(ln => `|   ${ln}`).join('\n')}
  |   </body>
  | </html>
`)});

export type LocalServerInp = {
  logger: Logger,
  path: `/${string}`,
  body: Json,
  platformPrm: Promise<Platform> | Platform
};
export default async (inp: LocalServerInp): Promise<RunServerInpFnOut> => {
  
  const { logger, path, platformPrm } = inp;
  if (cl.isCls(platformPrm, Promise)) return htmlRes({ body: `<pre>Loading... (utc: ${Date.now()})</pre>` });
  
  if (path === '/status') {
    
    const platform: any = {}[cl.merge](platformPrm);
    delete platform.err?.errs; // Delete possible circular prop
    return htmlRes({ body: `<pre>${JSON.stringify(platformPrm, null, 2)}</pre>` });
    
  }
  
  if ([ '/', '/main' ][cl.has](path)) {
    
    if (cl.isCls(platformPrm, Promise)) return htmlRes({ body: '<pre>Loading...</pre>' });
    
    return htmlRes({
      head: String[cl.baseline](`
        | <script src="/script?platform=${encodeURIComponent(JSON.stringify(platformPrm[cl.slash]([ '!adminPass' ])))}" defer></script>
      `),
      body: ''
    });
    
  }
  
  if (path === '/script') {
    
    try {
      
      const body = await scriptBundle({
        platform: 'web',
        debug: false,
        dirFact: rootFact.kid([ import.meta.dirname ]),
        script: String[cl.baseline](`
          | import playServer from './playServer.ts';
          | playServer();
        `)
      });
      
      return {
        code: 200,
        headers: { contentType: 'text/javascript; charset=utf-8' },
        body
      };
      
    } catch (err: any) {
      
      logger.log({ $$: 'glitch', err });
      
      return {
        code: 200,
        headers: { contentType: 'text/javascript; charset=utf-8' },
        body: `throw Error('hot script bundling failed');`
      };
      
    }
    
  }
  
  return htmlRes({ body: '<pre>bad request sorry</pre>' });
  
};