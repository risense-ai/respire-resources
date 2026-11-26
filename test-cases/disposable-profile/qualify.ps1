param([switch]$RuntimeCases)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if ($env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_ARCH -ne 'X64' -or $env:GITHUB_RUN_ATTEMPT -ne '1') { throw 'Unsupported qualification runner' }
$controls = (Resolve-Path controls/test-cases/plugin-rpc/disposable).Path
$stage = Join-Path $env:RUNNER_TEMP ('profile-qualification-' + $env:GITHUB_RUN_ID)
[void](New-Item -ItemType Directory -Path $stage)
$testExe = if ($RuntimeCases) { (Resolve-Path staged/rsrs-runtime.exe).Path } else { (Resolve-Path staged/host.test.exe).Path }
$runner = (Resolve-Path test-cases/runner.mjs).Path
$manifest = (Resolve-Path staged/manifest.json).Path
if ((Get-FileHash $manifest).Hash.ToLowerInvariant() -cne $env:MANIFEST_SHA) { throw 'Invalid preparation manifest' }
$m = Get-Content -Raw $manifest | ConvertFrom-Json
if ($m.product -cne 'd7db37e6f44ff13205642bd65c8b5af000f35a34' -or $m.run -cne '45765454095' -or (Get-FileHash $testExe).Hash.ToLowerInvariant() -cne $m.exe) { throw 'Invalid test binary binding' }
$node = (Get-Command node.exe -CommandType Application).Source
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$icacls = Join-Path $env:SystemRoot 'System32/icacls.exe'
$conhost = Join-Path $env:SystemRoot 'System32/conhost.exe'
if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'No effective Windows firewall' }
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
if ($profiles.Count -ne 3) { throw 'Missing firewall profiles' }
foreach ($profile in $profiles) {
  if ([string]$profile.Enabled -ne 'True' -or [string]$profile.AllowLocalFirewallRules -eq 'False') {
    throw 'Unavailable outbound firewall policy'
  }
}
Add-Type -Path (Join-Path $controls 'card018-owned-job.cs')
$programs = @($testExe, $node, $powershell, $icacls, $conhost)
$group = 'CARD018-real-offline-' + [guid]::NewGuid().ToString('N')
$names = @()
$installed = @()
function ConfirmRule([string]$name,[string]$program) {
  $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $name)
  if ($rules.Count -ne 1) { throw 'Unexpected effective rule count' }
  $rule = $rules[0]
  $a = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule
  $p = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
  $app = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
  if ([string]$rule.Enabled -ne 'True' -or [string]$rule.Direction -ne 'Outbound' -or
      [string]$rule.Action -ne 'Block' -or [string]$rule.Profile -ne 'Any' -or
      [string]$a.LocalAddress -ne 'Any' -or $app.Program -ine $program -or
      [string]$p.Protocol -ne 'Any' -or [string]$p.LocalPort -ne 'Any' -or
      [string]$p.RemotePort -ne 'Any') { throw 'Unexpected effective rule scope' }
  $a.RemoteAddress
}
function ConfirmProgram([string]$program,[string]$ipv4,[string]$ipv6) {
  @{ipv4=@(ConfirmRule $ipv4 $program); ipv6=@(ConfirmRule $ipv6 $program)} |
    ConvertTo-Json -Compress | & $node (Join-Path $controls 'verify-netsecurity-addresses.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Canonical policy coverage mismatch' }
}
try {
  for ($i=0;$i -lt $programs.Count;$i++) {
    $n4 = "$group-$i-v4"; $n6 = "$group-$i-v6"
    $names += @($n4,$n6)
    $common = @{Group=$group; PolicyStore='PersistentStore'; Direction='Outbound';
      Action='Block'; Enabled='True'; Profile='Any'; Protocol='Any'; Program=$programs[$i]}
    & (Join-Path $controls 'install-address-blocks.ps1') $node $common $n4 $n6
    ConfirmProgram $programs[$i] $n4 $n6
    $installed += @{Program=$programs[$i];V4=$n4;V6=$n6}
  }
  # Inherit only the minimum test process state, never runner tokens or home.
  # The GitHub work volume has a shared root ACL. Use a new owned directory
  # on the Windows system volume; never rewrite an existing ancestor ACL.
  $testTemp = Join-Path ([IO.Path]::GetPathRoot($env:SystemRoot)) ('card018-synthetic-' + [guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $testTemp)
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($owner)
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  Set-Acl -LiteralPath $testTemp -AclObject $acl
  $keep = @('SystemRoot','windir','SystemDrive','ComSpec','OS','PROCESSOR_ARCHITECTURE',
    'GITHUB_ACTIONS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','RUNNER_ENVIRONMENT','CARD018_FROZEN_HEAD')
  foreach ($item in @(Get-ChildItem Env:)) {
    if ($item.Name -notin $keep) { Remove-Item -LiteralPath ("Env:" + $item.Name) }
  }
  foreach ($key in @('TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA')) {
    Set-Item -LiteralPath ("Env:" + $key) -Value $testTemp
  }
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  if ((Get-Volume -FilePath $testTemp).FileSystem -ine 'NTFS') { throw 'NTFS required' }
  $cases = @('TestNewBindsConfiguredJunctionToPhysicalProfile','TestNewRefusesMissingProfileBelowOwnedJunction','TestNewRefusesJunctionAsProfileLeaf','TestRequestLedgerRefusesReplacedClientDirectory','TestReplacedProfileStopsServingAndModelControls')
  $allowed = [string[]]@($testExe,$powershell,$icacls,$conhost)
  if ($RuntimeCases) {
    $log = Join-Path $stage 'compiled-scenarios.log'
    $allowed = [string[]]@($node,$testExe,$powershell,$conhost)
    $code = [Card018OwnedJob]::Run($node,[string[]]@($runner,'--runtime-bin',$testExe,'--synthetic-ready'),$testTemp,$log,$allowed,420000)
    if ((Get-Item $log).Length -gt 65536) {throw 'Unexpected scenario log size'}
    $lines = @(Get-Content -LiteralPath $log)
    $lines | Where-Object { $_ -cmatch '^(PASS|FAIL|SKIP) COMPILED (RUNTIME|LEGACY RPC|CLI) E2E-00[1-7] |^SUMMARY ' } | ForEach-Object { Write-Output ($_.Replace($testTemp,'<fixture>')) }
    foreach ($case in 'E2E-001','E2E-005') {
      if (@($lines | Where-Object { $_ -cmatch ('^PASS COMPILED RUNTIME '+$case+' ') }).Count -ne 1) { throw ('Missing compiled scenario '+$case) }
    }
    if ($code -ne 0) { throw ('Compiled runner reported failure: '+$code) }
  } else {
  foreach ($case in $cases) {
    $log = Join-Path $stage ($case + '.log')
    $code = [Card018OwnedJob]::Run($testExe,[string[]]@('-test.v',('-test.run=^'+$case+'$'),'-test.count=1','-test.timeout=90s'),$testTemp,$log,$allowed,120000)
    if ((Get-Item $log).Length -gt 32768) { throw 'Unexpected log volume' }
    $lines = @(Get-Content -LiteralPath $log)
    if ($code -ne 0 -or @($lines | Where-Object { $_ -cmatch ('^--- PASS: '+$case+' ') }).Count -ne 1) {
      $diagnostic = @($lines | Where-Object { $_ -match 'profile_admission.*_test.go:[0-9]+:' } | ForEach-Object { $_.Replace($testTemp,'<fixture>') } | Select-Object -First 4)
      throw ('Native case did not pass: '+$case+' exit='+$code+' '+($diagnostic -join ' '))
    }
    Write-Output ('PASS exact Windows NTFS case '+$case)
  }
  }
  foreach ($entry in $installed) { ConfirmProgram $entry.Program $entry.V4 $entry.V6 }
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
  if ($testTemp -and [IO.Directory]::Exists($testTemp)) {
    # Nonrecursive cleanup will fail if the tests leaked any fixture.
    [IO.Directory]::Delete($testTemp, $false)
  }
}
