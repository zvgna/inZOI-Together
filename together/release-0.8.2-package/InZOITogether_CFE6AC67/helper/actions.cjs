const crypto=require('node:crypto');
const patterns={greet:/^Co_Friendship_G04_Start[2-5]?$/,handshake:/^Co_HandShake_(Male|Female)To(Male|Female)_Business$/,hug:/^Co_(Spouse_)?HugUp_(Male|Female)To(Male|Female)_Success$/};
function createActions({now=Date.now}={}){
  const events=[];
  function expire(){for(const event of events)if(['requested','queued'].includes(event.state)&&now()>event.expires){event.state='expired';event.reason='Время ожидания взаимодействия истекло';}}
  function active(){expire();return events.some(e=>['requested','queued'].includes(e.state));}
  function fail(status,message){throw Object.assign(Error(message),{status});}
  function request(player,other,kind){
    expire();
    if(!patterns[kind])fail(400,'Неизвестное взаимодействие');
    if(!player.character||!other||!other.character)fail(409,'Оба игрока должны выбрать персонажей');
    if(active())fail(409,'Дождитесь завершения текущего взаимодействия');
    const event={id:crypto.randomBytes(16).toString('hex'),kind,actor:player.character.id,target:other.character.id,actorSlot:player.slot,state:'requested',expires:now()+15000,acks:{}};
    events.push(event);if(events.length>100)events.shift();return event;
  }
  function resolve(player,id,data){
    expire();if(player.slot!==1)fail(403,'Решение принимает хост');
    const event=events.find(e=>e.id===id);if(!event)fail(404,'Взаимодействие не найдено');
    if(event.state!=='requested')return event;
    if(data.state==='rejected'){event.state='rejected';event.reason=String(data.reason||'Действие недоступно').slice(0,300);return event;}
    if(data.state!=='queued'||typeof data.bag!=='string'||!patterns[event.kind].test(data.bag))fail(400,'Неверное действие для выбранного взаимодействия');
    event.state='queued';event.bag=data.bag;event.expires=now()+90000;return event;
  }
  function acknowledge(player,id,data){
    expire();const event=events.find(e=>e.id===id);if(!event)fail(404,'Взаимодействие не найдено');
    if(event.state!=='queued')return event;
    if(!['started','completed','failed'].includes(data.state))fail(400,'Неверный статус действия');
    const old=event.acks[player.slot];
    if(old&&['completed','failed'].includes(old))return event;
    event.acks[player.slot]=data.state;
    if(data.state==='failed'){event.state='failed';event.reason=String(data.reason||'Игра отклонила действие').slice(0,300);}
    else if(event.acks[1]==='completed'&&event.acks[2]==='completed')event.state='completed';
    return event;
  }
  function list(){expire();return events;}
  function cancel(){for(const event of events)if(['requested','queued'].includes(event.state)){event.state='failed';event.reason='Подключение или персонаж участника изменились';}}
  return {active,request,resolve,acknowledge,list,cancel};
}
module.exports={createActions,patterns};
