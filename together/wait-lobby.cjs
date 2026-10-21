async function waitForLobby({getState,onWait=async()=>{},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeout=900000}){
  const deadline=now()+timeout;
  while(now()<deadline){
    const state=await getState();
    if((state.phase||state.Phase)==='lobby'&&!state.loading&&!state.Loading)return;
    await onWait();
    await delay(1000);
  }
  throw new Error('Ожидание главного меню истекло. Выберите сохранение заново.');
}
module.exports={waitForLobby};
