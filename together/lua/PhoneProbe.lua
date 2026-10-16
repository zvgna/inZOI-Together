-- One-shot integration probe for the two characters in the agreed test save.
-- This is not a network transport and does not hook unrelated phone messages.
local M = {}

---@param self table
---@param owner FB2Character
function M.on_begin(self, owner)
    if owner:GetEntityId().Value ~= 24676 then return end
    local ok, reason = pcall(function()
        ---@type FB2MobileMessageComponent
        local phone = owner:GetComponent(INZOI.EB2ComponentType.MobileMessage)
        if not phone then error('MobileMessage component is unavailable') end
        local receiver = INZOI.FB1EntityId()
        receiver.Value = 24534
        local response = INZOI.FB1MobileMessageCustomResponse()
        response.ResponseTimeout = -1
        phone:SendCustomMessagePlainText(
            owner:GetEntityId(), receiver,
            'inZOI Together: Привет, Тиана! Это проверка сообщения от Алисии в игровом телефоне.',
            response, '', false)
    end)
    self.phoneProbeOk = ok
    self.phoneProbeError = ok and '' or tostring(reason)
    pcall(function()
        inzoi.cli.execute('uimod.cfg_save mod_id=InZOITogether_CFE6AC67 section=probe key=phone value=' .. (ok and 'sent' or 'failed'))
    end)
    print('[Together.PhoneProbe] ' .. (ok and 'sent' or tostring(reason)))
end

return M
