param(
  [switch]$Build,
  [switch]$Pull,
  [switch]$Down,
  [switch]$Logs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$composeFile = Join-Path $root 'docker-compose.platform.yml'
$envFile = Join-Path $root '.env'
$exampleEnvFile = Join-Path $root '.env.docker.example'

if (!(Test-Path $composeFile)) {
  throw "Compose file not found: $composeFile"
}

if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI was not found. Install Docker first.'
}

if (!(Test-Path $envFile) -and (Test-Path $exampleEnvFile)) {
  Copy-Item -LiteralPath $exampleEnvFile -Destination $envFile
  Write-Host 'Created .env from .env.docker.example. Edit ELK-related variables when your ELK stack is ready.'
}

$compose = @('compose', '--env-file', $envFile, '-f', $composeFile)

if ($Down) {
  & docker @compose down
  exit $LASTEXITCODE
}

if ($Pull) {
  & docker @compose pull platform-db
}

$upArgs = @('up', '-d')
if ($Build) {
  $upArgs += '--build'
}

& docker @compose @upArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ''
Write-Host 'Platform containers:'
& docker @compose ps

Write-Host ''
Write-Host 'Platform URL:'
$platformPort = (Get-Content $envFile | Where-Object { $_ -match '^PLATFORM_PORT=' } | Select-Object -First 1) -replace '^PLATFORM_PORT=', ''
if (!$platformPort) { $platformPort = '3000' }
Write-Host "http://localhost:$platformPort"

if ($Logs) {
  & docker @compose logs -f platform
}