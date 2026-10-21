const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createAuthority} = require('./authority.cjs');

function fixture() {
  let time=100;
  const authority=createAuthority({now:()=>time});
  const players=new Map([[1,{slot:1,token:'host',character:{id:11}}],[2,{slot:2,token:'guest',character:{id:22}}]]);
  const call=(slot,method,route,data)=>authority.handle(players.get(slot),players,method,route,data);
  const enabled=call(1,'POST','/authority',{enabled:true});
  const command={id:'a'.repeat(32),epoch:enabled.epoch,kind:'interaction',target:11,bag:'Co_Friendship_G04_Start',actor:11};
  return {authority,players,call,command,advance:()=>{time+=5001;}};
}
test('authority derives actor from guest ownership, rejects role inversion and deduplicates commands',()=>{
  const {call,command}=fixture();
  assert.throws(()=>call(2,'POST','/authority',{enabled:true}),{status:403});
  assert.throws(()=>call(1,'POST','/authority/commands',command),{status:403});
  assert.equal(call(2,'POST','/authority/commands',command).actor,22);
  call(2,'POST','/authority/commands',command);
  assert.equal(call(1,'GET','/authority/commands').commands.length,1);
  assert.throws(()=>call(2,'POST','/authority/result',{...command,state:'completed'}),{status:403});
  assert.throws(()=>call(1,'POST','/authority/result',{...command,state:'completed'}),{status:409});
  call(1,'POST','/authority/result',{...command,state:'dispatched'});
  call(1,'POST','/authority/result',{...command,state:'completed'});
  assert.equal(call(2,'POST','/authority/commands',command).state,'completed');
});
test('expired host confirmation and reconnect invalidate commands instead of replaying them',()=>{
  const {call,command,advance,players}=fixture();
  call(2,'POST','/authority/commands',command);
  call(1,'POST','/authority/result',{...command,state:'dispatched'});
  advance();
  assert.equal(call(2,'GET','/authority').enabled,false);
  const next=call(1,'POST','/authority',{enabled:true});
  assert.notEqual(next.epoch,command.epoch);
  assert.throws(()=>call(2,'POST','/authority/commands',command),{status:409});
  assert.equal(call(1,'GET','/authority/commands').commands.length,0);
  players.get(2).token='replacement';
  assert.equal(call(1,'GET','/authority').enabled,false);
});
test('ownership changes and malformed commands cannot cross the authority boundary',()=>{
  const {call,command,players}=fixture();
  assert.throws(()=>call(2,'POST','/authority/commands',{...command,target:NaN}),{status:400});
  assert.throws(()=>call(2,'POST','/authority/commands',{...command,bag:'../anything'}),{status:400});
  players.get(2).character={id:33};
  assert.equal(call(1,'GET','/authority').enabled,false);
});
