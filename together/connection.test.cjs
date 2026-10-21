const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const session={address:'http://26.1.2.3:11214',slot:2,resumeToken:'a'.repeat(64)};
function client(request){
  let stored=JSON.stringify(session);const timers=[],accepted=[],failed=[];
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'ui/connection.js'),'utf8'),sandbox);
  const controller=sandbox.window.createTogetherConnection({request,status(){},begin:()=>7,accept:(...args)=>accepted.push(args),failed:message=>failed.push(message),load:async()=>stored,store:async value=>{stored=value;},setTimer:(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer;},clearTimer:timer=>{timer.cancelled=true;}});
  return {controller,timers,accepted,failed,stored:()=>stored};
}
test('saved credentials reconnect after a temporary network failure',async()=>{
  let calls=0;const c=client(async(method,route,data)=>{assert.equal(route,'/resume');assert.equal(data.resumeToken,session.resumeToken);if(calls++===0)throw Error('Offline');return {token:'b'.repeat(48),resumeToken:session.resumeToken,slot:2,cursor:0};});
  await c.controller.restore();assert.equal(c.timers[0].delay,1000);assert.equal(c.accepted.length,0);
  await c.timers[0].fn();assert.equal(c.accepted.length,1);assert.equal(c.accepted[0][1],session.address);assert.equal(c.accepted[0][2],7);
  assert.deepEqual(Object.keys(JSON.parse(c.stored())).sort(),['address','resumeToken','slot']);
});
test('revoked credentials stop automatic retries',async()=>{
  const c=client(async()=>{throw Object.assign(Error('Session replaced'),{status:401});});
  await c.controller.restore();assert.equal(c.failed[0],'Session replaced');assert.equal(c.stored(),'');assert.equal(c.timers.length,0);
});
test('older servers do not cause an endless resume loop',async()=>{
  const c=client(async()=>{throw Object.assign(Error('Not found'),{status:404});});
  await c.controller.restore();assert.equal(c.timers.length,0);assert.equal(c.stored(),'');assert.match(c.failed[0],/одинаковую сборку/);
});
test('cancelling a pending resume releases its late server response',async()=>{
  let respond;const routes=[];const c=client((method,route,data,token)=>{routes.push(route);if(route==='/leave'){assert.equal(token,'c'.repeat(48));return Promise.resolve({ok:true});}return new Promise(resolve=>{respond=resolve;});});
  const restoring=c.controller.restore();await Promise.resolve();await c.controller.forget();
  respond({token:'c'.repeat(48),resumeToken:session.resumeToken,slot:2});await restoring;
  assert.equal(c.accepted.length,0);assert.equal(c.stored(),'');assert.deepEqual(routes,['/resume','/leave']);
});
test('retry delay is capped and can be cancelled',async()=>{
  const c=client(async()=>{throw Error('Offline');});await c.controller.restore();
  for(let i=0;i<6;i++)await c.timers[i].fn();
  assert.equal(c.timers.at(-1).delay,15000);c.controller.cancel();assert.equal(c.timers.at(-1).cancelled,true);
});
