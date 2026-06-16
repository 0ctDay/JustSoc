param(
    [string]$GoOsTarget = "linux",
    [string]$GoArchTarget = "amd64",
    [string]$OutDir = ""
)

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $repoRoot = Split-Path -Parent $root
    $OutDir = Join-Path $repoRoot "deploy\bin"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$env:CGO_ENABLED = "0"
$env:GOOS = $GoOsTarget
$env:GOARCH = $GoArchTarget

$outputName = "selk-probe-$GoOsTarget-$GoArchTarget"
if ($GoOsTarget -eq "windows") {
    $outputName = "$outputName.exe"
}
$outputPath = Join-Path $OutDir $outputName

go -C $root build -o $outputPath ./cmd/selk-probe
if (-not $?) {
    exit 1
}

Write-Host "built $outputPath"
