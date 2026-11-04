import type { PlatformInvokeFn, PlatformLaunchFn, Session } from '@gershy/lilac-platformer';
import type { Play }                                        from './play.ts';

type LocalData = {
  webAssets?: { [K in 'html' | 'js']: { code: number, headers?: Obj<string>, body: string } }
};

export const launchFn = (async inp => {
  
  const { default: playFn } = inp.jsfnImport('./play.ts') as typeof import('./play.ts');
  
  const { logger, sessionKeeper, localData } = inp;
  
  // TODO: name claim/release could be more efficient with a static shuffled array...
  type Player = {
    session: Session,
    name: string
  };
  const names = new Set(
    'acceptor ace achiever adept adherent admirer adorer adviser advisor advocate aesthete aid aide alannah ally altruist agent amoret angel apostle arbiter artisan artist artiste aspirant asset assignee assigner athlete author baby backbone backer backup baron beatus beauty begetter being believer belle benefit bestower bigwig biophile blessing boss booster brain brother bud buddy buff builder captain carer catalyst cause chair champ champion chaperon charmer cherub chief chieftan child chum clerisy climber cohort coiner composer comrade confrere consoler consul convive counsel count creator credit crew cub curator cynosure dad dancer darling daughter dean dear defender designer devisee devisor devotee digerati dilly director disciple doer doll donee donor doozy doula doyen doyenne duke dynamo earl ecstatic einstein elder employer endorser engineer enophile ensurer epicure epitome escort essence example exec exemplar expert exponent family fan fancier fireball fireman flame folks foodie force foreman foreseer founder fount fountain friend gem genius gift givee giver godsend gourmet governor grandee grantee grantor guardian guest guide guru handler head heart height heir heiress help helper helpmate hero heroine hit hopeful host hotshot husband icon ideal idol idolizer infant innocent inspirer intimate inventor invitee inviter keeper key kingpin knight lady lamb laureate lead leader legatee legator legend liberal livewire lord lover lulu luminary maestro magician maker manager marquess marquis marvel master mediator mentor minder miracle mate model mom monitor moppet mother motor mover nabob neophile neonate neoteric nestling newborn nipper nobleman nonesuch notable nurse nursling nurturer officer official omnist operator optimist original overseer owner pacifier pal paladin pangloss paradigm paragon pard parent partisan partner patron peach pearl peer pet phenom pigsney pilot pioneer pinnacle pinup pistol planner player playmate plum poet polymath premier presence prince princess pro proctor prodigy producer progeny promoter prophet proposer protean provider purist purveyor qualtagh reacher receiver redeemer reliever rejoicer resolver resource rewarder romantic romeo rooter ruler runner sage saint saver saviour savant schatzi scholar scion scripter sculptor seeker sentinel servant server sharpy shaver sire sister skipper smoothie soul sponsor sprite sprout squire standard star socius solon staker steward striver student stylist success sugar suitor superior superman supplier support surety survivor swain tadpole teacher teammate testator thinker tootsie tot trainer treasure trier trustee tutelary tutor tycoon upholder urchin vaulter victor victress victrix viscount vip visitor virtuoso votary warantee warantor warden whip whiz whizz wife winner wizard wonder wooer workmate writer younker youth'
      .split(' ')
  );
  const playerMap = new Map<Session['id'], Player>();
  
  const play = playFn({ observe: {
    tick: inp => (inp.elapsedPms > 8) && logger.log({ $$: 'timeStep.tick', ...inp[cl.map](v => Math.round(v)) })
  }});
  play.setPatienceMs(160);
  
  const launchData = {
    ...play,
    addEventAndBroadcast: (player: Player, event: Play.Event, sourceMod: (evt: Play.Event) => Skip | Play.Event = v => v) => {
      
      // Ignore events associated with ended sessions
      if (!playerMap.has(player.session.id)) return;
      
      // Send the event to the TimeStep
      play.addEvent(event);
      
      // Broadcast the event to all sessions
      for (const p of playerMap.values()) {
        
        if (p !== player) {
          
          p.session.send(event);
          
        } else {
          
          const evt = sourceMod(event);
          if (evt) p.session.send(evt);
          
        }
        
      }
      
    },
    players: playerMap,
    webAssets: localData.webAssets ?? null
  };
  
  sessionKeeper.launch = session => {
    
    const player = { session, name: (() => {
      
      if (!names.size) return `~${Math.random().toString(36).slice(2, 10)}`;
      
      const it = names.values();
      const ind = Math.floor(Math.random() * names.size);
      for (let i = 0; i < ind; i++) it.next();
      
      const name = it.next().value!;
      names.delete(name);
      return name;
      
    })()};
    
    playerMap.set(session.id, player);
    
    logger.log({ $$: 'session.launch', sessionId: session.id, name: player.name });
    
    // Give the player the data needed to join at this stage
    player.session.send({
      op: 'state.launch',
      startUtcMs: play.ticker.startUtcMs,
      utcMs: Date.now(),
      state: play.timeStep.encode(),
      pendingEvents: play.getPendingEvents()
    });
    
    launchData.addEventAndBroadcast(player, {
      op: 'player.launch',
      ms: Date.now() - play.ticker.startUtcMs,
      name: player.name,
      session: { id: session.id }
    });
    
    return { cancel: () => {
      
      const player = playerMap.get(session.id)!;
      
      logger.log({ $$: 'session.cancel', sessionId: session.id, name: player.name });
      
      launchData.addEventAndBroadcast(player, {
        op: 'player.cancel',
        ms: Date.now() - play.ticker.startUtcMs,
        session: { id: session.id }
      });
      
      if (!player.name[cl.hasHead]('~')) names.add(player.name);
      playerMap.delete(session.id);
      
    }};
    
  };
  
  return launchData;
  
}) satisfies PlatformLaunchFn<LocalData, any>;

export const invokeFn = (async inp => {
  
  // Consider trusted `utcMs` vs untrusted `inp.ms`...
  
  if (inp.channel.type === 'http') return { $http: (() => {
    
    if (!inp.launchData.webAssets) return { code: 500, body: 'web assets not available' };
    
    if (inp.channel.path === '/')       return inp.launchData.webAssets.html;
    if (inp.channel.path === '/script') return inp.launchData.webAssets.js;
    
    return { code: 404, body: 'missing' };
    
  })() };
  
  const { utcMs: serverUtcMs, launchData, session, inp: gameInp } = inp;
  
  if (!session) throw Error('session missing');
  const player = launchData.players.get(session.id);
  if (!player) return null;
  
  if (cl.isCls(gameInp, Object) && gameInp.op === 'state.sync') {
    player.session.send({
      op: 'state.sync',
      state: launchData.timeStep.encode(),
      pendingEvents: launchData.getPendingEvents()
    });
    return null;
  }
  
  if (!((v): v is Play.ClientEvent & { op: 'player.key', id: string } => cl.isCls(v, Object) && v.op === 'player.key')(gameInp)) return null;
  
  // All timestamps below are relative to the TimeStep, i.e. to `ticker.startUtcMs`
  const { id, ms: clientMs, ...props } = gameInp;
  
  const clientLatencyToleranceMs = 150;
  const serverMs = serverUtcMs - launchData.ticker.startUtcMs;
  const ms = Math.max(Math.min(clientMs, serverMs), serverMs - clientLatencyToleranceMs); // Declared-late events are snapped to the present; declared-early events are tolerated within a certain threshold
  
  const event = { ...props, ms, session: { id: player.session.id } };
  launchData.addEventAndBroadcast(
    player,
    event,
    evt => ({ ...evt, ack: { id, clientMs, serverMs, resolvedMs: ms } })
  );
  
  return null;
  
}) satisfies PlatformInvokeFn<any, Awaited<ReturnType<typeof launchFn>>>;;