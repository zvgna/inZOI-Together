const {test}=require('node:test');
const assert=require('node:assert/strict');
const {waitForLobby}=require('./wait-lobby.cjs');

test('waits through gameplay and lobby loading without loading a save',async()=>{
  const states=[{phase:'in_game'},{phase:'lobby',loading:true},{phase:'lobby',loading:false}];
  let polls=0,waits=0,elapsed=0;
  await waitForLobby({getState:async()=>states[polls++],onWait:async()=>{waits++;},delay:async ms=>{elapsed+=ms;},now:()=>elapsed});
  assert.equal(polls,3);assert.equal(waits,2);assert.equal(elapsed,2000);
});
test('expires without continuing when the player stays in game',async()=>{
  let elapsed=0;
  await assert.rejects(waitForLobby({getState:async()=>({phase:'in_game'}),delay:async ms=>{elapsed+=ms;},now:()=>elapsed,timeout:2000}),/Ожидание/);
});
test('stops when guest connection cannot be kept alive',async()=>{
  await assert.rejects(waitForLobby({getState:async()=>({phase:'in_game'}),onWait:async()=>{throw Error('Connection expired');}}),/Connection expired/);
});
