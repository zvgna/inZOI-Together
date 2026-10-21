const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAuthority}=require('./authority.cjs');
const {createAuthorityRunner}=require('./authority-runner.cjs');

function fixture(){
  const authority=createAuthority(),players=new Map([[1,{slot:1,token:'h',character:{id:11}}],[2,{slot:2,token:'g',character:{id:22}}]]);
  const calls=[];let ownership=null,enabled=true,ack='',current={playing:false},map='City';const commands=new Map();
  const request=async(method,route,data)=>route==='/room'?{save:{map:'City'}}:route.startsWith('/messages')?{players:[...players.values()]}:authority.handle(players.get(1),players,method,route,data);
  const rpc=async(name,args)=>{
    calls.push([name,args]);
    if(name==='game_get_state')return {phase:'in_game',map_id:map,possessed_entity_id:11};
    if(name==='entity_reflect')return {autonomyOption:{autonomyEnable:{value:enabled,bFollowParent:false}}};
    if(name==='uimod_cfg_save'){const parts=args.Value.split('|');enabled=parts[3]==='1';ack=parts[0]+'|1';return {success:true};}
    if(name==='uimod_cfg_load')return {value:args.Key.startsWith('control_session')?'a'.repeat(16):ack};
    if(name==='interaction_list_available')return {interactions:[{enabled:true,interaction_bag_id:'Hello'}]};
    if(name==='interaction_get_current')return current;
    if(name==='interaction_execute'){current={playing:true,interaction_bag_id:args.interaction_bag_id};return {success:true};}
    throw Error(name);
  };
  const journal={readOwnership:async()=>ownership,writeOwnership:async value=>{ownership=value;},readCommand:async key=>commands.get(key),writeCommand:async(key,value)=>commands.set(key,value)};
  const runner=createAuthorityRunner({rpc,request,journal});
  return {runner,authority,players,calls,journal,enabled:()=>enabled,setCurrent:value=>{current=value;},setMap:value=>{map=value;}};
}

test('runner executes guest intent once in host world, observes completion and restores guest AI',async()=>{
  const f=fixture();await f.runner.start();assert.equal(f.enabled(),false);
  const state=f.authority.handle(f.players.get(2),f.players,'GET','/authority');
  f.authority.handle(f.players.get(2),f.players,'POST','/authority/commands',{epoch:state.epoch,id:'a'.repeat(32),kind:'interaction',target:11,bag:'Hello'});
  await f.runner.step();await f.runner.step();
  assert.equal(f.calls.filter(c=>c[0]==='interaction_execute').length,1);
  f.setCurrent({playing:false});await f.runner.step();
  assert.equal(f.authority.handle(f.players.get(2),f.players,'GET','/authority/commands').commands[0].state,'completed');
  await f.runner.stop();assert.equal(f.enabled(),true);assert.equal(await f.journal.readOwnership(),null);
});

test('runner stops on world change without applying old AI state to a new world',async()=>{
  const f=fixture();await f.runner.start();f.setMap('OtherCity');
  await assert.rejects(f.runner.step(),/другом мире/);
  assert.equal(f.runner.status().running,false);assert.equal(f.enabled(),false);
  assert.ok(await f.journal.readOwnership());
});
