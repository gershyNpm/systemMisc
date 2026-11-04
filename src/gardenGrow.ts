import '@gershy/clearing';
import { Platformer } from '@gershy/lilac-platformer';
import { Garden, Soil } from '@gershy/lilac';
import { Domain } from '@gershy/lilac-domain';
import type Logger from '@gershy/logger';
import type { Fact } from '@gershy/disk';
import { launchFn, invokeFn } from './playServer.ts';
import { assetGen } from './localInterfaceServer.ts';

export default async (inp: { logger: Logger, repoFact: Fact, auth: Soil.AwsAuth, webBundle: boolean }) => {
  
  const { logger, repoFact, auth } = inp;
  
  // Bundle web assets into strings
  const webAssets = await (async () => {
    
    if (!inp.webBundle) return null;
    
    const [ html, js ] = await Promise.all([
      assetGen.html({ ipHost: 'self', dnsHost: 'self' }),
      assetGen.js()
    ]);
    
    inp.logger.log({ $$: 'awsBundledWebAssets', charSizes: { html, js }[cl.map](v => v.body.length) });
    
    return { html, js };
    
  })();
  
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
        power: 2,
        domain: new Domain({ addr: 'gershommaes.com', manualConfirmations: { nameServersConnected: true } }),
        certFact: repoFact.par().kid([ '.manager', 'dev', 'cert' ]),
        localData: {
          ...(!webAssets ? {} : { webAssets })
        },
        launchFn,
        invokeFn
        
      }));
      
      return { platformer: platformer.addPollen() };
      
    }
    
  });
  
  const soil = new Soil.AwsCloud({ logger, garden, auth });
  return garden.grow(soil);
  
};