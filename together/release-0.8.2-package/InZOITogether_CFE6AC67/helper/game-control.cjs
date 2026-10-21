const crypto=require('node:crypto');
function createGameControl(rpc) {
  async function call(name,args) {
    const value=await rpc(name,args);
    if (!value || value.success === false || value.ok === false || value.isError) throw new Error('Игра отклонила '+name);
    return value;
  }
  async function getAutonomy(actor) {
    const value=await call('entity_reflect',{entity_id:String(actor)});
    const option=value.autonomyOption?.autonomyEnable;
    if(option && typeof option.value==='boolean' && typeof option.bFollowParent==='boolean')return {value:option.value,bFollowParent:option.bFollowParent};
    throw new Error('Не удалось определить исходное состояние ИИ. Управление не изменено.');
  }
  async function available(actor,target) {
    const value=await call('interaction_list_available',{entity_id:String(actor),target_entity_id:String(target)});
    if (!Array.isArray(value.interactions)) throw new Error('Игра вернула неизвестный список взаимодействий');
    return value.interactions.filter(item=>item.enabled === true && typeof item.interaction_bag_id === 'string');
  }
  return {
    getAutonomy,
    async setAutonomy(actor,enabled) {
      const option=typeof enabled==='boolean'?{value:enabled,bFollowParent:false}:enabled;
      if(!option||typeof option.value!=='boolean'||typeof option.bFollowParent!=='boolean')throw new Error('Неизвестная настройка автономии');
      const state=await call('game_get_state',{});
      const session=await call('uimod_cfg_load',{mod_id:'InZOITogether_CFE6AC67',Section:'bridge',Key:'control_session'+state.possessed_entity_id});
      if(typeof session.value!=='string'||!/^[a-f0-9]{16}$/.test(session.value))throw new Error('Lua-канал управления ещё не подключён');
      const uid=crypto.randomBytes(16).toString('hex');
      await call('uimod_cfg_save',{mod_id:'InZOITogether_CFE6AC67',Section:'bridge',Key:'control_request',Value:[uid,session.value,actor,option.value?1:0,option.bFollowParent?1:0].join('|')});
      const deadline=Date.now()+8000;
      let acknowledged=false;
      while(Date.now()<deadline){
        let ack={};
        try {ack=await call('uimod_cfg_load',{mod_id:'InZOITogether_CFE6AC67',Section:'bridge',Key:'control_ack'});} catch (_) {}
        if(ack.value===uid+'|1'){acknowledged=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!acknowledged)throw new Error('Lua не подтвердил передачу управления. Проверьте мод и снимите паузу игры.');
      const current=await getAutonomy(actor);
      if (current.value!==option.value||current.bFollowParent!==option.bFollowParent) throw new Error('Игра не подтвердила изменение ИИ');
    },
    available,
    async canInteract(actor,target,bag) {
      const current=await call('interaction_get_current',{entity_id:String(actor)});
      if (current.playing) return false;
      return (await available(actor,target)).some(item=>item.interaction_bag_id === bag);
    },
    async executeInteraction(actor,target,bag) {
      await call('interaction_execute',{entity_id:String(actor),target_entity_id:String(target),interaction_bag_id:bag,insert_front:false});
    },
    async current(actor) { return call('interaction_get_current',{entity_id:String(actor)}); }
  };
}
module.exports={createGameControl};
