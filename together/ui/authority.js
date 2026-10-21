(function(){
  'use strict';
  window.createTogetherAuthority=function(api){
    var state={enabled:false},busy=false;
    var $=function(id){return document.getElementById(id);};
    function status(text){$('authority-status').textContent=text;}
    function context(){var c=api.context();if(!c.connected)throw new Error('Сначала подключитесь в игре');return c;}
    $('authority-start').addEventListener('click',function(){
      try{var c=context();if(c.slot!==1)throw new Error('Передачу управления включает хост');}catch(error){status(error.message);return;}
      api.helper('POST','/control',{enabled:true,server:c.server,token:c.token}).then(function(){status('Управление передано. Выберите действие для проверки.');}).catch(function(error){status(error.message);});
    });
    $('authority-stop').addEventListener('click',function(){api.helper('POST','/control',{enabled:false}).then(function(){status('ИИ восстановлен. Передача управления остановлена.');}).catch(function(error){status(error.message);});});
    $('authority-list').addEventListener('click',function(){
      var c;try{c=context();if(!state.enabled||!c.partner)throw new Error('Хост должен включить передачу управления');}catch(error){status(error.message);return;}
      api.game('interaction.list_available',{entity_id:String(c.character),target_entity_id:String(c.partner.id)}).then(function(raw){
        if(api.context().generation!==c.generation)return;
        var data=api.data(raw),select=$('authority-bag');select.textContent='';
        (data.interactions||[]).filter(function(item){return item.enabled;}).forEach(function(item){var option=document.createElement('option');option.value=item.interaction_bag_id;option.textContent=item.display_name||item.interaction_bag_id;select.appendChild(option);});
        status(select.options.length?'Выберите действие. Его доступность повторно проверит хост.':'Для этой пары сейчас нет доступных действий.');
      }).catch(function(error){status(error.message);});
    });
    $('authority-send').addEventListener('click',function(){
      var c;try{c=context();if(!state.enabled||!c.partner||!$('authority-bag').value)throw new Error('Сначала получите доступные действия');}catch(error){status(error.message);return;}
      var id='';for(var n=0;n<32;n++)id+=Math.floor(Math.random()*16).toString(16);
      api.request('POST','/authority/commands',{epoch:state.epoch,id:id,kind:'interaction',target:c.partner.id,bag:$('authority-bag').value}).then(function(){status('Запрос принят хостом. Ожидаем выполнения.');}).catch(function(error){status(error.message);});
    });
    return {enabled:function(){return state.enabled;},poll:function(){
      var c=api.context();if(busy||!c.connected)return Promise.resolve();busy=true;
      return api.request('GET','/authority').then(function(value){
        if(api.context().generation!==c.generation)return;
        state=value;
        $('authority-start').style.display=c.slot===1?'':'none';$('authority-stop').style.display=c.slot===1?'':'none';
        if(value.enabled)return api.request('GET','/authority/commands').then(function(result){
          if(api.context().generation!==c.generation)return;
          var last=result.commands[result.commands.length-1];
          if(last)status('Последнее действие: '+({pending:'ожидает проверки',dispatched:'передано в игру хоста',completed:'выполнение закончилось в игре хоста',rejected:'недоступно в игре хоста',unknown:'результат не подтверждён; повтор отключён'}[last.state]||last.state));
        });
      }).catch(function(error){state={enabled:false};status(error.message);}).then(function(){busy=false;});
    },reset:function(){state={enabled:false};}};
  };
})();
