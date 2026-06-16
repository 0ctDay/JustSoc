@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ENGINE_ROOT=%SCRIPT_DIR%.."
set "CONFIG_PATH=%~1"
if "%CONFIG_PATH%"=="" set "CONFIG_PATH=%ENGINE_ROOT%\configs\engine.conf"

set "GOWORK=off"

echo Starting threat-engine
echo   Config: %CONFIG_PATH%

go -C "%ENGINE_ROOT%" run ./cmd/threat-engine --config "%CONFIG_PATH%"
