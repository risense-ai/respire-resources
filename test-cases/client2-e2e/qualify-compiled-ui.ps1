param([Parameter(Mandatory)][ValidateSet('Build','Run')][string]$Phase)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$source = '505ecc4d3a4f6c67c6a35751ed3c467a337027e9'
$root = $env:GITHUB_WORKSPACE
$head = $env:CARD018_FROZEN_HEAD
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or
    $env:GITHUB_RUN_ATTEMPT -cne '1' -or $head -cnotmatch '^[a-f0-9]{40}$') {
  throw 'One disposable GitHub-hosted Windows attempt is required'
}
$repo = Join-Path $root 'exact-product'
$fixtures = Join-Path $root 'test-cases/client2-e2e'
$stage = Join-Path $env:RUNNER_TEMP ('card018-ui-' + $env:GITHUB_RUN_ID)
$receipt = Join-Path $stage 'receipt.json'
$runtime = Join-Path $stage 'target/x86_64-pc-windows-msvc/debug/rsrs-runtime.exe'
$desktop = Join-Path $stage 'client2-proof.test.exe'
$node = (Get-Command node.exe -ErrorAction Stop).Source

function CanonicalFile([string]$Path) {
  $info = Get-Item -LiteralPath $Path
  if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected executable/link' }
  $info.FullName
}
function Pin([string]$Path) {
  $f = CanonicalFile $Path
  @{path=$f; sha256=(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()}
}
function CheckPin($pin) {
  $local = Pin $pin.path
  if ($local.path -ine $pin.path -or $local.sha256 -cne $pin.sha256) { throw 'Artifact changed since frozen build' }
  $local.path
}
if ((git rev-parse HEAD) -cne $head -or (git -C $repo rev-parse HEAD) -cne $source) { throw 'Wrong fixture or product checkout' }

if ($Phase -eq 'Build') {
  if (Test-Path -LiteralPath $stage) { throw 'Staging already exists' }
  [void](New-Item -ItemType Directory -Path $stage)
  $env:GOTOOLCHAIN='local'; $env:CGO_ENABLED='0'; $env:CARGO_TERM_COLOR='never'
  rustup toolchain install 1.95.0 --profile minimal
  cargo +1.95.0 build --locked --manifest-path (Join-Path $repo 'apps/runtime/Cargo.toml') --target x86_64-pc-windows-msvc --target-dir (Join-Path $stage 'target') -p respire_runtime --bin rsrs-runtime
  $overlay = @('card018_compiled_split_css_test.go',
    'card018_positive_memory_app_test.go','card018_positive_memory_gate.go','card018_positive_memory_gate_test.go',
    'card018_storage_settings_app_test.go','card018_storage_settings_gate.go','card018_storage_settings_gate_test.go',
    'card018_diary_accounts_app_test.go','card018_diary_accounts_gate.go','card018_diary_accounts_gate_test.go')
  $deskSource = Join-Path $repo 'apps/client2/internal/desktop'
  foreach ($f in $overlay) {
    $dst = Join-Path $deskSource $f
    if (Test-Path -LiteralPath $dst) { throw 'Test overlay collides with product source' }
    Copy-Item -LiteralPath (Join-Path $fixtures $f) -Destination $dst
  }
  Push-Location (Join-Path $repo 'packages/runtime-sdk-go')
  try { go generate ./... } finally { Pop-Location }
  Push-Location (Join-Path $repo 'apps/client2')
  try {
    $flags = "-X respire-client2/internal/desktop.card018PositiveSource=$source -X respire-client2/internal/desktop.card018StorageSettingsSource=$source -X respire-client2/internal/desktop.card018DiaryAccountsSource=$source"
    go test -p 1 -mod=readonly -tags 'server,production' -c -ldflags $flags -o $desktop ./internal/desktop
  } finally { Pop-Location }

  # Acquire tools only in the build phase. No browser or application starts.
  $meta = Invoke-RestMethod -Uri 'https://registry.npmjs.org/playwright-core/1.56.1' -MaximumRedirection 0 -TimeoutSec 20
  $npmArchive = 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.56.1.tgz'
  if ($meta.name -cne 'playwright-core' -or $meta.version -cne '1.56.1' -or
      $meta.dist.tarball -cne $npmArchive -or $meta.dist.integrity -cnotmatch '^sha512-[A-Za-z0-9+/]{86}==$') {
    throw 'Unexpected official Playwright package metadata'
  }
  $pack = Join-Path $stage 'playwright.tgz'
  Invoke-WebRequest -Uri $npmArchive -MaximumRedirection 0 -TimeoutSec 50 -OutFile $pack
  $h = [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash -LiteralPath $pack -Algorithm SHA512).Hash))
  if (('sha512-' + $h) -cne $meta.dist.integrity) { throw 'Playwright archive integrity mismatch' }
  tar.exe -xzf $pack -C $stage
  $pw = Join-Path $stage 'package'
  $browserSpec = (Get-Content -Raw -LiteralPath (Join-Path $pw 'browsers.json') | ConvertFrom-Json).browsers | Where-Object name -CEQ 'chromium'
  if ($browserSpec.revision -cne '1194' -or $browserSpec.browserVersion -cne '141.0.7390.37') { throw 'Unexpected Chromium revision' }
  $zip = Join-Path $stage 'chromium-win64.zip'
  Invoke-WebRequest -Uri 'https://cdn.playwright.dev/builds/chromium/1194/chromium-win64.zip' -MaximumRedirection 0 -TimeoutSec 100 -OutFile $zip
  $chromeRoot = Join-Path $stage 'browser'
  Expand-Archive -LiteralPath $zip -DestinationPath $chromeRoot
  $chrome = Join-Path $chromeRoot 'chrome-win/chrome.exe'
  if ((Get-Item -LiteralPath $chrome).VersionInfo.ProductVersion -cne '141.0.7390.37') { throw 'Wrong actual full Windows Chromium executable' }
  $images = @(Get-ChildItem -LiteralPath $chromeRoot -Recurse -File -Filter '*.exe' | Sort-Object FullName)
  if ($images.Count -lt 1 -or $images.Count -gt 10) { throw 'Unexpected full Chromium image inventory' }
  $b = Pin $chrome
  $b.revision = '1194'; $b.version = '141.0.7390.37'; $b.archive_sha256 = (Pin $zip).sha256
  $pwPin = Pin (Join-Path $pw 'index.js')
  $pwPin.root = $pw; $pwPin.version = '1.56.1'; $pwPin.integrity = $meta.dist.integrity
  $aclHelper = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $m = @{source=$source; run=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT; head=$head;
    runtime=(Pin $runtime); desktop=(Pin $desktop); node=(Pin $node); chromium=$b; playwright=$pwPin;
    chromium_images=@($images | ForEach-Object { Pin $_.FullName }); acl_helper=(Pin $aclHelper);
    console_host=(Pin (Join-Path $env:SystemRoot 'System32/conhost.exe'))}
  $m | ConvertTo-Json -Depth 7 -Compress | Set-Content -LiteralPath $receipt -Encoding utf8NoBOM
  "Pinned Runtime SHA-256: $($m.runtime.sha256)"
  "Pinned Client2 test SHA-256: $($m.desktop.sha256)"
  "Pinned full Chromium archive SHA-256: $($b.archive_sha256)"
  "Pinned full Chromium executable SHA-256: $($b.sha256)"
  exit 0
}

# All following application traffic is local; no download/install/network steps.
$m = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
if ($m.source -cne $source -or $m.head -cne $head -or $m.run -cne $env:GITHUB_RUN_ID -or
    $m.attempt -cne '1' -or $m.node.path -ine $node) { throw 'Build receipt is not bound to this job' }
if ((Get-Service MpsSvc).Status -ne 'Running') { throw 'No effective Windows firewall; do not launch' }
foreach ($p in @(Get-NetFirewallProfile -PolicyStore ActiveStore)) {
  if ([string]$p.Enabled -ne 'True' -or [string]$p.AllowLocalFirewallRules -eq 'False') {
    throw 'No enforceable application egress boundary; do not launch'
  }
}
$programs = @(@($m.node,$m.runtime,$m.desktop,$m.acl_helper,$m.console_host)+@($m.chromium_images) | ForEach-Object { CheckPin $_ } | Sort-Object -Unique)
if ($programs.Count -lt 6 -or $m.chromium.path -notin $programs) { throw 'Incomplete executable inventory' }
$null=CheckPin $m.playwright
foreach ($file in @($m.runtime.path,$m.desktop.path)) { if (!$file.StartsWith($stage + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected staged image root' } }
Add-Type -Path (Join-Path $PSScriptRoot 'card018-owned-job.cs')
$address = @('0.0.0.0-127.0.0.0', '127.0.0.2-255.255.255.255', '::/0')
$group = 'CARD018-offline-' + [guid]::NewGuid().ToString('N')
$rules = @()
$casesFailed = @()
function ConfirmRule([string]$Name,[string]$Program) {
  $rule = @(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Name)
  if ($rule.Count -ne 1 -or [string]$rule[0].Enabled -ne 'True' -or
      [string]$rule[0].Direction -ne 'Outbound' -or [string]$rule[0].Action -ne 'Block' -or
      [string]$rule[0].Profile -ne 'Any' -or
      (Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule[0]).Program -ine $Program -or
      (Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule[0]).Protocol -ne 'Any' -or
      (@((Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule[0]).RemoteAddress | Sort-Object) -join '|') -cne (@($address | Sort-Object) -join '|')) {
    throw 'Effective application egress rule mismatch; do not launch'
  }
}
try {
  for ($i=0;$i -lt $programs.Count;$i++) {
    $name = "$group-$i"
    New-NetFirewallRule -Name $name -DisplayName $name -Group $group -PolicyStore PersistentStore -Direction Outbound -Action Block -Enabled True -Profile Any -Protocol Any -Program $programs[$i] -RemoteAddress $address | Out-Null
    $rules += $name
    ConfirmRule $name $programs[$i]
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
  'PASS effective per-image loopback-only rules installed before launching the owned tree'
  $jobs=@(
    @{name='Overview-Memories-Recall'; flag='CARD018_POSITIVE_ONLY'; script='positive-memory-runtime-and-browser.mjs'; expect='PASS positive Overview, Memories and Recall with independent scoped Runtime observations'},
    @{name='Storage-Settings'; flag='CARD018_STORAGE_SETTINGS_ONLY'; script='storage-settings-runtime-and-browser.mjs'; expect='PASS isolated Storage and Settings with independent scoped Runtime and host observations'},
    @{name='Diary'; flag='CARD018_DIARY_ACCOUNTS_ONLY'; mode='diary'; script='diary-accounts-runtime-and-browser.mjs'; expect='PASS isolated Diary/Accounts with independent scoped Runtime and host observations'},
    @{name='Accounts'; flag='CARD018_DIARY_ACCOUNTS_ONLY'; mode='accounts'; script='diary-accounts-runtime-and-browser.mjs'; expect='PASS isolated Diary/Accounts with independent scoped Runtime and host observations'}
  )
  foreach ($j in $jobs) {
    foreach ($locale in @('en','zh')) {
      for ($i=0;$i -lt $programs.Count;$i++) { ConfirmRule $rules[$i] $programs[$i] }
      Set-Item -LiteralPath ("Env:" + $j.flag) -Value '1'
      $env:CARD018_LOCALE=$locale
      $env:CARD018_DIARY_ACCOUNTS_MODE=$j.mode
      $file = Join-Path $fixtures $j.script
      $log = Join-Path $stage ($j.name+'-'+$locale+'.log')
      try {
        $code = [Card018OwnedJob]::Run($m.node.path,[string[]]@($file,$m.runtime.path,$m.desktop.path,$receipt),$testTemp,$log,[string[]]$programs,120000)
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
  foreach ($name in $rules) {
    Remove-NetFirewallRule -PolicyStore PersistentStore -Name $name
    if (Get-NetFirewallRule -PolicyStore ActiveStore -Name $name -ErrorAction SilentlyContinue) { throw 'Qualification firewall rule was not removed' }
  }
}
if ($casesFailed.Count) { throw "Compiled fixture failures: $($casesFailed -join ', ')" }
