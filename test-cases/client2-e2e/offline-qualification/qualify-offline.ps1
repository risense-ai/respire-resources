$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$fixtureSha = '1dc3b179f484c95a787f82ae5299fd562bc47f6a'
$product = '505ecc4d3a4f6c67c6a35751ed3c467a337027e9'
$buildRun = '45665923177'
$bundleSHA = 'c73ed75cc2acdb813129208d831f13e97726d2d358100d69890d04ed2e7a94d4'
$manifestSHA = '8fe14544264d1e612824edfada583b86b86d54c0ffd6b7399e7ba3404351f696'
$browserSHA = '153106834fb06976c587c39aaef0e8c0d1b1339a575e8d7b87f187058663a094'
$head = $env:CARD018_FROZEN_HEAD
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or
    $env:GITHUB_RUN_ATTEMPT -cne '1' -or $head -cnotmatch '^[a-f0-9]{40}$' -or
    $bundleSHA -cnotmatch '^[a-f0-9]{64}$' -or $manifestSHA -cnotmatch '^[a-f0-9]{64}$') { throw 'Missing exact reviewed qualification pins' }
$node = (Get-Command node.exe -CommandType Application).Source
$checkout = Join-Path $env:GITHUB_WORKSPACE 'exact-fixtures'
$fixtures = Join-Path $checkout 'test-cases/client2-e2e'
if ((git rev-parse HEAD) -cne $head -or (git -C $checkout rev-parse HEAD) -cne $fixtureSha) { throw 'Wrong exact test source' }
# Only these diagnostics are overlaid after proving the exact fixture checkout.
$overlay = Join-Path $PSScriptRoot 'diagnostic-overlay'
$overlays = @('positive-memory-runtime-and-browser.mjs','positive-memory-proof-launcher.mjs','positive-memory-proof-browser.mjs','storage-settings-runtime-and-browser.mjs','storage-settings-proof-launcher.mjs','storage-settings-proof-browser.mjs','diary-accounts-runtime-and-browser.mjs','diary-accounts-proof-launcher.mjs','diary-accounts-proof-browser.mjs','card018-safe-diagnostic.mjs')
foreach ($file in $overlays) {
  $source = Join-Path $overlay $file
  $dest = Join-Path $fixtures $file
  if ($file -ceq 'card018-safe-diagnostic.mjs') {
    if (Test-Path -LiteralPath $dest) { throw 'Diagnostic file unexpectedly exists' }
  } elseif (!(Test-Path -LiteralPath $dest -PathType Leaf)) { throw 'Original frozen fixture is missing' }
  Copy-Item -LiteralPath $source -Destination $dest
}
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
$v4 = @('0.0.0.1-127.0.0.0','127.0.0.2-255.255.255.255')
$v6 = @('::/1','8000::/1')
$names = @()
$installed = @()
$casesFailed = @()
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
    New-NetFirewallRule @common -Name $n4 -DisplayName $n4 -RemoteAddress $v4 | Out-Null
    New-NetFirewallRule @common -Name $n6 -DisplayName $n6 -RemoteAddress $v6 | Out-Null
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
  $jobs=@(
    @{name='Overview-Memories-Recall'; flag='CARD018_POSITIVE_ONLY'; script='positive-memory-runtime-and-browser.mjs'; expect='PASS positive Overview, Memories and Recall with independent scoped Runtime observations'},
    @{name='Storage-Settings'; flag='CARD018_STORAGE_SETTINGS_ONLY'; script='storage-settings-runtime-and-browser.mjs'; expect='PASS isolated Storage and Settings with independent scoped Runtime and host observations'},
    @{name='Diary'; flag='CARD018_DIARY_ACCOUNTS_ONLY'; mode='diary'; script='diary-accounts-runtime-and-browser.mjs'; expect='PASS isolated Diary/Accounts with independent scoped Runtime and host observations'},
    @{name='Accounts'; flag='CARD018_DIARY_ACCOUNTS_ONLY'; mode='accounts'; script='diary-accounts-runtime-and-browser.mjs'; expect='PASS isolated Diary/Accounts with independent scoped Runtime and host observations'}
  )
  foreach ($j in $jobs) {
    foreach ($locale in @('en','zh')) {
      foreach ($item in $installed) { ConfirmProgram $item.Program $item.V4 $item.V6 }
      Set-Item -LiteralPath ("Env:" + $j.flag) -Value '1'
      $env:CARD018_LOCALE=$locale
      $env:CARD018_DIARY_ACCOUNTS_MODE=$j.mode
      $file = Join-Path $fixtures $j.script
      $log = Join-Path $stage ($j.name+'-'+$locale+'.log')
      try {
        $code = [Card018OwnedJob]::Run($m.node.path,[string[]]@($file,$m.runtime.path,$m.desktop.path,$receipt),$testTemp,$log,[string[]]$programs,120000)
      } catch {
        "FAIL owned monitor for $($j.name)/$locale"
        if (Test-Path -LiteralPath $log) {
          if ((Get-Item -LiteralPath $log).Length -le 32768) {
            Get-Content -LiteralPath $log | Where-Object { $_ -match '^(PASS |FAIL |READY OWNED |FIXTURE )' }
          }
        }
        throw
      } finally {
        Remove-Item -LiteralPath ("Env:" + $j.flag) -ErrorAction SilentlyContinue
      }
      if ((Get-Item -LiteralPath $log).Length -gt 32768) { throw 'Unexpected child output volume' }
      $lines = @(Get-Content -LiteralPath $log)
      $lines | Where-Object { $_ -match '^(PASS |FAIL |READY OWNED |FIXTURE )' }
      if ($code -eq 0 -and (@($lines | Where-Object { $_ -ceq $j.expect }).Count -ne 1 -or
          @($lines | Where-Object { $_ -ceq 'PASS owned Runtime stopped and synthetic root removed' }).Count -ne 1)) {
        throw 'Missing unique real browser or owned cleanup receipt'
      }
      if (@(Get-ChildItem -LiteralPath $testTemp -Force | Where-Object { $_.Name -like 'respire *' }).Count -ne 0) {
        throw 'Owned synthetic profile remained after process exit; no next case'
      }
      if ($code -eq 0) { "PASS compiled case $($j.name) $locale; owned process count zero" }
      else { $casesFailed += "$($j.name)/$locale"; "FAIL compiled case $($j.name) $locale (exit $code)" }
    }
  }

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
if ($casesFailed.Count) { throw "Compiled fixture failures: $($casesFailed -join ', ')" }
