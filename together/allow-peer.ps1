param([Parameter(Mandatory=$true)][string]$PeerAddress,[string]$InterfaceAlias='')
$ErrorActionPreference='Stop'
$address=$null
if(-not [Net.IPAddress]::TryParse($PeerAddress,[ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or [Net.IPAddress]::IsLoopback($address) -or $PeerAddress -eq '0.0.0.0'){throw 'Enter the VPN IPv4 address of the guest PC'}
if(-not $InterfaceAlias){
    $adapters=@(Get-NetAdapter | Where-Object {($_.Name+' '+$_.InterfaceDescription) -match 'Radmin|Hamachi'})
    if($adapters.Count -ne 1){throw 'Specify the VPN adapter with -InterfaceAlias'}
    $InterfaceAlias=$adapters[0].Name
}
Get-NetAdapter -Name $InterfaceAlias -ErrorAction Stop | Out-Null
$node=Join-Path $PSScriptRoot 'node.exe'
if(-not(Test-Path -LiteralPath $node)){$node=(Get-Command node -ErrorAction Stop).Source}
$name='InZOITogether-11214-'+($PeerAddress -replace '\.','-')
if(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue){Write-Output 'Rule already exists';return}
New-NetFirewallRule -Name $name -DisplayName ('inZOI Together - '+$PeerAddress) -Direction Inbound -Action Allow -Protocol TCP -LocalPort 11214 -RemoteAddress $PeerAddress -InterfaceAlias $InterfaceAlias -Program $node -Profile Any | Out-Null
Write-Output 'Access granted to this peer on the VPN adapter, TCP 11214.'
