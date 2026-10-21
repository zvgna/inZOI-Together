const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRelay}=require('./server.cjs');

test('competing network requests reserve the pair once and block the old replication routes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'together-authority-'));
  await fs.writeFile(path.join(dir,'save-info.json'),JSON.stringify({sha256:'snapshot',map:'City',characters:[{id:11,household:1},{id:22,household:2}]}));
  const {server}=createRelay({code:'room',shareDir:dir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(route,token,data){
    const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  }
  try {
    const host=(await call('/join',null,{code:'room',slot:1,name:'Host'})).data.token;
    const guest=(await call('/join',null,{code:'room',slot:2,name:'Guest'})).data.token;
    await call('/claim',host,{character:11,world:'City',sha256:'snapshot'});await call('/claim',guest,{character:22,world:'City',sha256:'snapshot'});
    assert.equal((await call('/authority',guest,{enabled:true})).status,403);
    const state=(await call('/authority',host,{enabled:true})).data;
    assert.equal((await call('/positions',guest)).status,409);
    assert.equal((await call('/actions',host,{kind:'hug'})).status,409);
    const commands=await Promise.all([
      call('/authority/commands',host,{epoch:state.epoch,id:'a'.repeat(32),kind:'interaction',target:22,bag:'Hello'}),
      call('/authority/commands',guest,{epoch:state.epoch,id:'b'.repeat(32),kind:'interaction',target:11,bag:'Hello'})
    ]);
    assert.deepEqual(commands.map(c=>c.status).sort(),[200,409]);
    const winner=commands.find(c=>c.status===200).data;
    assert.equal((await call('/authority/result',guest,{...winner,state:'dispatched'})).status,403);
    await call('/authority/result',host,{...winner,state:'rejected'});
    assert.equal((await call('/authority/commands',guest,{epoch:state.epoch,id:'c'.repeat(32),kind:'interaction',target:11,bag:'Hello'})).status,200);
    await call('/leave',guest,{});
    assert.equal((await call('/authority',host)).data.enabled,false);
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await fs.unlink(path.join(dir,'save-info.json'));await fs.rmdir(dir);
  }
});
