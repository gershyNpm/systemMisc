import '@gershy/clearing';
import { Platformer } from '@gershy/lilac-platformer';
import { Garden, Soil } from '@gershy/lilac';
import { Domain } from '@gershy/lilac-domain';
import type Logger from '@gershy/logger';
import type { Fact } from '@gershy/disk';
import playServer from './playServer.ts';

export type PlayOp = {
  op: 'play',
  utcMs: number,
  key: `dir${'L' | 'R' | 'U' | 'D'}` | `act${0 | 1 | 2 | 3 | 4}`,
  dir: 'up' | 'dn'
};

export default async (inp: { logger: Logger, repoFact: Fact, auth: Soil.AwsAuth }) => {
  
  const { logger, repoFact, auth } = inp;
  const garden = new Garden({
    
    logger,
    pfx: 'gershymisczombie',
    debug: true,
    defaults: { region: 'ca-central-1' },
    
    infraFact: repoFact.kid([ 'infra' ]),
    patioFact: repoFact.kid([ 'patio' ]),
    shedFact: repoFact.par(1).kid([ '.manager', 'dev', 'shed', 'systemMisc' ]),
    seedBank: { Domain, Platformer },
    survey: ({ Domain, Platformer }, add) => {
      
      const platformer = add(new Platformer({
        
        name: 'platformer',
        baseUrl: import.meta.url,
        power: 0,
        domain: new Domain({ addr: 'gershommaes.com', manualConfirmations: { nameServersConnected: true } }),
        certFact: repoFact.par().kid([ '.manager', 'dev', 'cert' ]),
        localData: {
          state: { terrain: [], players: [] }
        },
        launchFn: playServer,
        invokeFn: async ({ utcMs, launchData, session, inp }) => {
          
          // Consider trusted `utcMs` vs untrusted `inp.utcMs`...
          
          if (!((v): v is PlayOp => cl.isCls(v, Object) && v.op === 'play')(inp)) return null;
          
          const player = launchData.players.get(session.id)!;
          player.actions.push({ ...inp, utcMs: Math.min(inp.utcMs, utcMs) });
          return null;
          
        }
        
      }));
      
      return { platformer: platformer.addPollen() };
      
    }
    
  });
  
  const soil = new Soil.AwsCloud({ logger, garden, auth });
  return garden.grow(soil);
  
};