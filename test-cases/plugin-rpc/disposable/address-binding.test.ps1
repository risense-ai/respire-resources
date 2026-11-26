$ErrorActionPreference = 'Stop'
$node = (Get-Command node -CommandType Application).Source
$capture = @{}
function New-NetFirewallRule([string]$Name, [string]$DisplayName, [string[]]$RemoteAddress) {
  $capture[$Name] = $RemoteAddress
}
& (Join-Path $PSScriptRoot 'install-address-blocks.ps1') $node @{} ipv4 ipv6
if (($capture.ipv4 -join ',') -cne '0.0.0.1-127.0.0.0,127.0.0.2-255.255.255.255' -or
    ($capture.ipv6 -join ',') -cne '::/1,8000::/1') { throw 'Wrong NetSecurity input' }
function Check([string[]]$v4, [string[]]$v6, [bool]$expected) {
  @{ipv4=$v4; ipv6=$v6} | ConvertTo-Json -Compress |
    & $node (Join-Path $PSScriptRoot 'verify-netsecurity-addresses.mjs') 2>$null
  if (($LASTEXITCODE -eq 0) -ne $expected) { throw 'Unexpected effective coverage verdict' }
}
Check $capture.ipv4 $capture.ipv6 $true
Check @('0.0.0.2-127.0.0.0',$capture.ipv4[1]) $capture.ipv6 $false
Check @('0.0.0.1-8.8.8.7','8.8.8.9-127.0.0.0',$capture.ipv4[1]) $capture.ipv6 $false
Check ($capture.ipv4 + '127.0.0.1') $capture.ipv6 $false
Check $capture.ipv4 @('::/1') $false
'PASS PowerShell rule arguments and four rejected coverage mutations'
