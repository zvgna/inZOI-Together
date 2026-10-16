$ErrorActionPreference = 'Stop'
$runtime = Get-Command node -ErrorAction SilentlyContinue
if ($runtime) {
    $nodePath = $runtime.Source
} else {
    $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) {
    throw 'Node.js не найден. Установите Node.js на ПК, который запускает сервер.'
}
& $nodePath (Join-Path $PSScriptRoot 'server.cjs')
