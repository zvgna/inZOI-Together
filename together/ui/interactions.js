(function(){
  'use strict';
  var patterns={greet:/^Co_Friendship_G04_Start[2-5]?$/,handshake:/^Co_HandShake_(Male|Female)To(Male|Female)_Business$/,hug:/^Co_(Spouse_)?HugUp_(Male|Female)To(Male|Female)_Success$/};
  window.createTogetherInteractions=function(api){
    var busy=false,seen={},closed={},held=false;
    function status(text){document.getElementById('interaction-status').textContent=text;}
    function game(command,args){return api.game(command,args).then(function(raw){if(raw===false||raw&&(raw.success===false||raw.ok===false||raw.isError))throw new Error(raw.error||raw.message||'Игра отклонила действие');var value=api.data(raw);if(value&&(value.success===false||value.isError))throw new Error(value.error||'Игра отклонила действие');return value||raw||{};});}
    function execute(event,bag){
      return Promise.all([game('interaction.get_current',{entity_id:String(event.actor)}),game('interaction.get_current',{entity_id:String(event.target)})]).then(function(states){
        if(states.some(function(state){return state.playing;}))throw new Error('Один из персонажей занят. Завершите его текущее действие.');
        return api.cfg('save','social_'+event.id,JSON.stringify({state:'dispatching',bag:bag}));
      }).then(function(){return game('interaction.execute',{entity_id:String(event.actor),target_entity_id:String(event.target),interaction_bag_id:bag,insert_front:true});}).then(function(){return api.cfg('save','social_'+event.id,JSON.stringify({state:'queued',bag:bag}));});
    }
    function process(event,context){
      var dispatched=false;
      if(!['requested','queued'].includes(event.state)){
        if(event.reason)status(event.reason);else if(event.state==='completed')status('Взаимодействие завершилось на обоих ПК');
        if(!event.bag||event.state==='completed'||closed[event.id]||event.acks[context.slot]==='completed')return Promise.resolve();
        closed[event.id]=true;
        return api.cfg('load','social_'+event.id).then(function(result){
          var raw=api.value(result);if(!raw||JSON.parse(raw).state!=='queued')return;
          return game('interaction.get_current',{entity_id:String(event.actor)}).then(function(current){if(current.playing&&current.interaction_bag_id===event.bag)return game('interaction.cancel',{entity_id:String(event.actor)});});
        });
      }
      if(event.state==='requested'&&context.slot!==1)return Promise.resolve();
      return api.cfg('load','social_'+event.id).then(function(result){
        var raw=api.value(result),saved=raw?JSON.parse(raw):null;
        if(api.context().generation!==context.generation)return;
        if(saved&&saved.state==='dispatching')throw new Error('Результат предыдущего запроса неизвестен. Повторное действие не запущено.');
        if(event.state==='requested'){
          var choose=saved?Promise.resolve(saved.bag):game('interaction.list_available',{entity_id:String(event.actor),target_entity_id:String(event.target)}).then(function(result){
            var match=(result.interactions||[]).filter(function(item){return item.enabled&&patterns[event.kind].test(item.interaction_bag_id);})[0];
            if(!match)throw new Error('Это взаимодействие сейчас недоступно для выбранной пары');return match.interaction_bag_id;
          });
          return choose.then(function(bag){return(saved?Promise.resolve():execute(event,bag)).then(function(){dispatched=true;return api.request('POST','/actions/'+event.id+'/resolve',{state:'queued',bag:bag});});});
        }
        if(!saved)return execute(event,event.bag);
        return game('interaction.get_current',{entity_id:String(event.actor)}).then(function(current){
          if(current.playing&&current.interaction_bag_id===event.bag){seen[event.id]=true;status('Взаимодействие выполняется');return api.request('POST','/actions/'+event.id+'/ack',{state:'started'});}
          if(seen[event.id]){status('Ожидаем завершения на втором ПК');return api.request('POST','/actions/'+event.id+'/ack',{state:'completed'});}
          status('Действие принято. Ожидаем начала в игре.');
        });
      }).catch(function(error){status(error.message);if(dispatched)return;return api.request('POST','/actions/'+event.id+(event.state==='requested'?'/resolve':'/ack'),{state:event.state==='requested'?'rejected':'failed',reason:error.message});});
    }
    ['greet','handshake','hug'].forEach(function(kind){document.getElementById('action-'+kind).addEventListener('click',function(){api.request('POST','/actions',{kind:kind}).then(function(){status('Запрос отправлен хосту');}).catch(function(error){status(error.message);});});});
    return {held:function(){return held;},poll:function(){
      var context=api.context();if(busy||!context.connected)return;busy=true;
      return api.request('GET','/actions').then(function(result){
        if(api.context().generation!==context.generation)return;
        held=result.events.some(function(event){return ['requested','queued'].includes(event.state);});
        var latest=result.events[result.events.length-1];if(latest)return process(latest,context);
      }).catch(function(error){status('Взаимодействия: '+error.message);}).then(function(){busy=false;});
    }};
  };
})();
