const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRelay: makeRelay } = require('./server.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function createRelay(options) {
  if (options.shareDir) return makeRelay(options);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'together-roster-'));
  fs.writeFileSync(path.join(dir,'save-info.json'),JSON.stringify({sha256:'fixture',map:'TestCity',characters:[{id:9001,household:101,name:'Host character'},{id:9002,household:102,name:'Guest character'},{id:9003,household:101,name:'Host relative'}]}));
  const relay=makeRelay({...options,shareDir:dir});
  relay.server.on('close',()=>{fs.unlinkSync(path.join(dir,'save-info.json'));fs.rmdirSync(dir);});
  return relay;
}

test('positions belong to the authenticated slot; phone receipt requires the recipient', async () => {
  const {server} = createRelay({code:'sync'});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(route, data, token) {
    const response = await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  }
  try {
    const a=(await call('/join',{code:'sync',slot:1,name:'Tiana'})).data.token;
    const b=(await call('/join',{code:'sync',slot:2,name:'Alicia'})).data.token;
    assert.equal((await call('/claim',{character:9001,world:'TestCity',sha256:'wrong'},a)).status,409);
    assert.equal((await call('/claim',{character:9001,world:'TestCity',sha256:'fixture'},a)).status,200);
    assert.equal((await call('/claim',{character:9003,world:'TestCity',sha256:'fixture'},b)).status,409);
    assert.equal((await call('/claim',{character:9002,world:'TestCity',sha256:'fixture'},b)).status,200);
    const position={character:9001,world:'TestCity',x:100,y:-200,z:30};
    assert.equal((await call('/positions',position)).status,401);
    assert.equal((await call('/positions',position,b)).status,400);
    assert.equal((await call('/positions',{...position,x:1e20},a)).status,400);
    assert.equal((await call('/positions',{...position,world:'other'},a)).status,400);
    assert.equal((await call('/positions',position,a)).status,200);
    assert.equal((await call('/positions',null,a)).data.position,null);
    assert.equal((await call('/positions',null,b)).data.position.character,9001);
    const id=(await call('/messages',{channel:'phone',text:'hello PC2'},a)).data.id;
    assert.equal((await call('/phone/ack',{id},a)).status,400);
    assert.equal((await call('/phone/ack',{id},b)).status,200);
    assert.equal((await call('/messages',null,a)).data.receipts[0].id,id);
    assert.equal((await call('/positions',{enabled:false},a)).status,200);
    assert.equal((await call('/positions',null,b)).data.position,null);
    await call('/positions',position,a);
    await call('/leave',{},a);
    assert.equal((await call('/positions',null,b)).data.position,null);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('two-player chat: authentication, slots, channels and invalid input', async () => {
  const { server } = createRelay({ code: 'test-room' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = 'http://127.0.0.1:' + server.address().port;
  async function call(route, data, token) {
    const response = await fetch(root + route, {
      method: data ? 'POST' : 'GET',
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: data ? JSON.stringify(data) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await call('/health')).data.feature, 'room-prototype');
    assert.equal((await call('/health')).data.protocol, 1);
    assert.equal((await call('/messages')).status, 401);
    assert.equal((await call('/join', { code: 'wrong', slot: 1, name: 'Тиана' })).status, 403);
    assert.equal((await call('/join', { code: 'test-room', slot: 3, name: 'Тиана' })).status, 400);
    const a = await call('/join', { code: 'test-room', slot: 1, name: 'Тиана' });
    const b = await call('/join', { code: 'test-room', slot: 2, name: 'Алисия' });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.notEqual(a.data.token, b.data.token);
    await call('/claim',{character:9001,world:'TestCity',sha256:'fixture'},a.data.token);
    await call('/claim',{character:9002,world:'TestCity',sha256:'fixture'},b.data.token);
    assert.equal((await call('/join', { code: 'test-room', slot: 1, name: 'Другой' })).status, 409);
    assert.equal((await call('/join', { code: 'wrong', slot: 1, name: 'Другой', replace: true })).status, 403);
    assert.equal((await call('/messages', { channel: 'global', text: 'Привет!' }, a.data.token)).status, 201);
    const first = await call('/messages?after=0', null, b.data.token);
    assert.equal(first.data.players.length, 2);
    assert.equal(first.data.messages[0].text, 'Привет!');
    assert.equal(first.data.messages[0].from, 1);
    assert.equal((await call('/messages', { channel: 'phone', text: 'Личное сообщение', to: 2 }, b.data.token)).status, 201);
    const personal = await call('/messages?after=' + first.data.cursor, null, a.data.token);
    assert.equal(personal.data.messages.length, 1);
    assert.equal(personal.data.messages[0].channel, 'phone');
    assert.equal(personal.data.messages[0].to, 1); // The server, not the sender, chooses the other player.
    assert.equal((await call('/messages?after=' + personal.data.cursor, null, a.data.token)).data.messages.length, 0);
    assert.equal((await call('/messages?after=NaN', null, a.data.token)).status, 400);
    assert.equal((await call('/messages', { channel: 'world', text: 'x' }, a.data.token)).status, 400);
    assert.equal((await call('/messages', { channel: 'global', text: 'x'.repeat(1001) }, a.data.token)).status, 400);
    assert.equal((await call('/messages', { channel: 'global', text: '   ' }, a.data.token)).status, 400);
    assert.equal((await call('/leave', {}, b.data.token)).status, 200);
    assert.equal((await call('/messages', null, b.data.token)).status, 401);
    assert.equal((await call('/join', { code: 'test-room', slot: 2, name: 'Алисия снова' })).status, 200);
    const resumed = await call('/join', { code: 'test-room', slot: 1, name: 'Тиана снова', replace: true });
    assert.equal(resumed.status, 200);
    assert.equal((await call('/messages', null, a.data.token)).status, 401);
    assert.equal((await call('/messages', null, resumed.data.token)).data.players.length, 2);
    const index = await fetch(root + '/');
    assert.equal(index.status, 200);
    assert.match(await index.text(), /inZOI Together/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('room snapshot: authenticated metadata and expiring single-use download link', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'together-save-test-'));
  fs.writeFileSync(path.join(dir, 'room-save.zip'), Buffer.from('fake-zip-for-http-test'));
  fs.writeFileSync(path.join(dir, 'save-info.json'), JSON.stringify({ title: 'test', sha256: 'test-hash' }));
  const { server } = createRelay({ code: 'room', shareDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/room')).status, 401);
    const joined = await (await fetch(base + '/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:'room',slot:2,name:'guest'}) })).json();
    const headers = {Authorization:'Bearer ' + joined.token};
    const room = await (await fetch(base + '/room', {headers})).json();
    assert.equal(room.save.sha256, 'test-hash'); assert.equal(room.syncReady, false);
    assert.equal((await fetch(base + '/download/' + '0'.repeat(48))).status, 403);
    const ticket = await (await fetch(base + '/room/save-ticket', {method:'POST',headers})).json();
    const download = await fetch(base + ticket.path);
    assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/zip');
    assert.equal(await download.text(), 'fake-zip-for-http-test');
    assert.equal((await fetch(base + ticket.path)).status, 403);
    assert.equal((await fetch(base + '/download/../../server.cjs')).status, 401);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const filename of ['room-save.zip', 'save-info.json']) fs.unlinkSync(path.join(dir,filename));
    fs.rmdirSync(dir);
  }
});
