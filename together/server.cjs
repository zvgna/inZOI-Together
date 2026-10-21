const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createActions}=require('./actions.cjs');
const {createAuthority}=require('./authority.cjs');

function createRelay({ code = crypto.randomBytes(8).toString('hex'), shareDir = path.join(__dirname, 'share'), now = Date.now } = {}) {
  const players = new Map();
  const leases = new Map();
  const messages = [];
  const receipts = new Map();
  const positions = new Map();
  const actions=createActions({now});
  const authority=createAuthority({now});
  let sequence = 0;
  const tickets = new Map();
  function snapshot() {
    try { return JSON.parse(fs.readFileSync(path.join(shareDir, 'save-info.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return null; }
  }
  function roomInfo(port) {
    let save = null;
    save = snapshot();
    const addresses = [];
    for (const [name, entries] of Object.entries(os.networkInterfaces())) for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const transport = /radmin/i.test(name) ? 'radmin' : /hamachi/i.test(name) ? 'hamachi' : /vpn|wireguard|amnezia|tun/i.test(name) ? 'other' : 'lan';
      addresses.push({ name, transport, url: 'http://' + entry.address + ':' + port });
    }
    return { version: 5, code, addresses, save, syncReady: false, phoneReady: false };
  }
  function prune() {
    for (const [slot, player] of players) {
      if (now() - player.seen > 60000) { actions.cancel(); players.delete(slot); positions.delete(slot); }
    }
    for (const [slot, player] of leases) if (now() - player.seen > 600000) leases.delete(slot);
  }
  function send(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 8192) throw Object.assign(new Error('Слишком большой запрос'), { status: 413 });
    }
    try { return JSON.parse(text); }
    catch { throw Object.assign(new Error('Некорректный JSON'), { status: 400 }); }
  }
  const server = http.createServer(async (req, res) => {
    // The game UI has a coui:// origin. No cookies are used; API access requires a session token.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && /^\/download\/[a-f0-9]{48}$/.test(url.pathname)) {
        const ticket = url.pathname.slice('/download/'.length), expiry = tickets.get(ticket);
        if (!expiry || expiry < now()) { send(res, 403, { error: 'Ссылка истекла. Получите новую в комнате' }); return; }
        const file = path.join(shareDir, 'room-save.zip');
        if (!fs.existsSync(file)) { send(res, 404, { error: 'Копия сохранения не подготовлена' }); return; }
        tickets.delete(ticket);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="inZOI-Together-save.zip"', 'Content-Length': fs.statSync(file).size });
        const stream = fs.createReadStream(file);
        stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      const staticFiles = { '/': 'index.html', '/app.js': 'app.js', '/interactions.js':'interactions.js', '/connection.js':'connection.js', '/styles.css': 'styles.css', '/window.js': 'window.js' };
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const filename = staticFiles[url.pathname];
        const mime = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        fs.createReadStream(path.join(__dirname, 'ui', filename)).pipe(res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { ok: true, version: 7, protocol: 2, feature: 'room-prototype' }); return;
      }
      prune();
      if (req.method === 'POST' && url.pathname === '/resume') {
        const data = await body(req);
        const player = typeof data.resumeToken === 'string' && /^[a-f0-9]{64}$/.test(data.resumeToken) && Array.from(leases.values()).find(p => p.resumeToken === data.resumeToken);
        if (!player) { send(res, 401, {error:'Сеанс истёк или место занято заново. Подключитесь с кодом комнаты.'}); return; }
        player.token = crypto.randomBytes(24).toString('hex'); player.seen = now();
        players.set(player.slot, player); positions.delete(player.slot); actions.cancel();
        send(res,200,{token:player.token,resumeToken:player.resumeToken,slot:player.slot,cursor:0}); return;
      }
      if (req.method === 'POST' && url.pathname === '/join') {
        const data = await body(req);
        if (data.code !== code) { send(res, 403, { error: 'Неверный код комнаты' }); return; }
        if (![1, 2].includes(data.slot)) { send(res, 400, { error: 'Выберите игрока 1 или 2' }); return; }
        if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 40) {
          send(res, 400, { error: 'Имя должно содержать от 1 до 40 символов' }); return;
        }
        if (leases.has(data.slot) && data.replace !== true) { send(res, 409, { error: 'Это место занято. Нажмите «Переподключить это место», чтобы отключить старое подключение.' }); return; }
        const player = { slot: data.slot, name: data.name.trim(), token: crypto.randomBytes(24).toString('hex'), resumeToken: crypto.randomBytes(32).toString('hex'), seen: now() };
        players.set(player.slot, player);
        leases.set(player.slot, player);
        actions.cancel();
        positions.delete(player.slot);
        send(res, 200, { token: player.token, resumeToken:player.resumeToken, slot: player.slot, cursor: 0 }); return;
      }
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const player = Array.from(players.values()).find(p => p.token === token);
      if (!player) { send(res, 401, { error: 'Подключитесь к комнате заново' }); return; }
      player.seen = now();
      if (url.pathname === '/authority' || url.pathname.startsWith('/authority/')) {
        const data = req.method === 'POST' ? await body(req) : null;
        if (url.pathname === '/authority' && req.method === 'POST' && data.enabled === true && actions.list().some(event => ['requested','queued'].includes(event.state))) {
          send(res,409,{error:'Сначала завершите текущее сетевое взаимодействие'}); return;
        }
        send(res,200,authority.handle(player,players,req.method,url.pathname,data)); return;
      }
      if (authority.active(players) && (url.pathname === '/positions' || url.pathname === '/actions' || url.pathname.startsWith('/actions/'))) {
        send(res,409,{error:'Передача управления активна; прежняя синхронизация отключена'}); return;
      }
      if(req.method==='GET'&&url.pathname==='/actions'){send(res,200,{events:actions.list()});return;}
      if(req.method==='POST'&&url.pathname==='/actions'){
        const data=await body(req),a=positions.get(1),b=positions.get(2);
        if(!a||!b||now()-a.time>5000||now()-b.time>5000){send(res,409,{error:'Включите синхронизацию координат на обоих ПК и снимите паузу'});return;}
        if(a.world!==b.world||(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2>500**2){send(res,409,{error:'Подведите персонажей ближе друг к другу'});return;}
        send(res,201,actions.request(player,players.get(3-player.slot),data.kind));return;
      }
      const actionRoute=url.pathname.match(/^\/actions\/([a-f0-9]{32})\/(resolve|ack)$/);
      if(req.method==='POST'&&actionRoute){const data=await body(req);send(res,200,actionRoute[2]==='resolve'?actions.resolve(player,actionRoute[1],data):actions.acknowledge(player,actionRoute[1],data));return;}
      if (req.method === 'POST' && url.pathname === '/claim') {
        const data = await body(req), save = snapshot();
        const character = save && Array.isArray(save.characters) && save.characters.find(c => c.id === data.character);
        if (!character || data.sha256 !== save.sha256 || data.world !== save.map) { send(res, 409, {error:'Загрузите выбранное сохранение комнаты перед выбором персонажа'}); return; }
        const other = players.get(3-player.slot);
        if (other && other.character && other.character.household === character.household) { send(res,409,{error:'Эта семья уже занята другим игроком'}); return; }
        player.character = character; positions.delete(player.slot);
        actions.cancel();
        send(res,200,{character}); return;
      }
      if (req.method === 'POST' && url.pathname === '/phone/ack') {
        const data = await body(req);
        const message = messages.find(m => m.id === data.id && m.channel === 'phone');
        if (!message || message.to !== player.slot) { send(res, 400, { error: 'Подтвердить получение может только адресат' }); return; }
        receipts.set(message.id, { id: message.id, slot: player.slot, time: new Date().toISOString() });
        send(res, 200, { ok: true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/positions') {
        const data = await body(req);
        if (data.enabled === false) { positions.delete(player.slot); send(res, 200, { ok: true }); return; }
        if (!player.character || data.character !== player.character.id || !snapshot() || data.world !== snapshot().map ||
            ![data.x, data.y, data.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000000)) {
          send(res, 400, { error: 'Координаты или персонаж не соответствуют тестовой комнате' }); return;
        }
        positions.set(player.slot, { character: data.character, world: data.world, x: data.x, y: data.y, z: data.z, time: now() });
        send(res, 200, { ok: true }); return;
      }
      if (req.method === 'GET' && url.pathname === '/positions') {
        const position = positions.get(3 - player.slot);
        send(res, 200, { position: !actions.active() && position && now() - position.time < 3000 ? position : null }); return;
      }
      if (req.method === 'GET' && url.pathname === '/room') {
        send(res, 200, roomInfo(server.address().port)); return;
      }
      if (req.method === 'POST' && url.pathname === '/room/save-ticket') {
        if (!roomInfo(server.address().port).save || !fs.existsSync(path.join(shareDir, 'room-save.zip'))) {
          send(res, 404, { error: 'Хозяин ещё не подготовил сохранение' }); return;
        }
        for (const [ticket, expiry] of tickets) if (expiry < now()) tickets.delete(ticket);
        if (tickets.size >= 20) { send(res, 429, { error: 'Слишком много ссылок. Подождите несколько минут' }); return; }
        const ticket = crypto.randomBytes(24).toString('hex');
        tickets.set(ticket, now() + 300000);
        send(res, 200, { path: '/download/' + ticket, expiresInSeconds: 300 }); return;
      }
      if (req.method === 'POST' && url.pathname === '/leave') {
        actions.cancel(); leases.delete(player.slot); positions.delete(player.slot); players.delete(player.slot); send(res, 200, { ok: true }); return;
      }
      if (req.method === 'GET' && url.pathname === '/messages') {
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) { send(res, 400, { error: 'Некорректный курсор' }); return; }
        const visible = messages.filter(m => m.id > after && (m.channel === 'global' || m.from === player.slot || m.to === player.slot));
        send(res, 200, { messages: visible, receipts: Array.from(receipts.values()).filter(r => messages.some(m => m.id === r.id && m.from === player.slot)), cursor: sequence, players: Array.from(players.values(), p => ({ slot: p.slot, name: p.name, character:p.character || null })) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/messages') {
        const data = await body(req);
        if (!['global', 'phone'].includes(data.channel)) { send(res, 400, { error: 'Неизвестный канал' }); return; }
        const other = players.get(3-player.slot);
        if (data.channel === 'phone' && (!player.character || !other || !other.character)) { send(res,409,{error:'Оба игрока должны загрузить сохранение и выбрать разные семьи'}); return; }
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.trim().length > 1000) {
          send(res, 400, { error: 'Сообщение должно содержать от 1 до 1000 символов' }); return;
        }
        if (player.sent && now() - player.sent < 250) { send(res, 429, { error: 'Отправляйте сообщения чуть медленнее' }); return; }
        player.sent = now();
        const message = { id: ++sequence, from: player.slot, name: player.name, to: data.channel === 'phone' ? 3 - player.slot : null, fromCharacter:player.character ? player.character.id : null, toCharacter:other && other.character ? other.character.id : null, channel: data.channel, text: data.text.trim(), time: new Date().toISOString() };
        messages.push(message);
        if (messages.length > 500) receipts.delete(messages.shift().id);
        send(res, 201, { id: message.id }); return;
      }
      send(res, 404, { error: 'Неизвестный запрос' });
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  return { server, code };
}

if (require.main === module) {
  const port = Number(process.env.TOGETHER_PORT || 11214);
  const { server, code } = createRelay({ code: process.env.TOGETHER_CODE || undefined, shareDir: process.env.TOGETHER_SHARE_DIR || undefined });
  server.on('error', error => { console.error('Не удалось запустить сервер:', error.message); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => {
    console.log('\ninZOI Together — тестовый сервер чата\nКод комнаты: ' + code);
    console.log('На этом ПК: http://127.0.0.1:' + port);
    for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) console.log('Адрес для второго ПК: http://' + item.address + ':' + port);
    }
    console.log('Оставьте это окно открытым. Остановка: Ctrl+C.\nИстория хранится в памяти и исчезает при остановке.\n');
  });
}
module.exports = { createRelay };
