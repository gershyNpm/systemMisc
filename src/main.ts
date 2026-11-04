import '@gershy/clearing';
import { type Platform } from '@gershy/lilac-platformer';
import { entry } from '@gershy/entry';
import { Soil } from '@gershy/lilac';
import { rootFact } from '@gershy/disk';
import gardenGrow from './gardenGrow.ts';
import runServer from './util/runServer.ts';
import localServer from './localServer.ts';
import tracked from './util/tracked.ts';
import './play.ts'; // Only imported so that runtime validation fails early (e.g. registry class names)

// TODO: Think about something like @gershy/lilac-entry which is like @gershy/entry but specialized
// for growing / updating / querying / debugging (pulling logs) / raking a garden... ("gardener"?)

const codec = { type: 'rec', loose: true, props: {
  op: { req: true, type: 'enum', opts: [ 'launch' ] }
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
  
  const growPrm = gardenGrow({ logger, repoFact, auth: rootCfg.aws.auth });
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
    
    const server = await runServer({
      
      host: '127.0.0.1',
      port: 3333,
      logger: logger.kid('server'),
      type: 'http',
      fn: async ({ path, body }) => localServer({ logger, path, body, platformPrm })
      
    });
    trk(() => server.rake());
    
    logger.log('Platform active');
    
    while (active) await new Promise(r => setTimeout(r, 250));
    
  }
  
})});