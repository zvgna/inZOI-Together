const {test}=require('node:test');
const assert=require('node:assert/strict');
const {watchGame}=require('./lifetime.cjs');
const {spawn}=require('node:child_process');
test('helper lifetime follows its game process, not an HTTP response',()=>{
  let running=true,tick,stops=0,cleared=0;
  const cancel=watchGame(123,{alive:()=>running,stop:()=>stops++,setTimer:fn=>{tick=fn;return 1;},clearTimer:()=>cleared++});
  tick();assert.equal(stops,0);
  running=false;tick();tick();assert.equal(stops,1);assert.equal(cleared,1);
  cancel();tick();assert.equal(stops,1);
  assert.throws(()=>watchGame(-1,{stop:()=>{}}),/Invalid/);
});

test('the real process monitor notices a child process exiting',async()=>{
  const child=spawn(process.execPath,['-e','setTimeout(()=>{},250)'],{windowsHide:true,stdio:'ignore'});
  let cancel=()=>{},deadline;
  try{
    await new Promise((resolve,reject)=>{
      child.once('error',reject);
      deadline=setTimeout(()=>reject(new Error('Process exit was not detected')),3000);
      cancel=watchGame(child.pid,{interval:20,stop:resolve});
    });
  }finally{clearTimeout(deadline);cancel();if(child.exitCode===null)child.kill();}
});
