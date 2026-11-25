$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or
    $env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:CARD018_FROZEN_HEAD -cnotmatch '^[a-f0-9]{40}$') {
  throw 'Not a first-attempt disposable Windows runner'
}
if ((git rev-parse HEAD) -cne $env:CARD018_FROZEN_HEAD) { throw 'Wrong reviewed source' }
if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'Firewall service unavailable' }
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
if ($profiles.Count -ne 3) { throw 'Missing firewall profiles' }
foreach ($profile in $profiles) {
  if ([string]$profile.Enabled -ne 'True' -or [string]$profile.AllowLocalFirewallRules -eq 'False') {
    throw 'Runner policy cannot apply local blocks'
  }
}
$node = (Get-Command node.exe -CommandType Application).Source
$nodeFile = Get-Item -LiteralPath $node
if ($nodeFile.PSIsContainer -or ($nodeFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Unexpected runner Node image'
}
$group = 'CARD018-netsecurity-preflight-' + [guid]::NewGuid().ToString('N')
$names = @("$group-v4", "$group-v6")
function ConfirmRule([string]$name) {
  $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $name)
  if ($rules.Count -ne 1) { throw 'Unexpected effective rule count' }
  $rule = $rules[0]
  $a = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule
  $p = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
  $app = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
  if ([string]$rule.Enabled -ne 'True' -or [string]$rule.Direction -ne 'Outbound' -or
      [string]$rule.Action -ne 'Block' -or [string]$rule.Profile -ne 'Any' -or
      [string]$a.LocalAddress -ne 'Any' -or $app.Program -ine $node -or
      [string]$p.Protocol -ne 'Any' -or [string]$p.LocalPort -ne 'Any' -or
      [string]$p.RemotePort -ne 'Any') { throw 'Unexpected effective rule scope' }
  $a.RemoteAddress
}
try {
  $v4 = @('0.0.0.1-127.0.0.0','127.0.0.2-255.255.255.255')
  $v6 = @('::/1','8000::/1')
  $common = @{Group=$group; PolicyStore='PersistentStore'; Direction='Outbound';
    Action='Block'; Enabled='True'; Profile='Any'; Protocol='Any'; Program=$node}
  New-NetFirewallRule @common -Name $names[0] -DisplayName $names[0] -RemoteAddress $v4 | Out-Null
  New-NetFirewallRule @common -Name $names[1] -DisplayName $names[1] -RemoteAddress $v6 | Out-Null
  @{ipv4=@(ConfirmRule $names[0]); ipv6=@(ConfirmRule $names[1])} |
    ConvertTo-Json -Compress | & $node (Join-Path $PSScriptRoot 'verify-netsecurity-addresses.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Canonical policy coverage mismatch' }
  'PASS separate IPv4/IPv6 block scope and canonical ActiveStore coverage'
} finally {
  foreach ($name in $names) {
    $created = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $name -ErrorAction SilentlyContinue)
    foreach ($rule in $created) { Remove-NetFirewallRule -InputObject $rule }
  }
  foreach ($name in $names) {
    if (@(Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction SilentlyContinue).Count) {
      throw 'Disposable rules still active'
    }
  }
  'PASS exact disposable rule cleanup'
}
