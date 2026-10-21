const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRelay}=require('./server.cjs');
test('resume preserves the player and messages, revokes old access and cancels stale actions',async()=>{
  let time=1000;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'together-resume-'));
  fs.writeFileSync(path.join(dir,'save-info.json'),JSON.stringify({sha256:'save',map:'City',characters:[{id:1,household:10},{id:2,household:20}]}));
  const {server}=createRelay({code:'room',shareDir:dir,now:()=>time});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const root='http://127.0.0.1:'+server.address().port;
  async function call(route,data,token){const response=await fetch(root+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};}
  try{
    const a=(await call('/join',{code:'room',slot:1,name:'Host'})).data,b=(await call('/join',{code:'room',slot:2,name:'Guest'})).data;
    for(const [session,id] of [[a,1],[b,2]]){await call('/claim',{sha256:'save',world:'City',character:id},session.token);await call('/positions',{character:id,world:'City',x:id,y:0,z:0},session.token);}
    const message=(await call('/messages',{channel:'phone',text:'Before disconnect'},a.token)).data;
    const action=(await call('/actions',{kind:'greet'},b.token)).data;
    time+=61000;
    assert.equal((await call('/messages',null,b.token)).status,401);
    assert.equal((await call('/join',{code:'room',slot:2,name:'Guest'})).status,409);
    const resumed=await call('/resume',{resumeToken:b.resumeToken});assert.equal(resumed.status,200);assert.equal(resumed.data.slot,2);assert.notEqual(resumed.data.token,b.token);
    const received=(await call('/messages',null,resumed.data.token)).data;
    assert.equal(received.players[0].character.id,2);assert.equal(received.messages[0].id,message.id);
    assert.equal((await call('/actions',null,resumed.data.token)).data.events.find(e=>e.id===action.id).state,'failed');
    assert.equal((await call('/positions',null,resumed.data.token)).data.position,null);
    const retried=await call('/resume',{resumeToken:b.resumeToken});assert.equal(retried.status,200);
    assert.equal((await call('/messages',null,resumed.data.token)).status,401);
    const takeover=(await call('/join',{code:'room',slot:2,name:'New guest',replace:true})).data;
    assert.equal((await call('/resume',{resumeToken:b.resumeToken})).status,401);
    await call('/leave',{},takeover.token);assert.equal((await call('/resume',{resumeToken:takeover.resumeToken})).status,401);
    time+=600001;assert.equal((await call('/resume',{resumeToken:a.resumeToken})).status,401);
    assert.equal((await call('/join',{code:'room',slot:1,name:'New host'})).status,200);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.unlinkSync(path.join(dir,'save-info.json'));fs.rmdirSync(dir);}
});
