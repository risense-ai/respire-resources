param([string]$Node, [hashtable]$Common, [string]$V4Name, [string]$V6Name)
$ErrorActionPreference = 'Stop'
$cli = Join-Path $PSScriptRoot 'verify-netsecurity-addresses.mjs'
$json = & $Node $cli --request
if ($LASTEXITCODE -ne 0) { throw 'Address construction failed' }
$blocks = $json | ConvertFrom-Json
New-NetFirewallRule @Common -Name $V4Name -DisplayName $V4Name -RemoteAddress ([string[]]$blocks.ipv4) | Out-Null
New-NetFirewallRule @Common -Name $V6Name -DisplayName $V6Name -RemoteAddress ([string[]]$blocks.ipv6) | Out-Null
