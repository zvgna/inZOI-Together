const crypto = require('node:crypto');

function createAuthority({now = Date.now} = {}) {
  let owner = null;
  const commands = new Map();
  function fail(status, message) { throw Object.assign(new Error(message), {status}); }
  function revoke() {
    owner = null;
    for (const command of commands.values()) {
      if (command.state === 'pending') command.state = 'cancelled';
      else if (command.state === 'dispatched') command.state = 'unknown';
    }
  }
  function active(players) {
    if (owner && (!players.get(1) || !players.get(2) ||
      players.get(2).token !== owner.guestToken || players.get(1).token !== owner.hostToken ||
      players.get(2).character?.id !== owner.actor || players.get(1).character?.id !== owner.hostActor ||
      now() > owner.expires)) revoke();
    return owner;
  }
  function handle(player, players, method, route, data) {
    active(players);
    if (route === '/authority' && method === 'GET') return {enabled:!!owner, actor:owner?.actor || null, hostActor:owner?.hostActor || null, epoch:owner?.epoch || null};
    if (route === '/authority' && method === 'POST') {
      if (player.slot !== 1) fail(403, 'Только хост передаёт управление');
      if (data.enabled === false) { revoke(); return {enabled:false}; }
      if (data.enabled !== true) fail(400, 'Укажите enabled');
      const guest = players.get(2);
      if (!player.character || !guest?.character) fail(409, 'Оба персонажа должны быть выбраны');
      if (!owner) {
        revoke();
        owner = {actor:guest.character.id,hostActor:player.character.id,hostToken:player.token,guestToken:guest.token,epoch:crypto.randomBytes(16).toString('hex'),expires:now()+5000};
      }
      owner.expires = now()+5000;
      return {enabled:true,actor:owner.actor,hostActor:owner.hostActor,epoch:owner.epoch};
    }
    if (!owner) fail(409, 'Хост не подтвердил передачу управления');
    if (route === '/authority/commands' && method === 'POST') {
      if (data.epoch !== owner.epoch) fail(409, 'Передача управления устарела');
      if (typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id)) fail(400, 'Некорректный ID команды');
      const key = owner.epoch + ':' + data.id;
      if (commands.has(key)) return {...commands.get(key)};
      if (data.kind !== 'interaction' || typeof data.bag !== 'string' || !/^[A-Za-z0-9_]{1,160}$/.test(data.bag) || !Number.isSafeInteger(data.target) || data.target <= 0) fail(400, 'Некорректная команда');
      const actor = player.slot === 1 ? owner.hostActor : owner.actor;
      const busy = [...commands.values()].find(c => c.epoch === owner.epoch && ['pending','dispatched','unknown'].includes(c.state) &&
        (c.actor === actor || c.target === actor || c.actor === data.target || c.target === data.target));
      if (busy) fail(409, 'Персонаж или цель уже заняты первым взаимодействием');
      if ([...commands.values()].filter(c => c.epoch === owner.epoch && ['pending','dispatched'].includes(c.state)).length >= 16) fail(429, 'Дождитесь выполнения очереди');
      if (commands.size >= 2048) fail(429, 'Лимит команд сеанса достигнут');
      const command = {id:data.id,epoch:owner.epoch,actor,slot:player.slot,target:data.target,bag:data.bag,kind:data.kind,state:'pending',created:now()};
      commands.set(key,command);
      return {...command};
    }
    if (route === '/authority/commands' && method === 'GET') return {commands:[...commands.values()].filter(c => c.epoch === owner.epoch).map(c => ({...c}))};
    if (route === '/authority/result' && method === 'POST') {
      if (player.slot !== 1) fail(403, 'Результат подтверждает хост');
      const command = commands.get(data.epoch + ':' + data.id);
      if (!command || command.epoch !== owner.epoch) fail(409, 'Команда устарела');
      const transitions = {pending:['dispatched','rejected'],dispatched:['completed','failed','unknown']};
      if (command.state !== data.state && !transitions[command.state]?.includes(data.state)) fail(409, 'Неверный переход состояния');
      command.state = data.state;
      return {...command};
    }
    fail(404, 'Неизвестный запрос управления');
  }
  return {handle,active,revoke};
}
module.exports = {createAuthority};
