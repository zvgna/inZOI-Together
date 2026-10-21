(function(){
  'use strict';
  window.createTogetherConnection=function(api){
    var record=null,running=false,epoch=0,timer=null;
    function valid(value){return value&&/^http:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(value.address)&&[1,2].indexOf(value.slot)>=0&&/^[a-f0-9]{64}$/.test(value.resumeToken);}
    function cancel(){epoch++;running=false;if(timer!==null)api.clearTimer(timer);timer=null;}
    function remember(address,data){
      var next={address:address,slot:data.slot,resumeToken:data.resumeToken};
      record=valid(next)?next:null;
      return api.store(record?JSON.stringify(record):'');
    }
    function resume(){
      if(running)return Promise.resolve();
      if(!valid(record)){api.failed('Подключитесь к комнате с её кодом.');return Promise.resolve();}
      running=true;var run=++epoch,current=api.begin(),attempts=0,session=record;
      function attempt(){
        if(run!==epoch)return Promise.resolve();
        api.status('Восстановление соединения…');
        return api.request('POST','/resume',{resumeToken:session.resumeToken},null,session.address).then(function(data){
          if(run!==epoch){if(data.token)return api.request('POST','/leave',{},data.token,session.address).catch(function(){});return;}
          if(data.slot!==session.slot||!/^[a-f0-9]{48}$/.test(data.token))throw new Error('Неверный ответ сервера при восстановлении');
          var address=session.address;running=false;
          return remember(address,data).catch(function(){api.status('Не удалось сохранить ключ восстановления');}).then(function(){if(run===epoch)api.accept(data,address,current);});
        }).catch(function(error){
          if(run!==epoch)return;
          if([400,401,403,404,409].indexOf(error.status)>=0){running=false;record=null;api.store('').catch(function(){});api.failed(error.status===404?'Сервер не поддерживает восстановление. Установите одинаковую сборку на обоих ПК.':error.message);return;}
          attempts++;api.status('Нет связи с хостом. Повторная попытка '+attempts+'…');
          timer=api.setTimer(attempt,Math.min(15000,1000*Math.pow(2,Math.min(attempts-1,4))));
        });
      }
      return attempt();
    }
    return {remember:remember,resume:resume,cancel:cancel,forget:function(){cancel();record=null;return api.store('');},restore:function(){
      var run=epoch;
      return api.load().then(function(raw){if(run!==epoch||!raw)return;try{record=JSON.parse(raw);}catch(_){return api.store('');}if(valid(record))return resume();return api.store('');});
    }};
  };
})();
