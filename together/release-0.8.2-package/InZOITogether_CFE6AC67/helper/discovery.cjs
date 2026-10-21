const dgram=require('node:dgram');
const crypto=require('node:crypto');
const os=require('node:os');
const MAGIC='inzoi-together-discovery-1';
function adapters(){
  const result=[];
  for(const [name,entries] of Object.entries(os.networkInterfaces()))for(const entry of entries||[]){
    if(entry.family!=='IPv4'||entry.internal)continue;
    const transport=/radmin/i.test(name)||entry.address.startsWith('26.')?'radmin':/hamachi/i.test(name)||entry.address.startsWith('25.')?'hamachi':'lan';
    if(transport==='lan'&&(/vpn|amnezia|wireguard|tun/i.test(name)||! /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)))continue;
    const ip=entry.address.split('.').map(Number),mask=entry.netmask.split('.').map(Number);
    result.push({name,address:entry.address,transport,broadcast:ip.map((part,index)=>part|(255-mask[index])).join('.')});
  }
  return result;
}
function startResponder({port=11216,tcpPort=11214,ready=()=>true,name=os.hostname(),address='0.0.0.0',onError=()=>{}}={}){
  const socket=dgram.createSocket('udp4');
  const instance=crypto.randomBytes(16).toString('hex');
  socket.on('error',onError);
  socket.on('message',(buffer,peer)=>{
    if(buffer.length>512||!ready())return;
    let message;try{message=JSON.parse(buffer);}catch{return;}
    if(message.magic!==MAGIC||message.type!=='query'||typeof message.nonce!=='string'||!/^[a-f0-9]{32}$/.test(message.nonce))return;
    const response=Buffer.from(JSON.stringify({magic:MAGIC,type:'host',nonce:message.nonce,instance,port:tcpPort,protocol:2,name:String(name).slice(0,80)}));
    socket.send(response,peer.port,peer.address,()=>{});
  });
  socket.bind(port,address);socket.unref();return socket;
}
async function discover({interfaces=adapters(),port=11216,timeout=1400}={}){
  const nonce=crypto.randomBytes(16).toString('hex'),hosts=new Map();
  await Promise.all(interfaces.map(adapter=>new Promise(resolve=>{
    const socket=dgram.createSocket('udp4');let closed=false;
    const timer=setTimeout(finish,timeout);
    function finish(){if(closed)return;closed=true;clearTimeout(timer);try{socket.close();}catch(_){}resolve();}
    socket.on('error',finish);
    socket.on('message',(buffer,peer)=>{
      if(buffer.length>1024||peer.port!==port)return;
      let message;try{message=JSON.parse(buffer);}catch{return;}
      if(message.magic!==MAGIC||message.type!=='host'||message.nonce!==nonce||message.protocol!==2||message.port!==11214||!/^[a-f0-9]{32}$/.test(message.instance))return;
      const url='http://'+peer.address+':'+message.port;
      if(!hosts.has(message.instance)||adapter.transport==='radmin')hosts.set(message.instance,{url,name:String(message.name||'Host').slice(0,80),transport:adapter.transport});
    });
    socket.bind(0,adapter.address,()=>{if(closed)return;socket.setBroadcast(true);socket.send(Buffer.from(JSON.stringify({magic:MAGIC,type:'query',nonce})),port,adapter.broadcast,()=>{});});
  })));
  return {adapters:interfaces,hosts:[...hosts.values()].sort((a,b)=>(a.transport==='radmin'?-1:0)-(b.transport==='radmin'?-1:0))};
}
module.exports={adapters,discover,startResponder};
