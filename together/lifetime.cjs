function watchGame(pid,{alive=id=>{try{process.kill(id,0);return true;}catch(error){return error.code==='EPERM';}},stop,setTimer=setInterval,clearTimer=clearInterval,interval=2000}={}){
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid game process');
  let finished=false;
  const timer=setTimer(()=>{
    if(finished||alive(pid))return;
    finished=true;clearTimer(timer);stop();
  },interval);
  timer.unref?.();
  return ()=>{finished=true;clearTimer(timer);};
}
module.exports={watchGame};
