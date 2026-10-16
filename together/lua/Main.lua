-- Bootstrap diagnostic only. No character control or networking is enabled here.
local M = {}
local function mark(value)
    pcall(function()
        inzoi.cli.execute('uimod.cfg_save mod_id=InZOITogether_CFE6AC67 section=probe key=boot value=' .. value)
    end)
end
mark('module_loaded')
function M.on_begin()
    mark('simulation_started')
end
return M
