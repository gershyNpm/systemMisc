import '@gershy/clearing';
import { Platformer } from '@gershy/lilac-platformer';
import { Garden, Soil } from '@gershy/lilac';
import { Domain } from '@gershy/lilac-domain';
import type Logger from '@gershy/logger';
import type { Fact } from '@gershy/disk';
import playServer from './playServer.ts';
import type { Play } from './play.ts';

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
        invokeFn: async ({ logger, utcMs: serverUtcMs, launchData, session, inp }) => {
          
          // Consider trusted `utcMs` vs untrusted `inp.utcMs`...
          
          if (!((v): v is Play.ClientEvent & { op: 'player.key', id: string } => cl.isCls(v, Object) && v.op === 'player.key')(inp)) return null;
          
          const { id, ms: clientUtcMs, ...props } = inp;
          
          const player = launchData.players.get(session.id)!;
          const utcMs = Math.max(Math.min(clientUtcMs, serverUtcMs), serverUtcMs - 20); // Declared-late events are snapped to the present; declared-early events are tolerated within a certain threshold
          const ms = utcMs - launchData.ticker.startUtcMs;
          
          const event = { ...props, ms, session: { id: player.session.id } };
          launchData.addEventAndBroadcast(
            player,
            event,
            evt => ({ ...evt, ack: { id, clientUtcMs, serverUtcMs, resolvedUtcMs: utcMs } })
          );
          
          return null;
          
        }
        
      }));
      
      return { platformer: platformer.addPollen() };
      
    }
    
  });
  
  const soil = new Soil.AwsCloud({ logger, garden, auth });
  return garden.grow(soil);
  
};