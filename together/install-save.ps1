param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [string]$SaveRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'inZOI\SaveGames'),
    [string]$DestinationFolder = ''
)
$ErrorActionPreference = 'Stop'
$actualHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
if ($actualHash -ine $ExpectedSha256) { throw 'Checksum mismatch: the downloaded save does not match the room.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
try {
    $folder = $null
    $totalBytes = 0
    if ($zip.Entries.Count -gt 100000) { throw 'Archive has too many entries' }
    foreach ($entry in $zip.Entries) {
        $totalBytes += $entry.Length
        if ($totalBytes -gt 4GB) { throw 'Archive exceeds installation size limit' }
        $segments = ($entry.FullName -replace '\\','/').Split('/')
        if ($segments -contains '..' -or $entry.FullName.StartsWith('/') -or $entry.FullName.Contains(':')) { throw 'Unsafe archive path' }
        if ($segments[0] -notmatch '^\d{8}-\d{6}$') { throw 'Unexpected save folder' }
        if (-not $folder) { $folder = $segments[0] }
        if ($segments[0] -ne $folder) { throw 'Archive contains more than one save folder' }
    }
    if (-not $folder) { throw 'Empty archive' }
    if ($DestinationFolder -and $DestinationFolder -notmatch '^\d{8}-\d{6}$') { throw 'Invalid destination save folder' }
    $target = Join-Path $SaveRoot $(if($DestinationFolder){$DestinationFolder}else{$folder})
    if (Test-Path -LiteralPath $target) { throw 'This save already exists. Nothing was overwritten.' }
    New-Item -ItemType Directory -Path $SaveRoot -Force | Out-Null
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('together-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToDirectory($zip, $stage)
    Move-Item -LiteralPath (Join-Path $stage $folder) -Destination $target
    Remove-Item -LiteralPath $stage
    Write-Output "Installed new save: $target"
} finally { $zip.Dispose() }
