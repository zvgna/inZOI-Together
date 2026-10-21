$ErrorActionPreference = 'Stop'
$plugin = 'InZOITogether_CFE6AC67'
$app = 'together_chat'
$requestFile = Join-Path $PSScriptRoot '.mcp-request.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Invoke-ModKitTool([string]$name, [hashtable]$arguments) {
    $body = @{ jsonrpc = '2.0'; id = 20; method = 'tools/call'; params = @{ name = $name; arguments = $arguments } } | ConvertTo-Json -Depth 30 -Compress
    [System.IO.File]::WriteAllText($requestFile, $body, $utf8)
    $raw = & curl.exe --max-time 20 -sS -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data-binary "@$requestFile" http://127.0.0.1:11213/mcp
    if ($LASTEXITCODE -ne 0) { throw "MCP request failed: $name" }
    $response = $raw | ConvertFrom-Json
    if ($response.error -or $response.result.isError) { throw $raw }
    Write-Output "$name : $($response.result.content.text)"
}
foreach ($filename in 'index.html', 'styles.css', 'app.js', 'interactions.js', 'connection.js', 'window.js') {
    $content = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "ui\$filename"))
    Invoke-ModKitTool 'modkit_write_uimod_file' @{ plugin = $plugin; app = $app; path = $filename; content = $content; defer_refresh = $true }
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ui\uimod_manifest.json') | ConvertFrom-Json
Invoke-ModKitTool 'modkit_write_uimod_manifest' @{ plugin = $plugin; app = $app; manifest = $manifest; defer_refresh = $true }
Invoke-ModKitTool 'modkit_refresh_uimod_workspace' @{ plugin = $plugin; app = $app }
Invoke-ModKitTool 'modkit_validate_uimod' @{ plugin = $plugin }
Invoke-ModKitTool 'modkit_save' @{ plugin = $plugin }
