param(
    [Parameter(Mandatory=$true)][ValidateSet('Host','Guest')][string]$Mode,
    [string]$Server = '', [string]$Code = '',
    [string]$Folder = '', [string]$File = '', [long]$CharacterId = 0, [string]$SessionToken = '',
    [string]$SaveRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'inZOI\SaveGames'),
    [string]$GameEndpoint = 'http://127.0.0.1:11212/mcp'
)
$ErrorActionPreference = 'Stop'
$plugin = 'InZOITogether_CFE6AC67'
function Game([string]$name,[hashtable]$arguments) {
    $request = @{jsonrpc='2.0';id=1;method='tools/call';params=@{name=$name;arguments=$arguments}} | ConvertTo-Json -Depth 25 -Compress
    $reply = Invoke-RestMethod -Uri $GameEndpoint -Method Post -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 30
    if ($reply.error -or $reply.result.isError) { throw ($reply | ConvertTo-Json -Depth 10 -Compress) }
    if ($reply.result.structuredContent) { return $reply.result.structuredContent }
    $text = ($reply.result.content | Where-Object type -eq 'text' | ForEach-Object text) -join "`n"
    $start = $text.IndexOf("`n[")
    if ($start -ge 0) { $text = $text.Substring($start+1) }
    try { return ($text | ConvertFrom-Json) } catch { return $text }
}
function Load-Slot([string]$slotFolder,[string]$slotFile) {
    Game 'game_load' @{Folder=$slotFolder;File=$slotFile} | Out-Null
    Start-Sleep -Seconds 2
    $deadline=[DateTime]::UtcNow.AddMinutes(5)
    do {
        $state=Game 'game_get_state' @{}
        if ($state.phase -eq 'in_game' -and -not $state.loading) { return $state }
        Start-Sleep -Seconds 2
    } while([DateTime]::UtcNow -lt $deadline)
    throw 'Save load timed out; no second load request was issued.'
}
function Relay([string]$route,[object]$data=$null) {
    $headers=@{Authorization='Bearer '+$script:roomToken}
    if ($null -eq $data) { return Invoke-RestMethod -Uri ($Server+$route) -Headers $headers -TimeoutSec 30 }
    return Invoke-RestMethod -Uri ($Server+$route) -Method Post -Headers $headers -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($data|ConvertTo-Json -Compress))) -TimeoutSec 30
}
if ((Game 'game_get_state' @{}).phase -ne 'lobby') { throw 'Return to the main menu first. The current game was not replaced.' }
if ($Mode -eq 'Host') {
    $saves=@(); $offset=0
    do {
        $page=@(Game 'game_list_saves' @{Limit=100;Offset=$offset;include_autosave=$false;include_broken=$false})
        $saves += @($page | Where-Object {-not $_.is_broken -and -not $_.is_higher_version})
        $offset += $page.Count
    } while($page.Count -eq 100)
    if (-not $Folder) {
        for($i=0;$i -lt $saves.Count;$i++){ Write-Host "$i : $($saves[$i].slot) [$($saves[$i].saved_time)]" }
        $choice=0
        if (-not [int]::TryParse((Read-Host 'Save number'),[ref]$choice) -or $choice -lt 0 -or $choice -ge $saves.Count) { throw 'Invalid save selection' }
        $Folder=$saves[$choice].folder; $File=$saves[$choice].file
    }
    $selected=$saves | Where-Object {$_.folder -eq $Folder -and $_.file -eq $File} | Select-Object -First 1
    if (-not $selected) { throw 'Selected save is unavailable or incompatible with this game version' }
    $state=Load-Slot $Folder $File
    $characters=@(); $offset=0
    do {
        $page=Game 'world_list_characters' @{Limit=100;Offset=$offset;group_type='ResidenceFamily';alive_only=$true}
        $characters += @($page.characters | ForEach-Object { @{id=[long]$_.entity_id;household=[long]$_.household_id;name=($_.first_name+' '+$_.last_name)} })
        $offset += $page.characters.Count
    } while($offset -lt $page.total -and $page.characters.Count -gt 0)
    if (@($characters.household | Select-Object -Unique).Count -lt 2) { throw 'This save has fewer than two playable families' }
    $sessionDir=Join-Path $PSScriptRoot ('sessions\'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
    $metadata=Join-Path $sessionDir 'metadata.json'
    @{title=$selected.slot;map=$state.map_id;gameVersion=$selected.game_version;characters=$characters;requiredMods=@()} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $metadata -Encoding UTF8
    & (Join-Path $PSScriptRoot 'prepare-save.ps1') -SaveRoot $SaveRoot -Folder $Folder -File $File -Metadata $metadata -ShareRoot $sessionDir | Out-Null
    $pidFile=Join-Path $PSScriptRoot 'server.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $oldPid=[int](Get-Content -LiteralPath $pidFile)
        $old=Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid"
        $expected=Join-Path $PSScriptRoot 'server.cjs'
        if ($old -and $old.Name -eq 'node.exe' -and $old.CommandLine.Contains($expected)) { Stop-Process -Id $oldPid }
    }
    $Code=[guid]::NewGuid().ToString('N').Substring(0,16)
    $env:TOGETHER_CODE=$Code; $env:TOGETHER_SHARE_DIR=$sessionDir
    $node=Join-Path $PSScriptRoot 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node=(Get-Command node -ErrorAction Stop).Source }
    $process=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $PSScriptRoot 'server.cjs')+'"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $sessionDir 'server.log') -RedirectStandardError (Join-Path $sessionDir 'error.log')
    $process.Id | Set-Content -LiteralPath $pidFile
    $Server='http://127.0.0.1:11214'; $slot=1
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) { throw 'Room server could not start. Port 11214 may already be occupied; see error.log.' }
    Write-Host "Room code: $Code"
} else {
    if (-not $Server) { $Server=Read-Host 'Host URL (http://IP:11214)' }
    if (-not $Code -and -not $SessionToken) { $Code=Read-Host 'Room code' }
    $Server=$Server.TrimEnd('/')
    if ($Server -notmatch '^http://[a-zA-Z0-9.\-]+:\d+$') { throw 'Invalid host URL' }
    $script:roomToken=''
    try {
        if ($SessionToken) { $script:roomToken=$SessionToken }
        else { $joined=Relay '/join' @{slot=2;name='Guest';code=$Code}; $script:roomToken=$joined.token }
        $room=Relay '/room'
        if (-not $Code) { $Code=$room.code }
        if (-not $Code) { throw 'Room server did not return a reconnect code' }
        if (-not $room.save -or -not $room.save.characters -or $room.save.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Host has not prepared a universal room snapshot' }
        $characters=@($room.save.characters)
        if (-not $CharacterId) {
            for($i=0;$i -lt $characters.Count;$i++){ Write-Host "$i : $($characters[$i].name) [family $($characters[$i].household)]" }
            $choice=0
            if (-not [int]::TryParse((Read-Host 'Character number'),[ref]$choice) -or $choice -lt 0 -or $choice -ge $characters.Count) { throw 'Invalid character selection' }
            $CharacterId=[long]$characters[$choice].id
        }
        $chosen=$characters | Where-Object id -eq $CharacterId | Select-Object -First 1
        if (-not $chosen) { throw 'Character is absent from the host snapshot' }
        $ticket=Relay '/room/save-ticket' @{}
        if ($ticket.path -notmatch '^/download/[a-f0-9]{48}$') { throw 'Invalid download ticket' }
        Relay '/leave' @{} | Out-Null
        $script:roomToken=''
        $archive=Join-Path ([IO.Path]::GetTempPath()) ('together-'+[guid]::NewGuid().ToString('N')+'.zip')
        Invoke-WebRequest -UseBasicParsing -Uri ($Server+$ticket.path) -OutFile $archive -TimeoutSec 600
        $Folder=Get-Date -Format 'yyyyMMdd-HHmmss'
        & (Join-Path $PSScriptRoot 'install-save.ps1') -Archive $archive -ExpectedSha256 $room.save.sha256 -SaveRoot $SaveRoot -DestinationFolder $Folder | Out-Null
        $File=$room.save.file
        if ($File -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid save filename' }
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $SaveRoot $Folder) ($File+'.usvx')))) { throw 'Save file missing from installed snapshot' }
    } finally { if ($script:roomToken) { Relay '/leave' @{} | Out-Null } }
    $state=Load-Slot $Folder $File
    if ($state.map_id -ne $room.save.map) { throw 'Loaded map differs from the host snapshot' }
    Game 'character_possess' @{character_id=[string]$CharacterId;household_id=[string]$chosen.household} | Out-Null
    $slot=2
}
$bootstrap=@{server=$Server;code=$Code;slot=$slot;name=$(if($slot -eq 1){'Host'}else{'Guest'})}|ConvertTo-Json -Compress
Game 'uimod_cfg_save' @{mod_id=$plugin;Section='bridge';Key='bootstrap';Value=$bootstrap} | Out-Null
try { Game 'uimod_remount' @{mod_id=$plugin} | Out-Null }
catch {
    try { Game 'uimod_mount' @{mod_id=$plugin} | Out-Null }
    catch { Game 'uimod_mount' @{mod_id=('ModKitPreview/'+$plugin)} | Out-Null }
}
Write-Host 'Save loaded. Press F2 to finish joining the room.'
