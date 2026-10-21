const {createGameControl}=require('./game-control.cjs');
const {createHostControl}=require('./host-control.cjs');

function createAuthorityRunner({rpc,request,journal}) {
  const game=createGameControl(rpc);
  const control=createHostControl({game,request,journal});
  let context=null,busy=false,lastError='';
  async function verify() {
    const state=await rpc('game_get_state',{});
    if ((state.phase || state.Phase) !== 'in_game' || state.loading || state.Loading || state.map_id !== context.map || state.possessed_entity_id !== context.hostActor) {
      throw new Error('Игра или выбранный персонаж хоста изменились. Передача управления остановлена.');
    }
  }
  async function stop() {
    try { await request('POST','/authority',{enabled:false}); } catch (_) {}
    if(context) {
      try {await verify();}
      catch (error) {context=null;lastError=error.message+' Журнал ИИ сохранён; автоматическое восстановление в другом мире запрещено.';throw new Error(lastError);}
    }
    try {await control.restore();} finally {context=null;}
  }
  return {
    async start() {
      if (context) throw new Error('Передача управления уже работает');
      const previous=await journal.readOwnership();
      if(previous){
        const current=await game.getAutonomy(previous.actor);
        if(current.value===previous.previous?.value && current.bFollowParent===previous.previous?.bFollowParent)await journal.writeOwnership(null);
        else throw new Error('Остался журнал незавершённой передачи управления. Дождитесь восстановления ИИ в игре.');
      }
      const [room,peers]=await Promise.all([request('GET','/room'),request('GET','/messages?after=0')]);
      const host=peers.players.find(p=>p.slot === 1),guest=peers.players.find(p=>p.slot === 2);
      if (!host?.character || !guest?.character || !room.save?.map) throw new Error('Оба игрока должны загрузить сохранение и выбрать персонажей');
      context={map:room.save.map,hostActor:host.character.id,guestActor:guest.character.id};
      try {
        await verify();
        await request('POST','/authority',{enabled:true});
        await control.tick();
      } catch (error) { lastError=error.message;await stop();throw error; }
      lastError='';
    },
    async step() {
      if (!context || busy) return;
      busy=true;
      try {await verify();await request('POST','/authority',{enabled:true});await control.tick();}
      catch (error) {lastError=error.message;await stop();}
      finally {busy=false;}
    },
    async stop() {if(busy)throw new Error('Дождитесь завершения проверки команды');await stop();},
    status() {return {running:!!context,busy,error:lastError};}
  };
}
module.exports={createAuthorityRunner};
