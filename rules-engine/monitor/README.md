# JustSoc monitor scripts

Source for the probe-side runtime dispatcher / control helper:

- `selk-runtime-monitor.py` — long-running HTTP dispatcher that polls health,
  exposes a runtime-pulse snapshot, applies asset documents, and restarts
  probe/engine systemd units.
- `selk-runtime-control.sh` — convenience CLI that signs and posts restart
  requests to the dispatcher.

This directory is the **source of truth**. `deploy/build.sh` copies both
scripts into `deploy/monitor/` as part of building the deployment package,
and `deploy/install.sh` wires `selk-runtime-monitor.py` into the
`selk-probe-dispatcher` systemd unit.

For deployment and runtime configuration, see `../deploy/README.md`.

## Environment

The dispatcher reads two env files at runtime (both installed by
`deploy/install.sh`):

- `deploy/configs/probe-stack.env` — the single human-edited deployment config.
- `deploy/configs/runtime-monitor.env` — derived runtime values
  (asset paths, dispatcher URLs, secret file path, ...).

Relevant variables include `SELK_RUNTIME_PORT`, `SELK_DISPATCH_AUTH_MODE`,
`SELK_DISPATCH_SHARED_SECRET_FILE`, `SELK_ASSET_CONFIG_ROOT`. See
`deploy/configs/probe-stack.env.example` for the canonical list.
