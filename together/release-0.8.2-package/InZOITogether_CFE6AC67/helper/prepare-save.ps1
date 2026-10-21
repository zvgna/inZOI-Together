param(
    [string]$SaveRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'inZOI\SaveGames'),
    [Parameter(Mandatory=$true)][string]$Folder,
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][string]$Metadata,
    [string]$ShareRoot = (Join-Path $PSScriptRoot 'share')
)
$ErrorActionPreference = 'Stop'
if ($Folder -notmatch '^[A-Za-z0-9_-]+$' -or $File -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid save identifier' }
$saveSource = Join-Path $SaveRoot $Folder
$saveFile = Join-Path $saveSource "$File.usvx"
$saveAssets = Join-Path $saveSource $File
if (-not (Test-Path -LiteralPath $saveFile -PathType Leaf)) { throw "Save not found: $saveFile" }
$details = Get-Content -LiteralPath $Metadata -Raw | ConvertFrom-Json
if (-not $details.map -or -not $details.characters -or -not $details.gameVersion) { throw 'Incomplete room metadata' }
if (Test-Path -LiteralPath (Join-Path $shareRoot 'room-save.zip')) { throw 'A snapshot already exists. Keep it immutable for this room.' }
$stageRoot = Join-Path $shareRoot 'staging'
$stageSave = Join-Path $stageRoot $Folder
New-Item -ItemType Directory -Path $stageSave -Force | Out-Null
Copy-Item -LiteralPath $saveFile -Destination $stageSave
if (Test-Path -LiteralPath $saveAssets -PathType Container) { Copy-Item -LiteralPath $saveAssets -Destination $stageSave -Recurse }
$zipPath = Join-Path $shareRoot 'room-save.zip'
Compress-Archive -LiteralPath $stageSave -DestinationPath $zipPath
$zip = Get-Item -LiteralPath $zipPath
$info = [ordered]@{
    title = $details.title
    folder = $Folder
    file = $File
    gameVersion = $details.gameVersion
    map = $details.map
    characters = $details.characters
    requiredMods = $details.requiredMods
    sourceSavedAt = (Get-Item -LiteralPath $saveFile).LastWriteTimeUtc.ToString('o')
    preparedAt = [DateTime]::UtcNow.ToString('o')
    bytes = $zip.Length
    sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $shareRoot 'save-info.json'), ($info | ConvertTo-Json -Depth 6), $utf8)
$info | ConvertTo-Json -Depth 6
