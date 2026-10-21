function createHostControl({game, request, journal, now=Date.now}) {
  let ownership=null;
  const observed=new Map();
  async function restore() {
    if (!ownership) return;
    await game.setAutonomy(ownership.actor,ownership.previous);
    await journal.writeOwnership(null);
    ownership=null;
  }
  async function recover() {
    ownership=await journal.readOwnership();
    await restore();
  }
  async function tick() {
    let state;
    try { state=await request('GET','/authority'); }
    catch (error) { await restore(); throw error; }
    if (!state.enabled) { await restore(); return; }
    if (ownership && ownership.epoch !== state.epoch) await restore();
    if (!ownership) {
      const previous=await game.getAutonomy(state.actor);
      if (typeof previous !== 'boolean' && !(previous && typeof previous.value==='boolean' && typeof previous.bFollowParent==='boolean')) throw new Error('Unknown autonomy state');
      ownership={actor:state.actor,epoch:state.epoch,previous};
      await journal.writeOwnership(ownership);
    }
    await game.setAutonomy(state.actor,false);
    const result=await request('GET','/authority/commands');
    for (const command of result.commands) {
      if (command.state === 'dispatched' && typeof game.current === 'function') {
        const progress=observed.get(command.epoch+':'+command.id);
        if (!progress) {
          await request('POST','/authority/result',{...command,state:'unknown'});
          continue;
        }
        const current=await game.current(command.actor);
        if (current.playing && current.interaction_bag_id === command.bag) progress.started=true;
        if (progress.started && !current.playing) {
          await request('POST','/authority/result',{...command,state:'completed'});
          observed.delete(command.epoch+':'+command.id);
        } else if (now()-progress.at > 120000) {
          await request('POST','/authority/result',{...command,state:'unknown'});
          observed.delete(command.epoch+':'+command.id);
        }
        continue;
      }
      if (command.state !== 'pending') continue;
      if (![ownership.actor,state.hostActor].includes(command.actor) || command.epoch !== ownership.epoch) continue;
      const key=command.epoch+':'+command.id;
      if (await journal.readCommand(key)) {
        await request('POST','/authority/result',{...command,state:'dispatched'});
        await request('POST','/authority/result',{...command,state:'unknown'});
        continue;
      }
      const allowed=await game.canInteract(command.actor,command.target,command.bag);
      if (!allowed) { await request('POST','/authority/result',{...command,state:'rejected'}); continue; }
      const current=await request('GET','/authority');
      if (!current.enabled || current.epoch !== command.epoch) { await restore(); return; }
      await journal.writeCommand(key,'dispatched');
      await request('POST','/authority/result',{...command,state:'dispatched'});
      observed.set(key,{started:false,at:now()});
      await game.executeInteraction(command.actor,command.target,command.bag);
      // Completion must be confirmed from the host simulation, not from queue acceptance.
    }
  }
  let running=false;
  return {recover,restore,tick:async()=>{
    if(running)return;
    running=true;
    try { await tick(); } finally { running=false; }
  }};
}
module.exports={createHostControl};
