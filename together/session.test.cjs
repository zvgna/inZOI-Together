const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createRelay}=require('./server.cjs');
function run(args,env=process.env){return new Promise((resolve,reject)=>{const childEnv={...env};delete childEnv.PSModulePath;const child=spawn('powershell.exe',args,{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error(output)));});}
test('guest downloads, verifies, installs separately, requests load and restores room code',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'together-guest-'));
  const share=path.join(dir,'share');fs.mkdirSync(share);
  await run(['-NoProfile','-Command',"$p=Join-Path $env:TOGETHER_TEST_DIR 'source\\20260101-000000';New-Item -ItemType Directory -Path $p -Force|Out-Null;[IO.File]::WriteAllText((Join-Path $p 'snapshot.usvx'),'fixture');Compress-Archive -LiteralPath $p -DestinationPath (Join-Path $env:TOGETHER_TEST_DIR 'share\\room-save.zip')"],{...process.env,TOGETHER_TEST_DIR:dir});
  const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(share,'room-save.zip'))).digest('hex');
  fs.writeFileSync(path.join(share,'save-info.json'),JSON.stringify({sha256:hash,map:'OtherCity',folder:'20260101-000000',file:'snapshot',characters:[{id:9001,household:1,name:'Host'},{id:9002,household:2,name:'Guest'}]}));
  let loaded=false,loadRequest,possessRequest,bootstrap;
  const game=http.createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;const request=JSON.parse(body);const {name,arguments:args}=request.params;
    let result={content:[{type:'text',text:'OK'}]};
    if(name==='game_get_state')result.structuredContent={phase:loaded?'in_game':'lobby',loading:false,map_id:'OtherCity'};
    else if(name==='game_load'){loaded=true;loadRequest=args;}
    else if(name==='character_possess')possessRequest=args;
    else if(name==='uimod_cfg_save')bootstrap=JSON.parse(args.Value);
    else assert.equal(name,'uimod_remount');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  });
  const {server}=createRelay({code:'test-room',shareDir:share});
  await new Promise(r=>game.listen(0,'127.0.0.1',r));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const joined=await(await fetch(base+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot:2,name:'Guest',code:'test-room'})})).json();
    const saveRoot=path.join(dir,'installed');
    await run(['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'session.ps1'),'-Mode','Guest','-Server',base,'-SessionToken',joined.token,'-CharacterId','9002','-SaveRoot',saveRoot,'-GameEndpoint','http://127.0.0.1:'+game.address().port+'/mcp']);
    assert.notEqual(loadRequest.Folder,'20260101-000000');assert.equal(loadRequest.File,'snapshot');
    assert.equal(fs.readFileSync(path.join(saveRoot,loadRequest.Folder,'snapshot.usvx'),'utf8'),'fixture');
    assert.equal(possessRequest.character_id,'9002');assert.equal(possessRequest.household_id,'2');
    assert.equal(bootstrap.server,base);assert.equal(bootstrap.code,'test-room');assert.equal(bootstrap.slot,2);
    assert.equal((await fetch(base+'/messages',{headers:{Authorization:'Bearer '+joined.token}})).status,401);
  }finally{
    game.closeAllConnections();server.closeAllConnections();await Promise.all([new Promise(r=>game.close(r)),new Promise(r=>server.close(r))]);
  }
});
