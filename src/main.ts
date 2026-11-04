import '@gershy/clearing';
import { type Platform } from '@gershy/lilac-platformer';
import { entry } from '@gershy/entry';
import { Soil } from '@gershy/lilac';
import { rootFact } from '@gershy/disk';
import gardenGrow from './gardenGrow.ts';
import runServer from '@gershy/nodejs-http-server';
import localServer from './localInterfaceServer.ts';
import tracked from './util/tracked.ts';
import './play.ts'; // Only imported so that runtime validation fails early (e.g. registry class names)
import localGameServer from './localGameServer.ts';


// TODO: Think about something like @gershy/lilac-entry which is like @gershy/entry but specialized
// for growing / updating / querying / debugging (pulling logs) / raking a garden... ("gardener"?)

const codec = { type: 'rec', loose: true, props: {
  op:     { req: true, type: 'enum', opts: [ 'launch' ] },
  server: { req: true, type: 'enum', opts: [ 'local', 'local+aws', 'webBundledAws' ] }
}} as const;
entry({ name: 'misc', codec, log: { format: { maxStrLen: 3000 } }, fn: async (logger, inp) => tracked(async trk => {
  
  let active = true;
  process.on('sigint'[cl.upper](), () => {
    if (active) {
      logger.log({ $$: 'cancel', msg: 'force exit in 15min' });
      setTimeout(() => { logger.log({ $$: 'force.cancel' }); process.exit(1); }, 1000 * 60 * 15)
      active = false;
    } else {
      logger.log({ $$: 'cancel', msg: 'cancellation already in progress' });
    }
  });
  
  logger.log({ $$: 'inp', inp });
  
  const { op } = inp;
  
  const repoFact = rootFact.kid([ import.meta.dirname ]).par();
  const rootCfg = await repoFact.par().kid([ '.manager', 'config.json' ]).getData<{ aws: { auth: Soil.AwsAuth } }>('json');
  
  const growPrm = (() => {
    
    if (inp.server === 'local+aws')     return gardenGrow({ logger, repoFact, auth: rootCfg.aws.auth, webBundle: false });
    
    if (inp.server === 'webBundledAws') return gardenGrow({ logger, repoFact, auth: rootCfg.aws.auth, webBundle: true });
    
    // The launched `Platform` resulting from `platformLaunch` is simply serialized and included in
    // the query param to the script; the script simply uses its `dnsHost` property to connect!
    
    const wave = (v: number) => (1 + Math.sin(v * 2 * Math.PI)) * 0.5;
    return Promise.resolve({ ornaments: { platformer: {
      
      platformLaunch: async () => localGameServer({
        debug: false,
        host: '192.168.2.15',
        port: 3330,
        lagMs: () => 0
          + 15                                         // Minimum 15ms lag
          + wave(Date.now() / (1000 * 20)) ** 2.5 * 40 // 40ms lag cresting every 20sec
          + wave(Date.now() / (1000 * 23)) ** 3.5 * 40 // 40ms lag cresting every 23sec
          + Math.random() * Math.random() * 40         // up to 40ms random lag
      }),
      platformCancel: async () => {}
      
    }}});
    
  })();
  trk(async () => { await growPrm; }); // Always wait for the garden to grow - avoid interrupting the growth
  
  if (op === 'launch') {
    
    let platformPrm: Platform | Promise<Platform> = growPrm
      .then(grown => grown.ornaments.platformer.platformLaunch({ logger }))
      .then(p => platformPrm = p);
    trk(() => cl.safe(
      async () => {
        const [ { ornaments }, platform ] = await Promise.all([ growPrm, platformPrm ]);
        await ornaments.platformer.platformCancel({ logger, platform });
      },
      err => {} // Ignore errors - if either the garden or platform failed, there's no platform to clean up
    ));
    
    if ([ 'local', 'local+aws' ][cl.has](inp.server)) {
      
      const interfaceServer = await runServer({
        host: '192.168.2.15',
        port: 3333,
        logger: logger.kid('server'),
        type: 'http',
        fn: async ({ path, body }) => localServer({ logger, path, body, platformPrm })
      });
      trk(() => interfaceServer.cancel());
      
    } else {
      
      logger.log({ msg: 'the full app is hosted in aws! domain name available shortly...' });
      platformPrm.then(platform => {
        logger.log({ msg: `domain name available! join at https://${platform.dnsHost}` });
      });
      
    }
    
    while (active) await new Promise(r => setTimeout(r, 250));
    
  }
  
})});