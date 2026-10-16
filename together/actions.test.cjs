const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createActions}=require('./actions.cjs');
const {createRelay}=require('./server.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('host authorization and completion on both clients',()=>{
  let time=0;const actions=createActions({now:()=>time});
  const host={slot:1,character:{id:41}},guest={slot:2,character:{id:92}};
  assert.throws(()=>actions.request(host,guest,'money'),{status:400});
  const event=actions.request(guest,host,'greet');
  assert.equal(event.actor,92);assert.equal(event.target,41);assert.equal(actions.active(),true);
  assert.throws(()=>actions.request(host,guest,'hug'),{status:409});
  assert.throws(()=>actions.resolve(guest,event.id,{state:'queued',bag:'Co_Friendship_G04_Start'}),{status:403});
  assert.throws(()=>actions.resolve(host,event.id,{state:'queued',bag:'Co_Borrow_Money'}),{status:400});
  actions.resolve(host,event.id,{state:'queued',bag:'Co_Friendship_G04_Start'});
  actions.acknowledge(host,event.id,{state:'started'});actions.acknowledge(guest,event.id,{state:'started'});
  actions.acknowledge(host,event.id,{state:'completed'});assert.equal(event.state,'queued');
  actions.acknowledge(guest,event.id,{state:'completed'});assert.equal(event.state,'completed');assert.equal(actions.active(),false);
  const next=actions.request(host,guest,'handshake');time=16000;assert.equal(actions.list().at(-1).state,'expired');
  assert.equal(actions.resolve(host,next.id,{state:'queued',bag:'Co_HandShake_MaleToMale_Business'}).state,'expired');
});
test('disconnects and failures stop coordinate hold',()=>{
  const actions=createActions();const host={slot:1,character:{id:10}},guest={slot:2,character:{id:20}};
  const a=actions.request(host,guest,'hug');actions.cancel();assert.equal(a.state,'failed');assert.equal(actions.active(),false);
  const b=actions.request(host,guest,'hug');actions.resolve(host,b.id,{state:'queued',bag:'Co_HugUp_FemaleToFemale_Success'});
  actions.acknowledge(guest,b.id,{state:'failed',reason:'Unavailable locally'});assert.equal(b.state,'failed');assert.equal(actions.active(),false);
});
test('HTTP actions require nearby authenticated players and pause position replication',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'together-action-'));
  fs.writeFileSync(path.join(dir,'save-info.json'),JSON.stringify({sha256:'snapshot',map:'Test',characters:[{id:11,household:100,name:'Host'},{id:22,household:200,name:'Guest'}]}));
  const {server}=createRelay({code:'room',shareDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const root='http://127.0.0.1:'+server.address().port;
  async function call(route,data,token){const response=await fetch(root+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};}
  try{
    assert.equal((await call('/actions')).status,401);
    const a=(await call('/join',{slot:1,name:'Host',code:'room'})).data.token,b=(await call('/join',{slot:2,name:'Guest',code:'room'})).data.token;
    await call('/claim',{character:11,sha256:'snapshot',world:'Test'},a);await call('/claim',{character:22,sha256:'snapshot',world:'Test'},b);
    assert.equal((await call('/actions',{kind:'greet'},b)).status,409);
    await call('/positions',{character:11,world:'Test',x:0,y:0,z:0},a);await call('/positions',{character:22,world:'Test',x:1000,y:0,z:0},b);
    assert.equal((await call('/actions',{kind:'greet'},b)).status,409);
    await call('/positions',{character:22,world:'Test',x:10,y:0,z:0},b);
    const event=(await call('/actions',{kind:'greet',actor:999},b)).data;assert.equal(event.actor,22);assert.equal(event.target,11);
    assert.equal((await call('/positions',null,b)).data.position,null);
    assert.equal((await call('/actions/'+event.id+'/resolve',{state:'queued',bag:'Co_Friendship_G04_Start'},b)).status,403);
    await call('/actions/'+event.id+'/resolve',{state:'queued',bag:'Co_Friendship_G04_Start'},a);
    await call('/actions/'+event.id+'/ack',{state:'completed'},a);await call('/actions/'+event.id+'/ack',{state:'completed'},b);
    assert.equal((await call('/positions',null,b)).data.position.character,11);
    const next=(await call('/actions',{kind:'hug'},a)).data;await call('/leave',{},b);
    assert.equal((await call('/actions',null,a)).data.events.find(e=>e.id===next.id).state,'failed');
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.unlinkSync(path.join(dir,'save-info.json'));fs.rmdirSync(dir);}
});
