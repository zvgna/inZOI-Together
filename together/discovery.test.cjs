const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {startResponder,discover}=require('./discovery.cjs');
const dgram=require('node:dgram');
test('discovery finds only a ready host and never exposes the room code',async()=>{
  let ready=false;
  const responder=startResponder({port:0,address:'127.0.0.1',name:'Test host',ready:()=>ready});
  await once(responder,'listening');
  const options={port:responder.address().port,timeout:100,interfaces:[{address:'127.0.0.1',broadcast:'127.0.0.1',transport:'radmin'}]};
  try{
    assert.equal((await discover(options)).hosts.length,0);
    ready=true;
    const result=await discover(options);
    assert.deepEqual(result.hosts,[{url:'http://127.0.0.1:11214',name:'Test host',transport:'radmin'}]);
    assert.equal(JSON.stringify(result).includes('code'),false);
  }finally{responder.close();}
});

test('unsolicited replies with the wrong query nonce are ignored',async()=>{
  const socket=dgram.createSocket('udp4');socket.bind(0,'127.0.0.1');await once(socket,'listening');
  socket.on('message',(_,peer)=>socket.send(Buffer.from(JSON.stringify({magic:'inzoi-together-discovery-1',type:'host',nonce:'0'.repeat(32),instance:'a'.repeat(32),port:11214,protocol:2})),peer.port,peer.address));
  try{
    const result=await discover({port:socket.address().port,timeout:100,interfaces:[{address:'127.0.0.1',broadcast:'127.0.0.1',transport:'radmin'}]});
    assert.equal(result.hosts.length,0);
  }finally{socket.close();}
});
