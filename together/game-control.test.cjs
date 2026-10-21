const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createGameControl}=require('./game-control.cjs');

test('game adapter uses the real autonomy response and verifies changes',async()=>{
  let enabled=true,ack='';const calls=[];
  const game=createGameControl(async(name,args)=>{
    calls.push([name,args]);
    if(name==='entity_reflect')return {autonomyOption:{autonomyEnable:{value:enabled,bFollowParent:false}}};
    if(name==='game_get_state')return {possessed_entity_id:11};
    if(name==='uimod_cfg_save'){const parts=args.Value.split('|');enabled=parts[3]==='1';ack=parts[0]+'|1';return {success:true};}
    if(name==='uimod_cfg_load')return {value:args.Key.startsWith('control_session')?'a'.repeat(16):ack};
    if(name==='interaction_get_current')return {playing:false};
    if(name==='interaction_list_available')return {interactions:[{enabled:true,interaction_bag_id:'Hello'},{enabled:false,interaction_bag_id:'Hug'}]};
    return {success:true};
  });
  assert.deepEqual(await game.getAutonomy(22),{value:true,bFollowParent:false});await game.setAutonomy(22,false);
  assert.equal(await game.canInteract(22,11,'Hello'),true);
  assert.equal(await game.canInteract(22,11,'Hug'),false);
  await game.executeInteraction(22,11,'Hello');
  assert.deepEqual(calls.at(-1),['interaction_execute',{entity_id:'22',target_entity_id:'11',interaction_bag_id:'Hello',insert_front:false}]);
});

test('unknown API responses and occupied actors do not authorize an action',async()=>{
  const game=createGameControl(async name=>name==='interaction_get_current'?{playing:true}:{unexpected:true});
  await assert.rejects(game.getAutonomy(22),/состояние ИИ/);
  assert.equal(await game.canInteract(22,11,'Hello'),false);
});

test('the bridge restores the inheritance bit as well as the individual value',async()=>{
  let option={value:true,bFollowParent:true},ack='';
  const game=createGameControl(async(name,args)=>{
    if(name==='entity_reflect')return {autonomyOption:{autonomyEnable:{...option}}};
    if(name==='game_get_state')return {possessed_entity_id:11};
    if(name==='uimod_cfg_load')return {value:args.Key.startsWith('control_session')?'b'.repeat(16):ack};
    if(name==='uimod_cfg_save'){
      const parts=args.Value.split('|');assert.equal(parts[1],'b'.repeat(16));
      option={value:parts[3]==='1',bFollowParent:parts[4]==='1'};ack=parts[0]+'|1';return {success:true};
    }
    throw Error(name);
  });
  const original=await game.getAutonomy(22);
  await game.setAutonomy(22,false);assert.deepEqual(option,{value:false,bFollowParent:false});
  await game.setAutonomy(22,original);assert.deepEqual(option,{value:true,bFollowParent:true});
});
