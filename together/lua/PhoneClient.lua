local M = {}
local prefix = 'uimod.cfg_save mod_id=InZOITogether_CFE6AC67 Section=bridge '
local function save(key, value)
    return inzoi.cli.execute(prefix .. 'Key=' .. key .. ' Value=' .. value)
end

---@param self table
---@param owner AB1Character
function M.on_begin(self, owner)
    self.elapsed = 0
    local id = owner:GetEntityId().Value
    if id > 0 then
        save('client' .. id, 'ready')
        inzoi.message.send_to_sim(owner:GetEntityId(), 'Together.ControlHello', '')
        self.elapsed = 2
        M.on_tick(self, owner, 0)
    end
end

---@param self table
---@param owner AB1Character
---@param dt number
function M.on_tick(self, owner, dt)
    local id = owner:GetEntityId().Value
    self.elapsed = (self.elapsed or 0) + dt
    if self.elapsed < 2 then return end
    self.elapsed = 0
    local selected, selectedMessage, selectedData = inzoi.cli.execute('uimod.cfg_load mod_id=InZOITogether_CFE6AC67 Section=bridge Key=local_character')
    if not selected or not tostring(selectedData or selectedMessage):match('"value"%s*:%s*"' .. id .. '"') then return end
    inzoi.message.send_to_sim(owner:GetEntityId(), 'Together.ControlHello', '')
    local controlOk, controlMessage, controlData = inzoi.cli.execute('uimod.cfg_load mod_id=InZOITogether_CFE6AC67 Section=bridge Key=control_request')
    if controlOk then
        local request = tostring(controlData or controlMessage):match('"value"%s*:%s*"([a-f0-9|]+)"')
        if request then inzoi.message.send_to_sim(owner:GetEntityId(), 'Together.Control', request) end
    end
    inzoi.message.send_to_sim(owner:GetEntityId(), 'Together.PositionQuery', '')
    local ok, message, data = inzoi.cli.execute('uimod.cfg_load mod_id=InZOITogether_CFE6AC67 Section=bridge Key=inbox' .. id)
    if not ok then return end
    data = data or message
    if not data then return end
    local payload = data:match('"value"%s*:%s*"([%w|%-]+)"')
    if not payload then return end
    local uid = payload:match('^([a-f0-9]+)|')
    if not uid then return end
    local acknowledged, ackMessage, ackData = inzoi.cli.execute('uimod.cfg_load mod_id=InZOITogether_CFE6AC67 Section=bridge Key=ack_' .. uid)
    if acknowledged and tostring(ackData or ackMessage):match('"value"%s*:%s*"1"') then return end
    inzoi.message.send_to_sim(owner:GetEntityId(), 'Together.Phone', payload)
    save('forward' .. id, 'sent')
end

---@param self table
---@param owner AB1Character
---@param name string
---@param payload string
function M.on_lua_message(self, owner, name, payload)
    if name == 'Together.ControlSession' and type(payload) == 'string' and payload:match('^[a-f0-9]+$') then
        save('control_session' .. owner:GetEntityId().Value, payload)
        return
    end
    if name == 'Together.ControlAck' and type(payload) == 'string' and payload:match('^[a-f0-9|]+$') then
        save('control_ack', payload)
        return
    end
    if name == 'Together.Position' and type(payload) == 'string' and payload:match('^[%d%.|%-]+$') then
        save('position' .. owner:GetEntityId().Value, payload)
        return
    end
    if name == 'Together.PhoneAck' and type(payload) == 'string' and payload:match('^[a-f0-9]+$') then
        save('ack_' .. payload, '1')
        save('last_ack', payload)
    end
end
return M
