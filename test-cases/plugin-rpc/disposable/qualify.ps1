$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$fixtureSha = '1dc3b179f484c95a787f82ae5299fd562bc47f6a'
$product = '4da41a593ea1663a8199b4b9a1475eb05b8620a8'
$buildRun = '45739629656'
$bundleSHA = '44357fd5949f7214d1a5c36a0f44744d76d03858ebca6f0f3fb6d59d87712cc7'
$manifestSHA = '716a37284faee842b87ac369cf238710a05188bf4b0ccedc1309ee2814644e0c'
$browserSHA = '153106834fb06976c587c39aaef0e8c0d1b1339a575e8d7b87f187058663a094'
$head = $env:CARD018_FROZEN_HEAD
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or
    $env:GITHUB_RUN_ATTEMPT -cne '1' -or $head -cnotmatch '^[a-f0-9]{40}$' -or
    $bundleSHA -cnotmatch '^[a-f0-9]{64}$' -or $manifestSHA -cnotmatch '^[a-f0-9]{64}$') { throw 'Missing exact reviewed qualification pins' }
$node = (Get-Command node.exe -CommandType Application).Source
if ((git rev-parse HEAD) -cne $head) { throw 'Wrong proof checkout' }
$file = Join-Path $PSScriptRoot '../host-config-junction.mjs'
$stage = Join-Path $env:RUNNER_TEMP ('card018-qualification-' + $env:GITHUB_RUN_ID)
if (Test-Path -LiteralPath $stage) { throw 'Stage already exists' }
[void](New-Item -ItemType Directory -Path $stage)
$kit = Join-Path $stage 'kit'
$bundle = Join-Path $env:RUNNER_TEMP 'card018-kit-transfer/offline-kit.zip'
$receipt = Join-Path $stage 'receipt.json'
function Pin([string]$path) {
  $f = Get-Item -LiteralPath $path
  if ($f.PSIsContainer -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected executable/link' }
  @{path=$f.FullName;sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
if ((Pin $bundle).sha256 -cne $bundleSHA) { throw 'Kit bundle digest mismatch before extraction' }
Expand-Archive -LiteralPath $bundle -DestinationPath $kit
& $node (Join-Path $PSScriptRoot 'verify-offline-kit-cli.mjs') $kit $fixtureSha $product $buildRun $manifestSHA
$pw = Join-Path $kit 'playwright'
$chrome = Join-Path $kit 'browser/chrome-win/chrome.exe'
$b = Pin $chrome
if ($b.sha256 -cne $browserSHA) { throw 'Wrong independently pinned browser' }
$b.revision = '1194'; $b.version = '141.0.7390.37'
$b.archive_sha256 = 'bc65aed7bded748e267bd4d5d21f19459fa6e47464370a923fb6d87ebb22d7fb'
$playwright = Pin (Join-Path $pw 'index.js')
$playwright.root=$pw; $playwright.version='1.56.1'
$playwright.integrity='sha512-hutraynyn31F+Bifme+Ps9Vq59hKuUCz7H1kDOcBs+2oGguKkWTU50bBWrtz34OUWmIwpBTWDxaRPXrIXkgvmQ=='
$images = @(Get-ChildItem -LiteralPath (Join-Path $kit 'browser') -Recurse -File -Filter '*.exe')
if ($images.Count -lt 1 -or $images.Count -gt 10) { throw 'Unexpected Chromium helper inventory' }
$m = @{source=$product; run=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; head=$head;
  runtime=(Pin (Join-Path $kit 'rsrs-runtime.exe')); desktop=(Pin (Join-Path $kit 'client2-proof.test.exe'));
  chromium=$b; playwright=$playwright; chromium_images=@($images | ForEach-Object { Pin $_.FullName });
  node=(Pin $node); acl_helper=(Pin (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'));
  console_host=(Pin (Join-Path $env:SystemRoot 'System32/conhost.exe'))}
$m | ConvertTo-Json -Depth 7 -Compress | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'No effective Windows firewall' }
$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
if ($profiles.Count -ne 3) { throw 'Missing firewall profiles' }
foreach ($profile in $profiles) {
  if ([string]$profile.Enabled -ne 'True' -or [string]$profile.AllowLocalFirewallRules -eq 'False') {
    throw 'Unavailable outbound firewall policy'
  }
}
Add-Type -Path (Join-Path $PSScriptRoot 'card018-owned-job.cs')
$programs = @(@($m.node,$m.runtime,$m.desktop,$m.acl_helper,$m.console_host)+@($m.chromium_images) |
  ForEach-Object { $_.path } | Sort-Object -Unique)
if ($programs.Count -lt 6 -or $m.chromium.path -notin $programs) { throw 'Incomplete application inventory' }
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
    ConvertTo-Json -Compress | & $node (Join-Path $PSScriptRoot 'verify-netsecurity-addresses.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Canonical policy coverage mismatch' }
}
try {
  for ($i=0;$i -lt $programs.Count;$i++) {
    $n4 = "$group-$i-v4"; $n6 = "$group-$i-v6"
    $names += @($n4,$n6)
    $common = @{Group=$group; PolicyStore='PersistentStore'; Direction='Outbound';
      Action='Block'; Enabled='True'; Profile='Any'; Protocol='Any'; Program=$programs[$i]}
    & (Join-Path $PSScriptRoot 'install-address-blocks.ps1') $node $common $n4 $n6
    ConfirmProgram $programs[$i] $n4 $n6
    $installed += @{Program=$programs[$i];V4=$n4;V6=$n6}
  }
  # Inherit only the minimum test process state, never runner tokens or home.
  $testTemp = Join-Path $stage 'synthetic-temp'
  [void](New-Item -ItemType Directory -Path $testTemp)
  $keep = @('SystemRoot','windir','SystemDrive','ComSpec','OS','PROCESSOR_ARCHITECTURE',
    'GITHUB_ACTIONS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','RUNNER_ENVIRONMENT','CARD018_FROZEN_HEAD')
  foreach ($item in @(Get-ChildItem Env:)) {
    if ($item.Name -notin $keep) { Remove-Item -LiteralPath ("Env:" + $item.Name) }
  }
  foreach ($key in @('TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA')) {
    Set-Item -LiteralPath ("Env:" + $key) -Value $testTemp
  }
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  'PASS bundle verified and rules installed before launching the owned tree'
  $log = Join-Path $stage 'junction.log'
  $allowed = [string[]]@($m.node.path,$m.runtime.path,$m.acl_helper.path,$m.console_host.path)
  if ((Get-Volume -FilePath $testTemp).FileSystem -ine 'NTFS') { throw 'NTFS required' }
  $code = [Card018OwnedJob]::Run($node,[string[]]@($file,$m.runtime.path),$testTemp,$log,$allowed,120000)
  if ((Get-Item -LiteralPath $log).Length -gt 32768) { throw 'Unexpected child output volume' }
  if ($code -ne 0) {
    $phases = @(Get-Content -LiteralPath $log | Where-Object { $_ -cmatch '^PHASE (startup|baseline|edit|restore)$' })
    throw ('Required native junction case failed; phases: ' + ($phases -join ', '))
  }
  if (@(Get-ChildItem -LiteralPath $testTemp -Force -Filter 'respire *').Count) { throw 'Synthetic profile remains' }
  $lines = @(Get-Content -LiteralPath $log | Where-Object { $_ -cmatch '^PASS junction HTTP en=[1-9][0-9]+ zh=[1-9][0-9]+ config restored samples=3$' })
  if ($lines.Count -ne 1) { throw 'Missing complete native receipt' }
  foreach ($entry in $installed) { ConfirmProgram $entry.Program $entry.V4 $entry.V6 }
  $lines[0]
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
