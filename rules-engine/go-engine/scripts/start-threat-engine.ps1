param(
    [string]$ConfigPath = ""
)

$engineRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $engineRoot "configs\engine.conf"
}

$env:GOWORK = "off"

Write-Host "Starting threat-engine"
Write-Host "  Config: $ConfigPath"

go -C "$engineRoot" run ./cmd/threat-engine --config "$ConfigPath"
