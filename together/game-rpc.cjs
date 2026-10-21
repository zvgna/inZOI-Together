function createGameRpc({endpoint='http://127.0.0.1:11212/mcp',fetchImpl=fetch}={}) {
  let sequence=0;
  return async function(name,args={}) {
    const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Game API HTTP '+response.status);
    const reply=await response.json();
    if(reply.error || !reply.result || reply.result.isError)throw new Error('Game API rejected '+name);
    if(reply.result.structuredContent!==undefined)return reply.result.structuredContent;
    let text=(reply.result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    const start=text.indexOf('\n[');if(start>=0)text=text.slice(start+1);
    try{return JSON.parse(text);}catch{return text;}
  };
}
module.exports={createGameRpc};
