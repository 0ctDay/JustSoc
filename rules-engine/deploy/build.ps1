param(
    [string]$GoOsTarget = "linux",
    [string]$GoArchTarget = "amd64"
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$repoRoot  = Split-Path -Parent $scriptDir
$binDir    = Join-Path $scriptDir "bin"
$configs   = Join-Path $scriptDir "configs"
$monitor   = Join-Path $scriptDir "monitor"
$rules     = Join-Path $scriptDir "suricata-rules"

foreach ($p in @($binDir, $configs, $monitor, $rules)) {
    New-Item -ItemType Directory -Force -Path $p | Out-Null
}

$probeOut  = Join-Path $binDir ("selk-probe-{0}-{1}" -f $GoOsTarget, $GoArchTarget)
$engineOut = Join-Path $binDir "threat-engine"

$env:GOWORK = "off"
$env:CGO_ENABLED = "0"
$env:GOOS = $GoOsTarget
$env:GOARCH = $GoArchTarget

Write-Host "[1/4] building selk-probe -> $probeOut"
go -C (Join-Path $repoRoot "probe") build -o $probeOut ./cmd/selk-probe
if (-not $?) { exit 1 }

Write-Host "[2/4] building threat-engine -> $engineOut"
go -C (Join-Path $repoRoot "go-engine") build -o $engineOut ./cmd/threat-engine
if (-not $?) { exit 1 }

Write-Host "[3/4] syncing monitor scripts -> $monitor"
Copy-Item -Force (Join-Path $repoRoot "monitor\selk-runtime-monitor.py") $monitor
Copy-Item -Force (Join-Path $repoRoot "monitor\selk-runtime-control.sh") $monitor

Write-Host "[4/4] syncing static configs and suricata rules"
Copy-Item -Force (Join-Path $repoRoot "probe\configs\probe.example.yaml")   (Join-Path $configs "probe.example.yaml")
Copy-Item -Force (Join-Path $repoRoot "go-engine\configs\engine-rules.yaml") (Join-Path $configs "engine-rules.yaml")

Get-ChildItem -Path $rules -Filter "*.rules" -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item -Force (Join-Path $repoRoot "suricata-rules\*.rules") $rules

Write-Host ""
Write-Host "deploy package ready in: $scriptDir"
Write-Host "binaries:        $binDir"
Write-Host "configs:         $configs  (edit configs\probe-stack.env then run ./init-config.sh)"
Write-Host "monitor scripts: $monitor"
Write-Host "suricata rules:  $rules"
