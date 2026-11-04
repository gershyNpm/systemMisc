import type { Session, SessionKeeper } from '@gershy/lilac-platformer';
import type Logger from '@gershy/logger';
import type { Play } from './play.ts';

export default async (inp: { debug: boolean, logger: Logger, jsfnImport: any, sessionKeeper: SessionKeeper }) => {
  
  const { default: playFn } = inp.jsfnImport('./play.ts') as typeof import('./play.ts');
  
  const { logger, sessionKeeper } = inp;
  
  // TODO: name claim/release could be more efficient with a static shuffled array...
  type Player = {
    session: Session,
    name: string
  };
  const names = new Set('academician acceptor ace achiever adept adherent administrator admirer adorer advantage adviser advisor advocate aelurophile aerophile aesthete aid aide ailurophile alannah alleviator ally almsgiver almsperson alternate altruist agent ambassador amoret angel aficionada aficionado affluential americophile anglophile apostle appreciator apprentice arctophile arbiter archetype architect artisan artist artiste ascendant aspirant asset assignee assigner assistant associate astrophile athlete attendant audiophile author authority autodidact baby backbone backer backup baron beatus beauty begetter being believer belle benchmark benefactor benefactress beneficiary benefit bestower bibliophile bigwig biophile blessing bodyguard boss booster brain brother bud buddy buff builder campaigner captain carer caretaker cartophile catalyst cause celebrant celebrator chair chairperson chamberlain champ champion chaperon charmer cherub cherisher chief chieftan child chum cinephile clerisy climber cognoscente cognoscenti cohort coiner collaborator colleague collector comforter commander companion compeller complement composer comrade concierge conductor confederate conferrer confidant confrere connoisseur conservator consoler consul consultant contributor controller convive cornerstone cosmocrat cosmopolitan cosmopolite councillor counsel counselor counsellor count creator credit crew cub curator custodian cynosure dad dancer darling daughter dean dear defender deipnosophist demophile designer devisee devisor devotee digerati dilly director disciple discophile discoverer distributor doer doll donee donor doozy doula doyen doyenne dreamboat duke dynamo earl ecstatic einstein elder employer enchanter enchantress encourager endorser engineer enkindler enophile ensurer entertainer enthusiast entrepreneur epididact epicure epicurean epitome ergophile escort essence eudaimonist example exec executive exemplar excellency experimenter expert exponent facilitator family fan fancier fascinator fashioner favourite financier fireball fireman flame folks foodie foodophile force forebearer forefather foreman forerunner foreseer foundation founder fount fountain fountainhead francophile friend gallophile gastronome gastronomer gastronomist generator gem genius gentleman gentlewoman germanophile gift givee giver godparent godsend gourmet governor grandee grantee grantor grubstaker guarantor guardian guest guide guru handler head heart heartthrob height heir heiress heliophile hellenophile help helper helpmate hero heroine highflier hippophile hit homemaker hopeful host hotshot humanitarian husband icon iconophile ideal idol idolizer illuminator iluvshaina improvement inamorata inamorato individual indophile industrialist infant influence influentialinheritor initiator innocent innovator inspiration inspirer inspiriter institutor intellect intellectual intelligentsia intimate introducer inventor invitee inviter jazzophile keeper key kingpin knight lady lamb latinophile latitudinarian laureate lead leader legatee legator legend legislator liberal libertarian lieutenant lightworker linguaphile livewire logophile lord lover lulu luminary maestro magician magistrate maker manager marquess marquis marvel master mastermind matriarch materfamilias mediator meditator meliorist mentor metropolitan minder miracle mitigator mate model mom monitor moppet mother motor mover motivator musicophile mycophile nabob neighbour nemophilist neophile neonate neoteric nestling newborn nipper nobleman nonesuch notable nurse nursling nurturer officer official offspring oenophile omnist operator optimist orchestrator orchidophile organizer original originator ornithophile overseer owner pacifier pal paladin pangloss pansophist paraclete paradigm paragon paramount pard parent participant partisan partner paterfamilias pathfinder patriarch patron peach pearl peacekeeper peacemaker peer percipient perfectibilian perfectibilist perfectionist performer personality persophile pet phenom phenomenon philalethist philanthropist philomath philogynist philonoist philosopher pigsney pilot pioneer pinnacle pinup pistol planner player playmate plum pluviophile poet polymath pogonophile possessor postulant potentate powerhouse preceptor premier presence presenter president prevailer primogenitor prince princess principal pro proconsul procreator proctor prodigy producer professional professor progeny progenitor promoter promulgator prophet propitiator proponent proposer proprietor protagonist protean protector provider publisher purist purveyor qualtagh raconteur raconteuse reacher receiver recipient redeemer reliever regulator rejoicer representative researcher resolver resource retrophile rewarder romantic romeo rooter ruler runner russophile sage saint saver saviour savant schatzi scholar scholarch scion scripter sculptor seeker sentinel servant server sharpy shaver sinophile sire sister skipper smoothie soul sovereign specialist sponsor sprite sprout squire standard star stipendiary strategist socializer socius solon something specialist stabilizer staker steward stipendiary stripling striver student stylist success successor sugar suitor superintendent superior superman superstar superwoman supervisor supplier support supporter surety survivor swain sweetheart tadpole teacher teammate technophile testator thalassophile thaumatologist theodidact theotokos thinker titleholder tootsie tot trailblazer trainer treasure trier trustee turophile tutelary tutor tycoon typhlophile underwriter upholder urchin validator valedictorian vaulter victor victress victrix videophile viscount vip visitor visionary virtuoso volunteer votary warantee warantor warden wellspring whip whippersnapper whiz whizz wife winner wizard wonder wooer wordsmith workhorse workmate worshiper writer wunderkind youngster younker youth xenophile'.split(' '));
  const playerMap = new Map<Session['id'], Player>();
  
  const play = playFn({
    
    rollback: inp => logger.log({
      $$: 'timeStep.rollback',
      replayEvents: inp.replayEvents.length,
      snapshotsDiscarded: inp. snapshotsDiscarded
    }),
    
    tick: inp => (inp.elapsedMs > 8) && logger.log({ $$: 'timeStep.tick', ...inp })
    
  });
  
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
    players: playerMap
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
  
};