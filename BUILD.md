# JustSoc build flow

This document defines the standard build flow for the current JustSoc layout.

## Components

- `platform`: Next.js management server.
- `platform/claude-code-bridge`: optional Claude bridge service.
- `monitor&deploy`: probe-side deployment package.
- `rules-engine/probe`: Go probe binary source.
- `rules-engine/go-engine`: Go threat-engine binary source.

## Requirements

- Go `1.22+`
- Node.js `22+`
- npm
- Docker and Docker Compose, only when building or running Platform with Docker

Install Node dependencies when `node_modules` is missing:

```powershell
npm --prefix .\platform ci
npm --prefix .\platform\claude-code-bridge ci
```

## One-command build

Run from repository root:

```powershell
.\scripts\build-all.ps1
```

Default behavior:

- Run Go tests for `rules-engine/probe`.
- Run Go tests for `rules-engine/go-engine`.
- Build probe-side Linux amd64 binaries into `monitor&deploy`.
- Build `platform`.
- Build `platform/claude-code-bridge`.

Common options:

```powershell
.\scripts\build-all.ps1 -SkipTests
.\scripts\build-all.ps1 -SkipPlatform
.\scripts\build-all.ps1 -SkipBridge
.\scripts\build-all.ps1 -PackageProbeStack
.\scripts\build-all.ps1 -GoOsTarget linux -GoArchTarget amd64
```

Expected probe-side outputs:

```text
monitor&deploy/selk-probe-linux-amd64
monitor&deploy/threat-engine
```

With `-PackageProbeStack`, the script also creates:

```text
monitor-deploy-linux-amd64.zip
```

## Module builds

Probe-side package only:

```powershell
.\monitor&deploy\build-probe-stack.ps1
```

Bash:

```bash
./monitor\&deploy/build-probe-stack.sh
```

Platform only:

```powershell
npm --prefix .\platform run build
```

Claude bridge only:

```powershell
npm --prefix .\platform\claude-code-bridge run build
```

Go tests only:

```powershell
go -C .\rules-engine\probe test ./...
go -C .\rules-engine\go-engine test ./...
```

## Cleanup

Default cleanup keeps `node_modules`:

```powershell
.\scripts\clean-artifacts.ps1
```

Use deep cleanup only when dependencies can be reinstalled:

```powershell
.\scripts\clean-artifacts.ps1 -Deep
```

The cleanup script is path-whitelisted and only removes explicitly listed build artifacts.
