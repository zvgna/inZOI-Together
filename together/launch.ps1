$ErrorActionPreference = 'Stop'
$launcherMutex = New-Object Threading.Mutex($false, 'Local\InZOITogetherLauncher')
$locked = $false
$helperProcess = $null
$trackedGame = $null
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
function Stop-OwnedServer {
    $pidFile = Join-Path $PSScriptRoot 'server.pid'
    if (-not (Test-Path -LiteralPath $pidFile)) { return }
    $serverId = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$serverId)) { return }
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId" -ErrorAction SilentlyContinue
    $expected = Join-Path $PSScriptRoot 'server.cjs'
    if ($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -and $candidate.CommandLine.Contains($expected)) {
        Stop-Process -Id $serverId -ErrorAction SilentlyContinue
    }
}
try {
    $locked = $launcherMutex.WaitOne(0)
    if (-not $locked) { exit }
    if (Get-NetTCPConnection -State Listen -LocalPort 11215 -ErrorAction SilentlyContinue) {
        throw 'Together helper is already running. Close the old helper window, then run Play-Together again.'
    }
    $node = Join-Path $PSScriptRoot 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) { throw 'Bundled node.exe is missing.' }
    $trackedGame = Get-Process -Name 'inZOI-Win64-Shipping' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $trackedGame) {
        Start-Process -FilePath 'steam://rungameid/2456740' -WindowStyle Hidden | Out-Null
        $deadline = [DateTime]::UtcNow.AddMinutes(3)
        do {
            Start-Sleep -Seconds 1
            $trackedGame = Get-Process -Name 'inZOI-Win64-Shipping' -ErrorAction SilentlyContinue | Select-Object -First 1
        } while (-not $trackedGame -and [DateTime]::UtcNow -lt $deadline)
    }
    if (-not $trackedGame) { throw 'inZOI did not start within three minutes.' }
    $childEnvironment = $env:TOGETHER_GAME_PID
    $env:TOGETHER_GAME_PID = [string]$trackedGame.Id
    try {
        $helperProcess = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $PSScriptRoot 'companion.cjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'helper.log') -RedirectStandardError (Join-Path $runtime 'helper-error.log')
    } finally { $env:TOGETHER_GAME_PID = $childEnvironment }
    while (-not $trackedGame.HasExited) {
        if ($helperProcess.HasExited) { throw 'Together helper stopped. See runtime/helper-error.log.' }
        Start-Sleep -Seconds 2
        $trackedGame.Refresh()
        $helperProcess.Refresh()
    }
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $runtime 'launcher-error.log')
    $popup = New-Object -ComObject WScript.Shell
    $popup.Popup($_.Exception.Message, 0, 'inZOI Together', 16) | Out-Null
} finally {
    if ($helperProcess) {
        $helperProcess.Refresh()
        if (-not $helperProcess.HasExited) {
            & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $helperProcess.Id /T /F | Out-Null
            $helperProcess.WaitForExit()
        }
        Stop-OwnedServer
    }
    if ($locked) { $launcherMutex.ReleaseMutex() }
    $launcherMutex.Dispose()
}
