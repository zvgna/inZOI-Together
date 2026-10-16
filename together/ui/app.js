(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  $('status').textContent = 'Интерфейс v0.5 загружен. Выберите Хост или Гость.';
  function trace(key, value) {
    try {
      if (!window.inzoi || !window.inzoi.cli) return;
      var raw = unescape(encodeURIComponent(String(value))), hex = '';
      for (var n = 0; n < raw.length; n++) hex += ('0' + raw.charCodeAt(n).toString(16)).slice(-2);
      window.inzoi.cli.execute('uimod.cfg_save', {mod_id:'InZOITogether_CFE6AC67',section:'ui_trace',key:key,value:hex}).catch(function () {});
    } catch (_) {}
  }
  window.addEventListener('error', function (event) { $('status').textContent = 'Ошибка интерфейса: ' + event.message; trace('error', event.message); });
  trace('boot', 'phone-bridge-v3');
  var token = '', base = '', slot = 0, cursor = 0, channel = 'global', history = [], timer = null;
  var generation = 0, pending = false, unread = { global: 0, phone: 0 };
  var takeover = false;
  var room = null;
  var ownCharacter = 0, partnerCharacter = null;
  var hostSaves = [];
  function helper(method, endpoint, payload) {
    if (!window.inzoi) return Promise.reject(new Error('Помощник используется через F2 внутри игры'));
    return cfg('load','helper_key').then(function (result) {
      var key = configValue(result);
      if (!key) throw new Error('Сначала запустите start-helper.cmd на этом ПК');
      return new Promise(function (resolve,reject) {
        var xhr=new XMLHttpRequest(); xhr.open(method,'http://127.0.0.1:11215'+endpoint,true);xhr.timeout=10000;
        xhr.setRequestHeader('X-Together-Key',key);xhr.setRequestHeader('Content-Type','application/json');
        xhr.onload=function(){try{var data=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new Error(data.error));}catch(e){reject(e);}};
        xhr.onerror=xhr.ontimeout=function(){reject(new Error('Локальный помощник недоступен. Запустите start-helper.cmd'));};
        xhr.send(payload?JSON.stringify(payload):null);
      });
    });
  }
  function startSession(payload) {
    helper('POST','/jobs',payload).then(function (job) {
      status('Помощник устанавливает и загружает сохранение. После загрузки откройте F2.');
      function check(){helper('GET','/jobs/'+job.id).then(function(result){if(result.state==='running')setTimeout(check,1500);else status(result.state==='done'?'Сохранение загружено. Откройте F2.':result.output,result.state!=='done');}).catch(function(error){status(error.message,true);});}
      check();
    }).catch(function(error){status(error.message,true);});
  }
  $('list-host-saves').addEventListener('click',function(){
    helper('GET','/saves').then(function(data){
      hostSaves=data.saves;var select=$('host-save');select.textContent='';
      hostSaves.forEach(function(save,index){var option=document.createElement('option');option.value=String(index);option.textContent=save.slot+' · '+save.saved_time;select.appendChild(option);});
      status('Выберите сохранение. Для его загрузки сначала выйдите в главное меню.');
    }).catch(function(error){status(error.message,true);});
  });
  $('prepare-host').addEventListener('click',function(){var save=hostSaves[Number($('host-save').value)];if(!save){status('Сначала выберите сохранение',true);return;}startSession({mode:'Host',folder:save.folder,file:save.file});});
  $('install-guest').addEventListener('click',function(){
    if(slot!==2||!token){status('Выберите роль «Гость» и подключитесь к комнате',true);return;}
    startSession({mode:'Guest',server:base,token:token,character:Number($('guest-character').value)});
  });
  function resultData(result) {
    if (typeof result === 'string') { try { return JSON.parse(result); } catch (_) { return null; } }
    if (result && result.data !== undefined) return resultData(result.data);
    return result;
  }
  var positionEnabled = false, positionBusy = false, lastRemoteTime = 0, lastOwnPosition = '', ownPositionSeen = 0, lastSentId = 0;
  function positionTick(current) {
    if (!positionEnabled || positionBusy || !window.inzoi || current !== generation) return;
    positionBusy = true;
    var own = ownCharacter;
    if (!own || !room || !room.save) { positionBusy = false; return; }
    cfg('load', 'position' + own).then(function (result) {
      if (!positionEnabled || current !== generation) return;
      var value = configValue(result);
      if (!value || !/^-?\d+(?:\.\d+)?\|-?\d+(?:\.\d+)?\|-?\d+(?:\.\d+)?\|\d+$/.test(value)) throw new Error('Lua ещё не передал координаты');
      if (value !== lastOwnPosition) { lastOwnPosition = value; ownPositionSeen = Date.now(); }
      if (Date.now() - ownPositionSeen > 5000) { request('POST','/positions',{enabled:false},token).catch(function () {}); throw new Error('Нет свежих координат от Lua'); }
      var xyz = value.split('|').map(Number);
      return request('POST', '/positions', {character:own,world:room.save.map,x:xyz[0],y:xyz[1],z:xyz[2]}, token);
    }).then(function () {
      if (positionEnabled && current === generation) return request('GET', '/positions', null, token);
    }).then(function (data) {
      if (!data || !positionEnabled || current !== generation) return;
      var p = data.position;
      if (!p) { $('position-status').textContent = 'Ждём свежие координаты второго ПК'; return; }
      if (!partnerCharacter || p.character !== partnerCharacter.id || p.character === own || p.world !== room.save.map || p.time <= lastRemoteTime) return;
      return window.inzoi.cli.execute('movement.teleport', {entity_id:String(p.character),X:p.x,Y:p.y,Z:p.z}).then(function (result) {
        if (result && result.success === false) throw new Error(result.error || 'Игра отклонила перемещение');
        lastRemoteTime = p.time; $('position-status').textContent = 'Координаты другого игрока применены: ' + p.x.toFixed(0) + ', ' + p.y.toFixed(0) + ', ' + p.z.toFixed(0);
      });
    }).catch(function (error) { $('position-status').textContent = 'Координаты: ' + error.message; }).then(function () { positionBusy = false; });
  }
  $('position-toggle').addEventListener('click', function () {
    if (!window.inzoi || !token) { status('Синхронизация включается через F2 внутри игры', true); return; }
    positionEnabled = !positionEnabled; lastRemoteTime = 0;
    $('position-toggle').textContent = positionEnabled ? 'Остановить синхронизацию координат' : 'Включить синхронизацию координат';
    if (!positionEnabled) request('POST','/positions',{enabled:false},token).catch(function () {});
  });
  var phoneQueue = [], phoneBusy = false;
  var dockBusy = false, phoneDocked = false, roomWanted = true;
  function uiResult(value) {
    if (typeof value === 'string') { try { return uiResult(JSON.parse(value)); } catch (_) { return null; } }
    if (!value) return null;
    if (value.nodes) return value;
    if (value.data) return uiResult(value.data);
    return null;
  }
  function leavePhoneDock() {
    if (!phoneDocked) return;
    phoneDocked = false;
    var root = $('app-root'); root.className = roomWanted ? '' : 'room-collapsed'; root.style.left = '60px'; root.style.top = '60px'; root.style.width = roomWanted ? '480px' : '220px';
    if (window.inzoi && window.inzoi.view.setContentRect) window.inzoi.view.setContentRect(root.offsetLeft,root.offsetTop,root.offsetWidth,root.offsetHeight);
  }
  function dockPhone(current) {
    if (dockBusy || !window.inzoi || !window.inzoi.cli || current !== generation) return;
    dockBusy = true;
    window.inzoi.cli.execute('ui.get_tree', {window:'Smartphone',max_nodes:150}).then(function (result) {
      if (current !== generation) return;
      var tree = uiResult(result), anchor = null, partnerSelected = false;
      trace('dock_tree', tree ? 'parsed' : 'unparsed');
      var partner = partnerCharacter ? partnerCharacter.name : '';
      function walk(nodes) {
        (nodes || []).forEach(function (node) {
          if (node.ref && node.ref.indexOf('Mobile_Message_Popup/BW_Button_SendMessage') >= 0 && node.rect) anchor = node.rect;
          if (node.role === 'entry' && node.text === partner && node.state && node.state.indexOf('selected') >= 0) partnerSelected = true;
          walk(node.children);
        });
      }
      if (tree) walk(tree.nodes);
      if (!anchor || !partnerSelected) { trace('dock_state', !anchor ? 'no_anchor' : 'other_contact'); leavePhoneDock(); return; }
      var root = $('app-root');
      root.className = 'phone-dock'; root.style.left = (anchor[0] - 6) + 'px'; root.style.top = (anchor[1] - 120) + 'px'; root.style.width = (anchor[2] + 12) + 'px';
      if (!phoneDocked) window.inzoi.view.show();
      phoneDocked = true;
      trace('dock_state', 'visible');
      if (window.inzoi.view.setContentRect) window.inzoi.view.setContentRect(root.offsetLeft,root.offsetTop,root.offsetWidth,root.offsetHeight);
    }).catch(function (error) { trace('dock_error', error.message || String(error)); leavePhoneDock(); }).then(function () { dockBusy = false; });
  }
  function configValue(result) {
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) { return null; } }
    if (!result) return null;
    if (result.value !== undefined) return result.value;
    if (result.data !== undefined) return configValue(result.data);
    return null;
  }
  function cfg(action, key, value) {
    var params = { mod_id:'InZOITogether_CFE6AC67', section:'bridge', key:key };
    if (value !== undefined) params.value = value;
    if (action === 'load') return window.inzoi.cli.execute('uimod.cfg_load', params);
    return window.inzoi.cli.execute('uimod.cfg_save', params);
  }
  function phoneUid(message) {
    function pad(value, length) { return (new Array(length + 1).join('0') + value.toString(16)).slice(-length); }
    return pad(Date.parse(message.time), 12) + pad(message.id, 12) + pad(message.from, 4) + pad(message.to, 4);
  }
  function phonePayload(message) {
    var bytes = unescape(encodeURIComponent(message.text)), hex = '';
    for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes.charCodeAt(i).toString(16)).slice(-2);
    return phoneUid(message) + '|' + message.fromCharacter + '|' + message.toCharacter + '|' + hex;
  }
  function pumpPhone(current) {
    if (phoneBusy || !phoneQueue.length || current !== generation) return;
    if (!window.inzoi || !window.inzoi.cli) { $('phone-status').textContent = 'Браузер передаёт текст в сеть. Получение в телефон работает через окно F2 в игре.'; return; }
    phoneBusy = true;
    var message = phoneQueue[0], uid = phoneUid(message);
    if (!ownCharacter) { phoneBusy = false; return; }
    cfg('load', 'ack_' + uid).catch(function () { return null; }).then(function (result) {
      if (current !== generation) return;
      if (configValue(result) === '1') {
        if (message.to === slot) return request('POST', '/phone/ack', {id:message.id}, token).then(function () { phoneQueue.shift(); $('phone-status').textContent = 'Входящее сообщение обработано телефоном; подтверждение отправлено.'; });
        phoneQueue.shift(); $('phone-status').textContent = 'Исходящее записано в местный телефон. Ждём подтверждения второго ПК.'; return;
      }
      return cfg('save', 'inbox' + ownCharacter, phonePayload(message)).then(function () {
        if (current === generation) $('phone-status').textContent = 'Текст передан Lua-мосту. Ожидаем подтверждение телефона…';
      });
    }).catch(function (error) { if (current === generation) $('phone-status').textContent = 'Доставка в телефон: ' + (error.message || String(error)); }).then(function () { phoneBusy = false; });
  }
  if (window.location && window.location.protocol === 'http:') $('server').value = window.location.origin;
  function status(text, error) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
  function request(method, endpoint, payload, auth, server) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, (server || base) + endpoint, true);
      xhr.timeout = 6000;
      if (payload) xhr.setRequestHeader('Content-Type', 'application/json');
      if (auth) xhr.setRequestHeader('Authorization', 'Bearer ' + auth);
      xhr.onload = function () {
        if (xhr.status === 0 || !xhr.responseText) { reject(new Error('Нет ответа сервера. Проверьте, запущен ли сервер на первом ПК.')); return; }
        var result;
        try { result = JSON.parse(xhr.responseText); } catch (_) { reject(new Error('Сервер вернул неверный ответ')); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else { var error = new Error(result.error || ('HTTP ' + xhr.status)); error.status = xhr.status; reject(error); }
      };
      xhr.onerror = function () { reject(new Error('Нет связи. Проверьте адрес, сервер и разрешение брандмауэра для локальной сети')); };
      xhr.ontimeout = function () { reject(new Error('Сервер не ответил вовремя')); };
      xhr.send(payload ? JSON.stringify(payload) : null);
    });
  }
  function tabs() {
    $('global-tab').textContent = 'Общий чат' + (unread.global ? ' (' + unread.global + ')' : '');
    $('phone-tab').textContent = 'Личные сообщения' + (unread.phone ? ' (' + unread.phone + ')' : '');
  }
  function render() {
    var list = $('messages');
    while (list.firstChild) list.removeChild(list.firstChild);
    var visible = history.filter(function (m) { return m.channel === channel; });
    if (!visible.length) { var empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Сообщений пока нет. Напишите первым.'; list.appendChild(empty); }
    visible.forEach(function (m) {
      var item = document.createElement('div'); item.className = 'message' + (m.from === slot ? ' mine' : '');
      var meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = m.name + ' · ' + new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var text = document.createElement('p'); text.textContent = m.text;
      item.appendChild(meta); item.appendChild(text); list.appendChild(item);
    });
    list.scrollTop = list.scrollHeight;
    tabs();
  }
  function selectChannel(next) {
    channel = next; unread[channel] = 0;
    $('global-tab').className = channel === 'global' ? 'active' : '';
    $('phone-tab').className = channel === 'phone' ? 'active' : '';
    $('phone-note').hidden = channel !== 'phone'; render();
  }
  function reset() {
    positionEnabled = false; lastRemoteTime = 0;
    ownCharacter = 0; partnerCharacter = null;
    $('connection-actions').style.display = ''; $('connect-form').style.display = '';
    takeover = false; $('connect').textContent = 'Подключиться';
    leavePhoneDock();
    generation++; clearTimeout(timer); timer = null; token = ''; cursor = 0; history = []; pending = false;
    $('connect-form').hidden = false; $('chat').hidden = true; $('connect').disabled = false;
    $('connection-actions').hidden = false;
    $('phone-composer').hidden = true;
    room = null; $('save-link').hidden = true; $('save-url').hidden = true;
    phoneQueue = []; phoneBusy = false;
  }
  function addressFor(transport) {
    if (!room) return;
    var found = room.addresses.filter(function (address) { return address.transport === transport; });
    $('guest-address').value = found.length ? found.map(function (address) { return address.url; }).join('  ') : 'Адаптер не найден на ПК хозяина';
  }
  function loadRoom(current) {
    request('GET', '/room', null, token).then(function (data) {
      if (current !== generation) return;
      room = data; addressFor('lan');
      var select=$('guest-character');select.textContent='';
      ((data.save && data.save.characters)||[]).forEach(function(character){var option=document.createElement('option');option.value=String(character.id);option.textContent=character.name+' · семья '+character.household;select.appendChild(option);});
      if (window.inzoi && data.save && Array.isArray(data.save.characters)) {
        window.inzoi.cli.execute('game.get_state', {}).then(function (result) {
          var state = resultData(result);
          if (!state || state.phase !== 'in_game' || state.map_id !== data.save.map) throw new Error('Загрузите сохранение комнаты');
          return request('POST','/claim',{character:Number(state.possessed_entity_id),world:state.map_id,sha256:data.save.sha256},token);
        }).then(function (result) {
          if (current !== generation) return;
          ownCharacter = result.character.id;
          positionEnabled = true;
          $('position-toggle').textContent = 'Остановить синхронизацию координат';
          return cfg('save','local_character',String(ownCharacter));
        }).catch(function (error) { status(error.message, true); });
      }
      $('download-save').disabled = !data.save;
      $('save-details').textContent = data.save ? data.save.title + '\nВерсия игры: ' + data.save.gameVersion + ' · ' + (data.save.bytes / 1048576).toFixed(1) + ' МБ\nSHA-256: ' + data.save.sha256 : 'Сохранение ещё не подготовлено';
    }).catch(function (error) { if (current === generation) $('save-details').textContent = error.message; });
  }
  $('lan-address').addEventListener('click', function () { addressFor('lan'); });
  $('radmin-address').addEventListener('click', function () { addressFor('radmin'); });
  $('hamachi-address').addEventListener('click', function () { addressFor('hamachi'); });
  $('download-save').addEventListener('click', function () {
    var current = generation;
    request('POST', '/room/save-ticket', {}, token).then(function (data) {
      if (current !== generation) return;
      var link = base + data.path;
      $('save-link').href = link; $('save-link').hidden = false;
      $('save-url').value = link; $('save-url').hidden = false;
      status('Ссылка действует 5 минут и позволяет одно скачивание. В игре скопируйте её в браузер.');
    }).catch(function (error) { if (current === generation) status(error.message, true); });
  });
  function poll(current) {
    if (!token || current !== generation) return;
    request('GET', '/messages?after=' + cursor, null, token).then(function (data) {
      if (current !== generation) return;
      data.messages.forEach(function (m) { if (m.channel !== channel && m.from !== slot) unread[m.channel]++; });
      data.messages.forEach(function (m) { if (m.channel === 'phone') phoneQueue.push(m); });
      history = history.concat(data.messages).slice(-500); cursor = data.cursor;
      $('players').textContent = data.players.map(function (p) { return p.name; }).join(' · ');
      partnerCharacter = null;
      data.players.forEach(function (p) { if (p.slot !== slot) partnerCharacter = p.character; });
      if (slot===2 && partnerCharacter && room && room.save) {
        var options=$('guest-character').options;
        for(var oi=0;oi<options.length;oi++){var optionCharacter=room.save.characters.filter(function(c){return c.id===Number(options[oi].value);})[0];options[oi].disabled=optionCharacter && optionCharacter.household===partnerCharacter.household;}
        if ($('guest-character').selectedIndex>=0 && options[$('guest-character').selectedIndex].disabled) {for(var gi=0;gi<options.length;gi++){if(!options[gi].disabled){$('guest-character').selectedIndex=gi;break;}}}
      }
      status(data.players.length === 2 ? 'Оба игрока подключены' : 'Подключено. Ждём второго игрока…');
      if (data.messages.length) render();
      pumpPhone(current);
      dockPhone(current);
      positionTick(current);
      if (lastSentId && (data.receipts || []).some(function (r) { return r.id === lastSentId; })) $('phone-status').textContent = 'Телефон второго ПК подтвердил обработку сообщения.';
    }).catch(function (error) {
      if (current !== generation) return;
      if (error.status === 401) reset();
      status(error.message, true);
    }).then(function () { if (token && current === generation) timer = setTimeout(function () { poll(current); }, 1000); });
  }
  function connect(event, replace) {
    trace('click', 'connect');
    event.preventDefault();
    if (pending || token) return;
    var address = $('server').value.trim().replace(/\/$/, '');
    if (!/^http:\/\/(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(address)) { status('Введите адрес вида http://192.168.1.10:11214', true); return; }
    pending = true; ownCharacter = 0; partnerCharacter = null; positionEnabled = false; $('connect').disabled = true; status('Подключение…');
    var current = ++generation;
    request('POST', '/join', { code: $('code').value.trim(), slot: Number($('slot').value), name: $('name').value.trim(), replace: replace === true || takeover }, null, address).then(function (data) {
      if (current !== generation) return;
      base = address; token = data.token; slot = data.slot; cursor = data.cursor; history = []; unread = { global: 0, phone: 0 };
      $('connection-actions').hidden = true; $('phone-composer').hidden = false; $('reconnect').hidden = true; $('connect-form').hidden = true; $('chat').hidden = false; pending = false; selectChannel('phone'); loadRoom(current); poll(current);
      $('connection-actions').style.display = 'none'; $('connect-form').style.display = 'none';
      $('chat').removeAttribute('hidden'); $('phone-composer').removeAttribute('hidden');
    }).catch(function (error) { if (current === generation) { pending = false; $('connect').disabled = false; takeover = error.status === 409; $('connect').textContent = takeover ? 'Переподключить это место' : 'Подключиться'; $('reconnect').hidden = true; status(takeover ? 'Место занято старым подключением. Нажмите «Переподключить это место» внизу окна.' : error.message, true); } });
  }
  $('connect-form').addEventListener('submit', connect);
  $('connect').addEventListener('click', connect);
  $('reconnect').addEventListener('click', function (event) { connect(event, true); });
  $('disconnect').addEventListener('click', function () {
    var oldToken = token; reset();
    request('POST', '/leave', {}, oldToken).catch(function () {}); status('Отключено');
  });
  function pickSlot(value) {
    takeover = false; $('connect').textContent = 'Подключиться';
    $('slot').value = String(value);
    $('name').value = value === 1 ? 'Хост' : 'Гость';
    $('slot-one').className = 'slot-button' + (value === 1 ? ' selected' : '');
    $('slot-two').className = 'slot-button' + (value === 2 ? ' selected' : '');
    $('slot-one').setAttribute('aria-pressed', String(value === 1));
    $('slot-two').setAttribute('aria-pressed', String(value === 2));
  }
  $('slot-one').addEventListener('click', function () { pickSlot(1); });
  $('slot-two').addEventListener('click', function () { pickSlot(2); });
  $('global-tab').addEventListener('click', function () { selectChannel('global'); });
  $('phone-tab').addEventListener('click', function () { selectChannel('phone'); });
  function sendMessage(event) {
    event.preventDefault();
    var text = $('text').value.trim(), current = generation;
    if (!text || !token || $('send').disabled) return;
    $('send').disabled = true;
    request('POST', '/messages', { text: text, channel: 'phone' }, token).then(function (result) {
      lastSentId = result.id;
      if (current === generation) { $('text').value = ''; $('phone-status').textContent = 'Сообщение принято сервером. Доставка в игру ожидает подтверждения.'; }
    }).catch(function (error) { if (current === generation) status(error.message, true); }).then(function () { $('send').disabled = false; });
  }
  $('send-form').addEventListener('submit', sendMessage);
  $('send').addEventListener('click', sendMessage);
  $('text').addEventListener('mouseup', function () {
    if (window.inzoi && window.inzoi.view.hover) window.inzoi.view.hover(true);
    $('text').focus();
    trace('composer_focus', document.activeElement === $('text') ? 'focused' : 'missing');
  });
  $('text').addEventListener('input', function () { trace('composer_input_length', $('text').value.length); });
  if (window.inzoi && window.inzoi.trigger) {
    cfg('load','bootstrap').then(function (result) {
      var raw = configValue(result);
      if (!raw) return;
      var setup = JSON.parse(raw);
      if (setup.slot !== 1 && setup.slot !== 2) return;
      $('server').value = setup.server; $('code').value = setup.code; pickSlot(setup.slot);
      return cfg('save','bootstrap','').then(function () { connect({preventDefault:function(){}},false); });
    }).catch(function (error) { status('Автовход: '+error.message,true); });
    window.inzoi.trigger.onActivated(function (trigger) {
      if (trigger.type === 'keybind' && trigger.key === 'F2') console.log('[Together] F2');
    });
    $('close-btn').style.display = 'block';
    $('close-btn').addEventListener('click', function () {
      if (window.wf) window.wf.save();
      roomWanted = false;
      phoneDocked = true;
      leavePhoneDock();
      window.inzoi.view.hover(false);
    });
    $('title-bar').addEventListener('click', function (event) {
      if (!roomWanted && !phoneDocked && event.target.id !== 'close-btn') {
        roomWanted = true; phoneDocked = true; leavePhoneDock();
      }
    });
    $('app-root').addEventListener('mouseenter', function () { window.inzoi.view.hover(true); });
    $('app-root').addEventListener('mouseleave', function () { window.inzoi.view.hover(false); });
  } else {
    $('close-btn').style.display = 'block';
    $('close-btn').addEventListener('click', function () { status('Это браузерный тест. Закройте вкладку для выхода.'); });
  }
})();
