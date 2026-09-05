param(
  [Alias('Web2ExeRoot')]
  [string]$Web2AppRoot,
  [string]$OutputPath
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $projectRoot 'apps\desktop\dist'
$artifactDirectory = Join-Path $projectRoot 'artifacts'
$outputPath = if ($OutputPath) {
  if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath }
  else { Join-Path $projectRoot $OutputPath }
} else { Join-Path $artifactDirectory 'lw.AIUsage.exe' }
$iconPath = Join-Path $projectRoot 'assets\lw-aiusage-icon.ico'

if (-not $Web2AppRoot) {
  $configuredRoot = [Environment]::GetEnvironmentVariable('LW_WEB2APP_ROOT')
  $workspaceParent = Split-Path -Parent $projectRoot
  $rootCandidates = @(
    $configuredRoot,
    (Join-Path $workspaceParent 'lw.Web2App'),
    (Join-Path $workspaceParent 'lw.Web2Exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $Web2AppRoot = $rootCandidates | Select-Object -First 1
}

if (-not $Web2AppRoot) {
  throw 'lw.Web2App root was not found. Pass -Web2AppRoot or set LW_WEB2APP_ROOT.'
}

$packerCandidates = @(
  (Join-Path $Web2AppRoot 'lw.Web2App.exe'),
  (Join-Path $Web2AppRoot 'build-ninja\lw.Web2App.exe'),
  (Join-Path $Web2AppRoot 'build-local-windows-ninja\lw.Web2App.exe'),
  (Join-Path $Web2AppRoot 'build\Release\lw.Web2App.exe')
)
$packer = $packerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $packer) { throw "lw.Web2App packer not found under $Web2AppRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory 'index.html'))) { throw "Build output not found. Run pnpm build first." }
if (-not (Test-Path -LiteralPath $iconPath)) { throw "Icon asset not found: $iconPath" }

New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }
$pack = Start-Process -FilePath $packer -Wait -PassThru -NoNewWindow `
  -ArgumentList @(
    'pack', $sourceDirectory, $outputPath,
    '--title', 'lw.AIUsage',
    '--product-name', 'lw.AIUsage',
    '--file-description', 'Local AI coding usage dashboard',
    '--icon', $iconPath,
    '--external-links', 'browser',
    '--windowed',
    '--app-id', 'com.lw.aiusage',
    '--ipc',
    '--ipc-capability', 'app.paths',
    '--ipc-capability', 'fs.exists',
    '--ipc-capability', 'fs.list',
    '--ipc-capability', 'fs.read',
    '--ipc-capability', 'fs.watch',
    '--ipc-root', '${HOME}/.codex',
    '--ipc-root', '${HOME}/.claude'
  )
if ($pack.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
  throw "lw.Web2App packaging failed with exit code $($pack.ExitCode)"
}

$inspect = Start-Process -FilePath $packer -Wait -PassThru -NoNewWindow `
  -ArgumentList @('inspect', $outputPath)
if ($inspect.ExitCode -ne 0) {
  throw "lw.Web2App inspection failed with exit code $($inspect.ExitCode)"
}

Get-Item -LiteralPath $outputPath | Select-Object FullName, Length, LastWriteTime
