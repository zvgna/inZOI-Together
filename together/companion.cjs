const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const {spawn} = require('node:child_process');
const key = crypto.randomBytes(32).toString('hex');
const jobs = new Map();
let active = false;
async function game(name,args={}) {
  const response=await fetch('http://127.0.0.1:11212/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(15000)});
  const reply=await response.json();
  if(reply.error || reply.result.isError) throw Error('Game API rejected '+name);
  if(reply.result.structuredContent) return reply.result.structuredContent;
  let text=reply.result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  const start=text.indexOf('\n[');if(start>=0)text=text.slice(start+1);
  try{return JSON.parse(text);}catch{return text;}
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Together-Key');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network','true');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.headers['x-together-key']!==key){send(res,401,{error:'Запустите локальный помощник Together'});return;}
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='GET'&&url.pathname==='/saves'){
      let saves=[],offset=0,page;
      do{page=await game('game_list_saves',{Limit:100,Offset:offset,include_autosave:false,include_broken:false});if(!Array.isArray(page))throw Error('Unexpected save list');saves.push(...page);offset+=page.length;}while(page.length===100);
      send(res,200,{saves:saves.filter(s=>!s.is_broken&&!s.is_higher_version)});return;
    }
    if(req.method==='GET'&&url.pathname.startsWith('/jobs/')){const job=jobs.get(url.pathname.slice(6));send(res,job?200:404,job||{error:'Job missing'});return;}
    if(req.method!=='POST'||url.pathname!=='/jobs'){send(res,404,{error:'Unknown route'});return;}
    if(active){send(res,409,{error:'Уже идёт загрузка сохранения'});return;}
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('Request too large');}
    const data=JSON.parse(raw),args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'session.ps1')];
    if(data.mode==='Host'){
      if(!/^[A-Za-z0-9_-]+$/.test(data.folder)||!/^[A-Za-z0-9_-]+$/.test(data.file))throw Error('Invalid save identifier');
      args.push('-Mode','Host','-Folder',data.folder,'-File',data.file);
    }else if(data.mode==='Guest'){
      if(!/^http:\/\/[a-zA-Z0-9.\-]+:\d+$/.test(data.server)||!/^[a-f0-9]{48}$/.test(data.token)||!Number.isSafeInteger(data.character)||data.character<=0)throw Error('Invalid guest parameters');
      args.push('-Mode','Guest','-Server',data.server,'-SessionToken',data.token,'-CharacterId',String(data.character));
    }else throw Error('Unknown mode');
    const id=crypto.randomBytes(16).toString('hex'),job={state:'running',output:''};jobs.clear();jobs.set(id,job);active=true;
    const childEnv={...process.env};delete childEnv.PSModulePath;
    const child=spawn('powershell.exe',args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const append=chunk=>{job.output=(job.output+chunk.toString()).slice(-6000);};child.stdout.on('data',append);child.stderr.on('data',append);
    child.on('error',e=>{job.state='failed';job.output=e.message;active=false;});child.on('close',code=>{job.state=code===0?'done':'failed';active=false;});
    send(res,202,{id});
  }catch(error){send(res,400,{error:error.message});}
});
async function register(){try{await game('uimod_cfg_save',{mod_id:'InZOITogether_CFE6AC67',Section:'bridge',Key:'helper_key',Value:key});}catch{/* Game may not be open yet. */}}
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
server.listen(11215,'127.0.0.1',()=>{console.log('Together local helper running. Leave this window open.');register();setInterval(register,5000).unref();});
