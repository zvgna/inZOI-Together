const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const {spawn,spawnSync} = require('node:child_process');
const {createControlJournal}=require('./control-journal.cjs');
const {createAuthorityRunner}=require('./authority-runner.cjs');
const {createGameRpc}=require('./game-rpc.cjs');
const {discover}=require('./discovery.cjs');
const {watchGame}=require('./lifetime.cjs');
const {waitForLobby}=require('./wait-lobby.cjs');
const key = crypto.randomBytes(32).toString('hex');
const jobs = new Map();
const children=new Set();
let active = false;
let authorityRunner=null,controlBusy=false;
async function readBody(req) {
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('Request too large');}
  return JSON.parse(raw);
}
const game=createGameRpc();
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
    if(req.method==='GET'&&url.pathname==='/discover'){send(res,200,await discover());return;}
    if(req.method==='GET'&&url.pathname==='/control'){send(res,200,authorityRunner?authorityRunner.status():{running:false});return;}
    if(req.method==='POST'&&url.pathname==='/control'){
      if(controlBusy||active){send(res,409,{error:'Дождитесь завершения текущей операции'});return;}
      controlBusy=true;
      try {
        const data=await readBody(req);
        if(data.enabled===false){if(authorityRunner)await authorityRunner.stop();send(res,200,{running:false});return;}
        if(data.enabled!==true||data.server!=='http://127.0.0.1:11214'||!/^[a-f0-9]{48}$/.test(data.token))throw Error('Передачу управления запускают на ПК хоста через локальный сервер');
        if(authorityRunner?.status().running)throw Error('Передача управления уже включена');
        const request=async(method,route,payload)=>{
          const response=await fetch(data.server+route,{method,headers:{Authorization:'Bearer '+data.token,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(4000)});
          const reply=await response.json();if(!response.ok)throw Error(reply.error||'Ошибка комнаты');return reply;
        };
        const journal=await createControlJournal(path.join(__dirname,'runtime','control.json'));
        authorityRunner=createAuthorityRunner({rpc:game,request,journal});
        await authorityRunner.start();
        send(res,200,authorityRunner.status());return;
      } finally {controlBusy=false;}
    }
    if(req.method==='GET'&&url.pathname==='/saves'){
      let saves=[],offset=0,page;
      do{page=await game('game_list_saves',{Limit:100,Offset:offset,include_autosave:false,include_broken:false});if(!Array.isArray(page))throw Error('Unexpected save list');saves.push(...page);offset+=page.length;}while(page.length===100);
      send(res,200,{saves:saves.filter(s=>!s.is_broken&&!s.is_higher_version)});return;
    }
    if(req.method==='GET'&&url.pathname.startsWith('/jobs/')){const job=jobs.get(url.pathname.slice(6));send(res,job?200:404,job||{error:'Job missing'});return;}
    if(req.method!=='POST'||url.pathname!=='/jobs'){send(res,404,{error:'Unknown route'});return;}
    if(active){send(res,409,{error:'Уже идёт загрузка сохранения'});return;}
    if(authorityRunner?.status().running){send(res,409,{error:'Сначала остановите передачу управления'});return;}
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('Request too large');}
    const data=JSON.parse(raw),args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'session.ps1')];
    if(data.mode==='Host'){
      if(!/^[A-Za-z0-9_-]+$/.test(data.folder)||!/^[A-Za-z0-9_-]+$/.test(data.file))throw Error('Invalid save identifier');
      args.push('-Mode','Host','-Folder',data.folder,'-File',data.file);
    }else if(data.mode==='Guest'){
      if(!/^http:\/\/[a-zA-Z0-9.\-]+:\d+$/.test(data.server)||!/^[a-f0-9]{48}$/.test(data.token)||!Number.isSafeInteger(data.character)||data.character<=0)throw Error('Invalid guest parameters');
      args.push('-Mode','Guest','-Server',data.server,'-SessionToken',data.token,'-CharacterId',String(data.character));
    }else throw Error('Unknown mode');
    if(active){send(res,409,{error:'Уже идёт загрузка сохранения'});return;}
    const id=crypto.randomBytes(16).toString('hex'),job={state:'waiting',output:'Выбор запомнен. Сохраните игру и выйдите в главное меню; помощник продолжит автоматически.'};jobs.clear();jobs.set(id,job);active=true;
    send(res,202,{id,state:job.state});
    let lastKeepalive=0;
    waitForLobby({getState:()=>game('game_get_state',{}),onWait:async()=>{
      if(data.mode!=='Guest'||Date.now()-lastKeepalive<15000)return;
      const response=await fetch(data.server+'/room',{headers:{Authorization:'Bearer '+data.token},signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw Error('Подключение гостя истекло. Подключитесь к комнате заново.');
      lastKeepalive=Date.now();
    }}).then(()=>{
    job.state='running';job.output='Загрузка сохранения началась.';
    const childEnv={...process.env};delete childEnv.PSModulePath;
    const child=spawn('powershell.exe',args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    children.add(child);
    const append=chunk=>{job.output=(job.output+chunk.toString()).slice(-6000);};child.stdout.on('data',append);child.stderr.on('data',append);
    child.on('error',e=>{children.delete(child);job.state='failed';job.output=e.message;active=false;});child.on('close',code=>{children.delete(child);job.state=code===0?'done':'failed';active=false;});
    }).catch(error=>{job.state='failed';job.output=error.message;active=false;});
  }catch(error){send(res,400,{error:error.message});}
});
async function register(){try{await game('uimod_cfg_save',{mod_id:'InZOITogether_CFE6AC67',Section:'bridge',Key:'helper_key',Value:key});}catch{/* Game may not be open yet. */}}
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
server.listen(11215,'127.0.0.1',()=>{console.log('Together local helper running. Leave this window open.');register();setInterval(register,5000).unref();});
setInterval(()=>{if(authorityRunner&&!controlBusy)authorityRunner.step().catch(error=>console.error('Control:',error.message));},1000).unref();
if(process.env.TOGETHER_GAME_PID)watchGame(Number(process.env.TOGETHER_GAME_PID),{stop:()=>{
  for(const child of children)if(child.pid&&child.exitCode===null)spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  server.close();process.exit(0);
}});
