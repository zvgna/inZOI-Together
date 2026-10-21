const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAuthority}=require('./authority.cjs');
const {createHostControl}=require('./host-control.cjs');

test('host validates commands, disables only guest AI, journals dispatch and restores original AI',async()=>{
  const authority=createAuthority();
  const players=new Map([[1,{slot:1,token:'h',character:{id:11}}],[2,{slot:2,token:'g',character:{id:22}}]]);
  const call=(slot,method,path,data)=>authority.handle(players.get(slot),players,method,path,data);
  const state=call(1,'POST','/authority',{enabled:true});
  const command={id:'a'.repeat(32),epoch:state.epoch,kind:'interaction',target:11,bag:'Hello'};
  call(2,'POST','/authority/commands',command);
  const calls=[],saved=new Map();let owned=null;
  const game={getAutonomy:async id=>{assert.equal(id,22);return true;},setAutonomy:async(id,value)=>calls.push(['ai',id,value]),canInteract:async()=>true,executeInteraction:async(...args)=>calls.push(['execute',...args])};
  const journal={readOwnership:async()=>owned,writeOwnership:async value=>{owned=value;},readCommand:async key=>saved.get(key),writeCommand:async(key,value)=>saved.set(key,value)};
  const request=async(method,path,data)=>call(1,method,path,data);
  const control=createHostControl({game,journal,request});
  await control.tick();await control.tick();
  assert.equal(calls.filter(c=>c[0]==='execute').length,1);
  assert.equal(call(2,'GET','/authority/commands').commands[0].state,'dispatched');
  call(1,'POST','/authority',{enabled:false});await control.tick();
  assert.deepEqual(calls.at(-1),['ai',22,true]);
  assert.equal(owned,null);
  owned={actor:22,previous:false,epoch:'crash'};
  await createHostControl({game,journal,request}).recover();
  assert.deepEqual(calls.at(-1),['ai',22,false]);
});
