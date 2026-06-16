@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ENGINE_ROOT=%SCRIPT_DIR%.."
set "REPO_ROOT=%ENGINE_ROOT%\.."
set "BIN_DIR=%REPO_ROOT%\deploy\bin"
for %%I in ("%ENGINE_ROOT%") do set "ENGINE_ROOT=%%~fI"
for %%I in ("%BIN_DIR%") do set "BIN_DIR=%%~fI"

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

set "GOWORK=off"
set "GOOS=linux"
set "GOARCH=amd64"
set "CGO_ENABLED=0"

echo Building threat-engine for Linux amd64
echo   Output: "%BIN_DIR%\threat-engine"

go -C "%ENGINE_ROOT%" build -o "%BIN_DIR%\threat-engine" ./cmd/threat-engine
if errorlevel 1 exit /b %errorlevel%

echo Build completed successfully.
