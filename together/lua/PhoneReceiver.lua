local M = {}
local function setAutonomy(character, value, follow)
    local option = character.AutonomyOption
    local toggle = option.AutonomyEnable
    toggle.Value = value
    toggle.bFollowParent = follow
    option.AutonomyEnable = toggle
    character.AutonomyOption = option
    character:RefreshAutonomyOptionCache()
end
local function restoreControl(self)
    if self.controlCharacter and self.controlOriginal then
        setAutonomy(self.controlCharacter, self.controlOriginal.value, self.controlOriginal.follow)
    end
    self.controlCharacter = nil
    self.controlOriginal = nil
end

---@param self table
---@param owner FB2Character
---@param dt number
function M.on_tick(self, owner, dt)
    if not self.controlOriginal then return end
    self.controlElapsed = (self.controlElapsed or 0) + dt
    if self.controlElapsed > 12 then restoreControl(self) end
end

---@param self table
---@param owner FB2Character
function M.on_end(self, owner)
    restoreControl(self)
end
local function unhex(text)
    return (text:gsub('%x%x', function(pair) return string.char(tonumber(pair, 16)) end))
end

---@param self table
---@param owner FB2Character
---@param name string
---@param payload string
function M.on_lua_message(self, owner, name, payload)
    if name == 'Together.ControlHello' then
        if not self.controlSession then self.controlSession = string.format('%08x%08x', math.random(1, 2147483647), math.random(1, 2147483647)) end
        inzoi.message.send_to_client(owner:GetEntityId(), 'Together.ControlSession', self.controlSession)
        return
    end
    if name == 'Together.Control' and type(payload) == 'string' then
        local uid, session, target, value, follow = payload:match('^([a-f0-9]+)|([a-f0-9]+)|(%d+)|([01])|([01])$')
        if not uid or #uid ~= 32 or session ~= self.controlSession then return end
        if self.controlUid ~= uid then
            local targetId = INZOI.FB1EntityId()
            targetId.Value = tonumber(target)
            ---@type FB2EntityManager
            local manager = inzoi.getB2Manager('FB2EntityManager')
            ---@type FB2Character
            local character = manager:FindCharacter(targetId)
            if not character then return end
            if self.controlCharacter and self.controlCharacter:GetEntityId().Value ~= targetId.Value then restoreControl(self) end
            if not self.controlOriginal then
                local original = character.AutonomyOption.AutonomyEnable
                self.controlOriginal = {value = original.Value, follow = original.bFollowParent}
                self.controlCharacter = character
            end
            setAutonomy(character, value == '1', follow == '1')
            self.controlElapsed = 0
            self.controlUid = uid
        end
        inzoi.message.send_to_client(owner:GetEntityId(), 'Together.ControlAck', uid .. '|1')
        return
    end
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
