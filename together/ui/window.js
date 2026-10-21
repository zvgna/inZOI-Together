(function () {
    'use strict';
    if (typeof engine === 'undefined' || typeof window.inzoi === 'undefined') {
        var _miss = [];
        if (typeof engine === 'undefined')       { _miss.push('coui://inzoi/cohtml.js (engine)'); }
        if (typeof window.inzoi === 'undefined') { _miss.push('coui://inzoi/mod/inzoi-sdk.js (inzoi)'); }
        console.error('[uimod] index.html is missing required script(s): ' + _miss.join(', ') +
            '. Input forwarding / inzoi.view.hover() / inzoi.* APIs will NOT work. ' +
            'Restore the <script> tags (cohtml.js then inzoi-sdk.js) before window.js.');
    }
    var MOD_ID       = 'InZOITogether_CFE6AC67';
    var APP_NAME     = 'together_chat';
    var TRIGGER_TYPE = 'keybind';
    var HAS_CLOSE_BTN = (TRIGGER_TYPE === 'interaction_menu' || TRIGGER_TYPE === 'command');

    var root     = document.getElementById('app-root');
    var content  = document.getElementById('content');
    var closeBtn = document.getElementById('close-btn');
    var minBtn   = document.getElementById('minimize-btn');
    // Restore the saved layout before displaying the window.
    if (document.body) document.body.style.visibility = 'hidden';

    function cli(cmd, params) { return inzoi.cli.execute(cmd, params || {}); }
    function setHover(bOver) {
        try { if (window.inzoi && inzoi.view && inzoi.view.hover) { inzoi.view.hover(bOver); return; } } catch (e) {}
        try {
            if (typeof engine !== 'undefined') {
                engine.call('_uimod_request', JSON.stringify({
                    type: 'view', action: 'hover', over: !!bOver, promiseId: 0
                }));
            }
        } catch (e) {}
    }
    root.addEventListener('mouseenter', function () { setHover(true);  });
    root.addEventListener('mouseleave', function () { setHover(false); });
    root.addEventListener('wheel',      function (e) { e.stopPropagation(); }, { passive: false });
    function _reportContentRect() {
        try {
            if (window.inzoi && inzoi.view && inzoi.view.setContentRect) {
                inzoi.view.setContentRect(
                    root.offsetLeft, root.offsetTop,
                    root.offsetWidth, root.offsetHeight);
            }
        } catch (e) {}
    }
    var _hasFocus = true;
    root.addEventListener('click', function () {
        if (_hasFocus) { return; }
        _hasFocus = true;
        try {
            if (typeof engine !== 'undefined') {
                engine.call('_uimod_request', JSON.stringify({
                    type: 'view', action: 'focus', promiseId: 0
                }));
            }
        } catch (e) {}
    }, false);
    root.addEventListener('mouseleave', function () { _hasFocus = false; });
    // Cohtml can drop native clicks; synthesize one from matching mouse events.
    var _downTarget = null;
    var _synthGuard = false;
    root.addEventListener('mousedown', function (e) { _downTarget = e.target; }, true);
    root.addEventListener('mouseup', function (e) {
        var dt = _downTarget; _downTarget = null;
        if (!dt) { return; }
        var up = e.target;
        var same = (up === dt)
                || (dt.contains && dt.contains(up))
                || (up.contains && up.contains(dt));
        if (!same) { return; }
        _synthGuard = true;
        var evt;
        try { evt = new MouseEvent('click', { bubbles: true, cancelable: true }); }
        catch (err) { evt = document.createEvent('MouseEvents'); evt.initEvent('click', true, true); }
        evt._synthetic = true;
        up.dispatchEvent(evt);
        setTimeout(function () { _synthGuard = false; }, 0);
    }, true);
    root.addEventListener('click', function (e) {
        if (e._synthetic) { return; }
        if (_synthGuard) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
    if (HAS_CLOSE_BTN) {
        if (closeBtn) closeBtn.addEventListener('click', function () {
            saveWindowState();
            setTimeout(function () {
                try {
                    if (typeof engine !== 'undefined') {
                        engine.call('_uimod_request', JSON.stringify({ type: 'view', action: 'hide', promiseId: 0 }));
                    }
                } catch (e) {}
            }, 0);
        });
    } else {
        if (closeBtn) closeBtn.style.display = 'none';
    }
    var CFG_SECTION = 'ui/' + APP_NAME + '/saved';
    var CFG_KEY     = 'window';
    var _saveTimer  = null;

    function currentSize() {
        var w = (root._savedW != null) ? root._savedW : root.offsetWidth;
        var h = (root._savedH != null) ? root._savedH : root.offsetHeight;
        return { w: w, h: h };
    }

    function saveWindowState() {
        try {
            var sz = currentSize();
            var x = root.style.left ? parseFloat(root.style.left) : root.offsetLeft;
            var y = root.style.top  ? parseFloat(root.style.top)  : root.offsetTop;
            cli('uimod.cfg_save', {
                mod_id:  MOD_ID,
                Section: CFG_SECTION,
                Key:     CFG_KEY,
                Value:   JSON.stringify({ x: x, y: y, w: sz.w, h: sz.h, minimized: !!root._minimized })
            });
        } catch (e) {}
    }

    function saveWindowStateSoon() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function () { _saveTimer = null; saveWindowState(); }, 120);
    }
    // Keep part of the title bar on screen so the window can be dragged back.
    var MIN_VISIBLE_PX = 40;

    function clampToViewport(x, y, w, h) {
        var vw = window.innerWidth  || document.documentElement.clientWidth  || 1920;
        var vh = window.innerHeight || document.documentElement.clientHeight || 1080;
        if (typeof w === 'number') w = Math.max(120, Math.min(w, vw));
        if (typeof h === 'number') h = Math.max(60,  Math.min(h, vh));
        if (typeof x === 'number') {
            var maxX = vw - MIN_VISIBLE_PX;
            var minX = MIN_VISIBLE_PX - (typeof w === 'number' ? w : 0);
            x = Math.max(minX, Math.min(x, maxX));
        }
        if (typeof y === 'number') {
            var maxY = vh - MIN_VISIBLE_PX;
            y = Math.max(0, Math.min(y, maxY));
        }
        return { x: x, y: y, w: w, h: h };
    }

    function applyWindowState(state) {
        if (!state) return;
        var c = clampToViewport(state.x, state.y, state.w, state.h);
        if (typeof c.x === 'number') root.style.left   = c.x + 'px';
        if (typeof c.y === 'number') root.style.top    = c.y + 'px';
        if (typeof c.w === 'number') root.style.width  = c.w + 'px';
        if (typeof c.h === 'number') root.style.height = c.h + 'px';
        root._savedW = (typeof c.w === 'number') ? c.w : null;
        root._savedH = (typeof c.h === 'number') ? c.h : null;
        if (state.minimized && typeof root._applyMinimize === 'function') {
            root._applyMinimize(true);
        }
        _reportContentRect();
    }
    var _resizeTimer = null;
    window.addEventListener('resize', function () {
        if (_resizeTimer) clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
            _resizeTimer = null;
            try {
                var sz = currentSize();
                var x  = root.style.left ? parseFloat(root.style.left) : root.offsetLeft;
                var y  = root.style.top  ? parseFloat(root.style.top)  : root.offsetTop;
                var c  = clampToViewport(x, y, sz.w, sz.h);
                var changed = (c.x !== x) || (c.y !== y) || (c.w !== sz.w) || (c.h !== sz.h);
                if (!changed) return;
                root.style.left = c.x + 'px';
                root.style.top  = c.y + 'px';
                if (!root._minimized) {
                    root.style.width  = c.w + 'px';
                    root.style.height = c.h + 'px';
                }
                root._savedW = c.w;
                root._savedH = c.h;
                saveWindowStateSoon();
                _reportContentRect();
            } catch (e) {}
        }, 120);
    });

    function loadWindowState() {
        function reveal() { if (document.body) document.body.style.visibility = ''; _reportContentRect(); }
        try {
            var p = cli('uimod.cfg_load', { mod_id: MOD_ID, Section: CFG_SECTION, Key: CFG_KEY });
            if (p && typeof p.then === 'function') {
                p.then(function (res) {
                    var raw = (res && (res.value || res.data && res.data.value)) || null;
                    if (raw) {
                        try { applyWindowState(JSON.parse(raw)); } catch (e) {}
                    }
                    reveal();
                }).catch(function () { reveal(); });
            } else {
                reveal();
            }
        } catch (e) { reveal(); }
    }
    root._saveWindowStateSoon = saveWindowStateSoon;
    root._saveWindowState     = saveWindowState;
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) saveWindowState();
    });
    window.addEventListener('beforeunload', function () { saveWindowState(); });
    (function() {
        var handle = document.getElementById('title-bar');
        var ox, oy, dragging = false;
        handle.addEventListener('mousedown', function(e) {
            if (e.target.id === 'minimize-btn' || e.target.id === 'close-btn') return;
            dragging = true; root._wasDragged = false;
            ox = e.clientX - root.offsetLeft; oy = e.clientY - root.offsetTop;
        });
        document.addEventListener('mousemove', function(e) {
            if (dragging) { root._wasDragged = true; root.style.left = (e.clientX - ox) + 'px'; root.style.top = (e.clientY - oy) + 'px'; }
        });
        document.addEventListener('mouseup', function() {
            if (dragging) {
                dragging = false;
                if (root._wasDragged && typeof root._saveWindowState === 'function') root._saveWindowState();
            }
        });
    })();
    (function() {
        var rh = document.createElement('div'); rh.id = 'resize-handle'; root.style.overflow = 'hidden'; root.appendChild(rh);
        var sx, sy, sw, sh, resizing = false, resized = false;
        rh.addEventListener('mousedown', function(e) {
            if (root._minimized) return;
            resizing = true; resized = false;
            sx = e.clientX; sy = e.clientY; sw = root.offsetWidth; sh = root.offsetHeight;
            e.stopPropagation();
        });
        document.addEventListener('mousemove', function(e) {
            if (resizing) {
                resized = true;
                var nw = Math.max(120, sw + e.clientX - sx);
                var nh = Math.max(60,  sh + e.clientY - sy);
                root.style.width  = nw + 'px';
                root.style.height = nh + 'px';
                root._savedW = nw;
                root._savedH = nh;
            }
        });
        document.addEventListener('mouseup', function() {
            if (resizing) {
                resizing = false;
                if (resized && typeof root._saveWindowState === 'function') root._saveWindowState();
            }
        });
    })();
    loadWindowState();
    var _appState = {};

    if (window.inzoi && inzoi.saveState) {
        inzoi.saveState.register(function () {
            return Object.keys(_appState).length > 0 ? _appState : null;
        });

        inzoi.saveState.onLoad(function (json) {
            try {
                var saved = JSON.parse(json);
                for (var k in saved) {
                    if (saved.hasOwnProperty(k)) {
                        _appState[k] = saved[k];
                    }
                }
                if (typeof window._onStateLoaded === 'function') {
                    window._onStateLoaded(_appState);
                }
            } catch (e) {}
        });
    }
    window.wf = {
        root:         root,
        content:      content,
        cli:          cli,
        save:         saveWindowState,
        state:        _appState,
        MOD_ID:       MOD_ID,
        APP_NAME:     APP_NAME,
        TRIGGER_TYPE: TRIGGER_TYPE
    };
})();

