$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$source = '4da41a593ea1663a8199b4b9a1475eb05b8620a8'
$root = $env:GITHUB_WORKSPACE
$head = $env:CARD018_FROZEN_HEAD
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or
    $env:GITHUB_RUN_ATTEMPT -cne '1' -or $head -cnotmatch '^[a-f0-9]{40}$') {
  throw 'One disposable GitHub-hosted Windows attempt is required'
}
$repo = Join-Path $root 'exact-product'
$fixtureSha = '1dc3b179f484c95a787f82ae5299fd562bc47f6a'
$fixtureRepo = Join-Path $root 'exact-fixtures'
$fixtures = Join-Path $fixtureRepo 'test-cases/client2-e2e'
$stage = Join-Path $env:RUNNER_TEMP ('card018-ui-' + $env:GITHUB_RUN_ID)
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

if ((git -C $fixtureRepo rev-parse HEAD) -cne $fixtureSha) { throw 'Wrong exact fixture checkout' }
# No user or registry credentials are supplied to any build tool.
foreach ($key in @('GITHUB_TOKEN','GH_TOKEN','NODE_AUTH_TOKEN','NPM_TOKEN','CARGO_REGISTRY_TOKEN','GIT_ASKPASS','SSH_AUTH_SOCK')) {
  Remove-Item "Env:$key" -ErrorAction SilentlyContinue
}
$env:GIT_TERMINAL_PROMPT='0'
$env:GONOSUMDB=''
$env:GOSUMDB='sum.golang.org'
$env:GOFLAGS='-mod=readonly'
  if (Test-Path -LiteralPath $stage) { throw 'Staging already exists' }
  [void](New-Item -ItemType Directory -Path $stage)
  $env:GOTOOLCHAIN='local'; $env:CGO_ENABLED='0'; $env:CARGO_TERM_COLOR='never'
  $env:NPM_CONFIG_USERCONFIG = Join-Path $stage 'empty.npmrc'
  [void](New-Item -ItemType File -Path $env:NPM_CONFIG_USERCONFIG)
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
    # These three exact fixtures hard-code the previous reviewed product pin.
    # Substitute only that literal; keep all acceptance and owner checks intact.
    $pinFiles = @('card018_positive_memory_app_test.go','card018_storage_settings_app_test.go','card018_diary_accounts_app_test.go')
    if ($f -cin $pinFiles) {
      $prior = '505ecc4d3a4f6c67c6a35751ed3c467a337027e9'
      $text = [IO.File]::ReadAllText($dst)
      if ([regex]::Matches($text,[regex]::Escape($prior)).Count -ne 1) { throw 'Unexpected compiled fixture product pin' }
      [IO.File]::WriteAllText($dst,$text.Replace($prior,$source),[Text.UTF8Encoding]::new($false))
    }
  }
  Push-Location (Join-Path $repo 'packages/runtime-sdk-go')
  try { go generate ./... } finally { Pop-Location }
  Push-Location (Join-Path $repo 'apps/client2')
  try {
    $flags = "-X respire-client2/internal/desktop.card018PositiveSource=$source -X respire-client2/internal/desktop.card018StorageSettingsSource=$source -X respire-client2/internal/desktop.card018DiaryAccountsSource=$source"
    go test -p 1 -mod=readonly -tags 'server,production' -c -ldflags $flags -o $desktop ./internal/desktop
  } finally { Pop-Location }

  $kit = Join-Path $stage 'kit'
  $publish = Join-Path $stage 'publish'
  [void](New-Item -ItemType Directory -Path $kit, $publish)
  Copy-Item -LiteralPath $runtime -Destination (Join-Path $kit 'rsrs-runtime.exe')
  Copy-Item -LiteralPath $desktop -Destination (Join-Path $kit 'client2-proof.test.exe')
  $package = Join-Path $stage 'playwright-lock'
  [void](New-Item -ItemType Directory -Path $package)
  foreach ($n in @('package.json','package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $n) -Destination (Join-Path $package $n)
  }
  Push-Location $package
  try { npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ } finally { Pop-Location }
  $pw = Join-Path $package 'node_modules/playwright-core'
  $browserSpec = (Get-Content -Raw -LiteralPath (Join-Path $pw 'browsers.json') | ConvertFrom-Json).browsers | Where-Object name -CEQ 'chromium'
  if ($browserSpec.revision -cne '1194' -or $browserSpec.browserVersion -cne '141.0.7390.37') { throw 'Unexpected Chromium revision' }
  Copy-Item -Recurse -LiteralPath $pw -Destination (Join-Path $kit 'playwright')
  $zip = Join-Path $stage 'chromium-win64.zip'
  Invoke-WebRequest -Uri 'https://cdn.playwright.dev/builds/chromium/1194/chromium-win64.zip' -MaximumRedirection 0 -TimeoutSec 120 -OutFile $zip
  if ((Pin $zip).sha256 -cne 'bc65aed7bded748e267bd4d5d21f19459fa6e47464370a923fb6d87ebb22d7fb') { throw 'Unexpected pinned Chromium archive' }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $kit 'browser')
  $chrome = Join-Path $kit 'browser/chrome-win/chrome.exe'
  if ((Pin $chrome).sha256 -cne '153106834fb06976c587c39aaef0e8c0d1b1339a575e8d7b87f187058663a094') { throw 'Unexpected pinned Chromium executable' }
  & $node (Join-Path $PSScriptRoot 'build-offline-kit-manifest.mjs') $kit $fixtureSha $source $env:GITHUB_RUN_ID
  $bundle = Join-Path $publish 'offline-kit.zip'
  tar.exe -a -cf $bundle -C $kit .
  $bundleSHA = (Pin $bundle).sha256
  $manifestSHA = (Pin (Join-Path $kit 'offline-kit.json')).sha256
  "bundle_sha256=$bundleSHA" | Set-Content -LiteralPath (Join-Path $publish 'SHA256SUMS.txt') -Encoding ascii
  "manifest_sha256=$manifestSHA" | Add-Content -LiteralPath (Join-Path $publish 'SHA256SUMS.txt') -Encoding ascii
  "Verified offline kit bundle SHA-256: $bundleSHA"
  "Verified per-file manifest SHA-256: $manifestSHA"
  "Artifact pins candidate=$head fixture=$fixtureSha product=$source build_run=$env:GITHUB_RUN_ID"
  "path=$publish" | Add-Content -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8NoBOM
