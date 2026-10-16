local M = {}
local function unhex(text)
    return (text:gsub('%x%x', function(pair) return string.char(tonumber(pair, 16)) end))
end

---@param self table
---@param owner FB2Character
---@param name string
---@param payload string
function M.on_lua_message(self, owner, name, payload)
    if name == 'Together.PositionQuery' then
        local id = owner:GetEntityId().Value
        if id <= 0 then return end
        local p = owner:GetLocation()
        self.positionSequence = (self.positionSequence or 0) + 1
        inzoi.message.send_to_client(owner:GetEntityId(), 'Together.Position', string.format('%.2f|%.2f|%.2f|%d', p.X, p.Y, p.Z, self.positionSequence))
        return
    end
    if name ~= 'Together.Phone' or type(payload) ~= 'string' then return end
    local uid, from, to, text = payload:match('^([a-f0-9]+)|(%d+)|(%d+)|([a-f0-9]+)$')
    if not uid or #uid ~= 32 or #text > 8000 or #text % 2 ~= 0 then return end
    from, to = tonumber(from), tonumber(to)
    if from <= 0 or to <= 0 or from == to then return end
    local localId = owner:GetEntityId().Value
    if localId ~= to and localId ~= from then return end
    self.delivered = self.delivered or {}
    if not self.delivered[uid] then
        local senderId = INZOI.FB1EntityId()
        senderId.Value = from
        ---@type FB2EntityManager
        local manager = inzoi.getB2Manager('FB2EntityManager')
        ---@type FB2Character
        local sender = manager:FindCharacter(senderId)
        if not sender then return end
        ---@type FB2MobileMessageComponent
        local phone = sender:GetComponent(INZOI.EB2ComponentType.MobileMessage)
        if not phone then return end
        local response = INZOI.FB1MobileMessageCustomResponse()
        response.ResponseTimeout = -1
        local receiverId = INZOI.FB1EntityId()
        receiverId.Value = to
        phone:SendCustomMessagePlainText(senderId, receiverId, unhex(text), response, '', false)
        self.delivered[uid] = true
    end
    inzoi.message.send_to_client(owner:GetEntityId(), 'Together.PhoneAck', uid)
end
return M
