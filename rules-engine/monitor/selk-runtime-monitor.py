#!/usr/bin/env python3
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request
from urllib.parse import urlsplit

try:
    import yaml

    YAML_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # pragma: no cover - import failure depends on runtime
    yaml = None
    YAML_IMPORT_ERROR = str(exc)

RUNNING = True
DEFAULT_METRICS_PATH = "/_selk_internal/v1/runtime-pulse/9f3a7c4e61/metrics"
DEFAULT_CONTROL_PATH = "/_selk_internal/v1/control-plane/9f3a7c4e61/restart"
DEFAULT_ASSET_APPLY_PATH = "/_selk_internal/v1/assets/apply"
DEFAULT_ASSET_STATUS_PATH = "/_selk_internal/v1/assets/status"
DEFAULT_ASSET_VALIDATE_PATH = "/_selk_internal/v1/assets/validate"
DEFAULT_ASSET_ROLLBACK_PATH = "/_selk_internal/v1/assets/rollback"
STATE_LOCK = threading.Lock()
NONCE_LOCK = threading.Lock()
STATE: Dict[str, object] = {
    "snapshot": {},
    "last_command": None,
    "last_asset_operation": None,
}
NONCE_CACHE: Dict[str, float] = {}
CPU_PREVIOUS: Optional[Tuple[int, int]] = None
HTTP_SERVER: Optional[ThreadingHTTPServer] = None


class ConfigError(Exception):
    pass


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_text(name: str, default: str = "") -> str:
    return os.getenv(name, "").strip() or default


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def to_iso(timestamp: Optional[float]) -> Optional[str]:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def json_hash(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def read_secret_from_env_or_file(env_key: str, file_env_key: str) -> str:
    direct = env_text(env_key)
    if direct:
        return direct
    file_path = env_text(file_env_key)
    if not file_path:
        return ""
    path = Path(file_path)
    if not path.exists():
        raise ConfigError(f"secret file does not exist: {file_path}")
    return path.read_text(encoding="utf-8").strip()


def require_yaml_module() -> None:
    if yaml is None:
        reason = YAML_IMPORT_ERROR or "unknown import error"
        raise ConfigError(f"PyYAML is required for asset dispatcher endpoints: {reason}")


def run_command(command: List[str], timeout: int = 5) -> Tuple[int, str, str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except Exception as exc:  # pragma: no cover - subprocess failures depend on runtime
        return 1, "", str(exc)


def file_snapshot(path: str) -> Dict[str, object]:
    if not path:
        return {"path": path, "exists": False}
    file_path = Path(path)
    if not file_path.exists():
        return {"path": path, "exists": False}
    stat = file_path.stat()
    modified_at = stat.st_mtime
    return {
        "path": path,
        "exists": True,
        "sizeBytes": stat.st_size,
        "modifiedAt": to_iso(modified_at),
        "modifiedAtEpoch": modified_at,
    }


def is_fresh(snapshot: Dict[str, object], stale_after_seconds: int) -> bool:
    modified_at = snapshot.get("modifiedAtEpoch")
    if not isinstance(modified_at, (int, float)):
        return False
    return (time.time() - float(modified_at)) <= stale_after_seconds


def http_check(url: str, timeout: int = 3) -> Dict[str, object]:
    try:
        with request.urlopen(url, timeout=timeout) as response:
            body = response.read(128).decode("utf-8", errors="replace").strip()
            return {"ok": 200 <= response.status < 300, "statusCode": response.status, "body": body}
    except error.HTTPError as exc:
        body = exc.read(128).decode("utf-8", errors="replace").strip()
        return {"ok": False, "statusCode": exc.code, "body": body, "error": str(exc)}
    except Exception as exc:  # pragma: no cover - depends on runtime
        return {"ok": False, "error": str(exc)}


def systemd_unit(unit: str) -> Dict[str, object]:
    properties = [
        "Id",
        "LoadState",
        "ActiveState",
        "SubState",
        "MainPID",
        "ExecMainStatus",
        "ActiveEnterTimestamp",
    ]
    command = ["systemctl", "show", unit, "--no-page", f"--property={','.join(properties)}"]
    code, stdout, stderr = run_command(command)
    result: Dict[str, object] = {
        "unit": unit,
        "loadState": "unknown",
        "activeState": "unknown",
        "subState": "unknown",
        "pid": None,
        "startedAt": None,
        "status": "unknown",
    }
    if code != 0:
        result["message"] = stderr or stdout or "systemctl show failed"
        return result

    for line in stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key[0].lower() + key[1:]] = value

    pid = str(result.get("mainPID") or "0").strip()
    result["pid"] = int(pid) if pid.isdigit() and pid != "0" else None
    started_at = str(result.get("activeEnterTimestamp") or "").strip()
    result["startedAt"] = None if not started_at or started_at == "n/a" else started_at

    load_state = str(result.get("loadState") or "unknown")
    active_state = str(result.get("activeState") or "unknown")
    sub_state = str(result.get("SubState") or result.get("subState") or "unknown")

    if load_state != "loaded":
        result["status"] = "down"
    elif active_state == "active" and sub_state == "running":
        result["status"] = "healthy"
    elif active_state in {"activating", "reloading"} or sub_state in {"start", "auto-restart", "reload"}:
        result["status"] = "degraded"
    elif active_state in {"inactive", "failed"} or sub_state in {"dead", "failed", "exited"}:
        result["status"] = "down"
    else:
        result["status"] = "unknown"
    return result


def count_processes(process_name: str) -> int:
    if not process_name:
        return 0
    code, stdout, _ = run_command(["pgrep", "-x", process_name])
    if code != 0 or not stdout:
        return 0
    return len([line for line in stdout.splitlines() if line.strip()])


def combine_message(parts: List[str]) -> str:
    return " | ".join([part for part in parts if part])


def restart_services(target: str, probe_service_name: str, engine_service_name: str) -> Tuple[bool, str, List[str]]:
    service_map = {
        "probe": [probe_service_name],
        "engine": [engine_service_name],
        "all": [probe_service_name, engine_service_name],
    }
    units = service_map.get(target)
    if not units:
        return False, f"unsupported restart target: {target}", []

    restarted: List[str] = []
    for unit in units:
        code, stdout, stderr = run_command(["systemctl", "restart", unit], timeout=30)
        if code != 0:
            details = stderr or stdout or "systemctl restart failed"
            return False, f"restart {unit} failed: {details}", restarted
        restarted.append(unit)
    return True, f"restarted {', '.join(restarted)}", restarted


def read_cpu_usage() -> Dict[str, object]:
    global CPU_PREVIOUS
    try:
        with open("/proc/stat", "r", encoding="utf-8") as handle:
            first = handle.readline().strip().split()
        if not first or first[0] != "cpu":
            return {"usagePercent": None}
        values = [int(value) for value in first[1:]]
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        total = sum(values)
        usage_percent: Optional[float] = None
        if CPU_PREVIOUS is not None:
            previous_total, previous_idle = CPU_PREVIOUS
            total_delta = total - previous_total
            idle_delta = idle - previous_idle
            if total_delta > 0:
                usage_percent = round(max(0.0, min(100.0, 100.0 * (1.0 - idle_delta / total_delta))), 2)
        CPU_PREVIOUS = (total, idle)
        load1, load5, load15 = os.getloadavg()
        return {
            "usagePercent": usage_percent,
            "loadAverage": {"one": round(load1, 2), "five": round(load5, 2), "fifteen": round(load15, 2)},
        }
    except Exception as exc:  # pragma: no cover - depends on runtime
        return {"usagePercent": None, "error": str(exc)}


def read_memory_usage() -> Dict[str, object]:
    metrics: Dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            for line in handle:
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                number = value.strip().split()[0]
                if number.isdigit():
                    metrics[key] = int(number) * 1024
        total = metrics.get("MemTotal", 0)
        available = metrics.get("MemAvailable", 0)
        used = max(0, total - available)
        usage_percent = round((used / total) * 100, 2) if total else None
        return {
            "totalBytes": total,
            "availableBytes": available,
            "usedBytes": used,
            "usagePercent": usage_percent,
        }
    except Exception as exc:  # pragma: no cover - depends on runtime
        return {"error": str(exc)}


def read_disk_usage(path: str) -> Dict[str, object]:
    try:
        usage = shutil.disk_usage(path)
        usage_percent = round((usage.used / usage.total) * 100, 2) if usage.total else None
        return {
            "path": path,
            "totalBytes": usage.total,
            "usedBytes": usage.used,
            "freeBytes": usage.free,
            "usagePercent": usage_percent,
        }
    except Exception as exc:  # pragma: no cover - depends on runtime
        return {"path": path, "error": str(exc)}


def system_metrics(probe_prod_root: str) -> Dict[str, object]:
    return {
        "cpu": read_cpu_usage(),
        "memory": read_memory_usage(),
        "disk": {
            "root": read_disk_usage("/"),
            "probeProd": read_disk_usage(probe_prod_root),
        },
    }


def get_probe_prod_root() -> str:
    return env_text("SELK_PROBE_PROD_ROOT", "/opt/justsoc/probe-prod")


def get_asset_root() -> Path:
    explicit_root = env_text("SELK_ASSET_CONFIG_ROOT")
    if explicit_root:
        return Path(explicit_root)
    return Path(get_probe_prod_root()) / "assets"


def get_asset_current_file() -> Path:
    explicit = env_text("SELK_ASSET_CURRENT_FILE")
    if explicit:
        return Path(explicit)
    return get_asset_root() / "current" / "assets.yaml"


def get_asset_meta_file() -> Path:
    explicit = env_text("SELK_ASSET_META_FILE")
    if explicit:
        return Path(explicit)
    return get_asset_root() / "current" / "assets.meta.json"


def get_asset_history_dir() -> Path:
    explicit = env_text("SELK_ASSET_HISTORY_DIR")
    if explicit:
        return Path(explicit)
    return get_asset_root() / "history"


def get_asset_staging_dir() -> Path:
    explicit = env_text("SELK_ASSET_STAGING_DIR")
    if explicit:
        return Path(explicit)
    return get_asset_root() / "staging"


def ensure_asset_directories() -> None:
    get_asset_current_file().parent.mkdir(parents=True, exist_ok=True)
    get_asset_history_dir().mkdir(parents=True, exist_ok=True)
    get_asset_staging_dir().mkdir(parents=True, exist_ok=True)


def encode_history_key(version: str) -> str:
    encoded = base64.urlsafe_b64encode(version.encode("utf-8")).decode("ascii").rstrip("=")
    return encoded or "snapshot"


def load_json_file(path: Path) -> Optional[Dict[str, object]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(content)
        temp_name = handle.name
    os.replace(temp_name, path)


def write_json_atomic(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_name = handle.name
    os.replace(temp_name, path)


def validate_boolean(value: Any, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    raise ValueError(f"{field_name} must be a boolean")


def validate_asset_yaml(yaml_content: str, expected_version: Optional[str] = None) -> Dict[str, object]:
    require_yaml_module()
    parsed = yaml.safe_load(yaml_content)
    if not isinstance(parsed, dict):
        raise ValueError("asset YAML root must be a mapping")

    schema_version = parsed.get("schema_version")
    if not isinstance(schema_version, int) or isinstance(schema_version, bool) or schema_version < 1:
        raise ValueError("schema_version must be a positive integer")

    version = str(parsed.get("version") or "").strip()
    if not version:
        raise ValueError("version is required")
    if expected_version and expected_version != version:
        raise ValueError(f"payload version {expected_version} does not match YAML version {version}")

    entries = parsed.get("entries")
    if not isinstance(entries, list):
        raise ValueError("entries must be a list")

    asset_ids: set[str] = set()
    binding_ids: set[str] = set()
    asset_count = 0
    enabled_asset_count = 0
    binding_count = 0
    enabled_binding_count = 0
    internal_binding_count = 0
    external_binding_count = 0

    for asset_index, asset in enumerate(entries):
        if not isinstance(asset, dict):
            raise ValueError(f"entries[{asset_index}] must be a mapping")
        asset_id = str(asset.get("asset_id") or "").strip()
        asset_name = str(asset.get("asset_name") or "").strip()
        if not asset_id:
            raise ValueError(f"entries[{asset_index}].asset_id is required")
        if asset_id in asset_ids:
            raise ValueError(f"duplicate asset_id: {asset_id}")
        asset_ids.add(asset_id)
        if not asset_name:
            raise ValueError(f"entries[{asset_index}].asset_name is required")
        enabled = asset.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError(f"entries[{asset_index}].enabled must be a boolean")
        asset_count += 1
        if enabled:
            enabled_asset_count += 1

        bindings = asset.get("bindings")
        if not isinstance(bindings, list) or not bindings:
            raise ValueError(f"entries[{asset_index}].bindings must be a non-empty list")

        for binding_index, binding in enumerate(bindings):
            if not isinstance(binding, dict):
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}] must be a mapping")

            binding_id = str(binding.get("binding_id") or "").strip()
            match_type = str(binding.get("match_type") or "").strip().lower()
            match_value = str(binding.get("match_value") or "").strip()
            network_type = str(binding.get("network_type") or "").strip().lower()
            priority = binding.get("priority")
            binding_enabled = binding.get("enabled", True)

            if not binding_id:
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].binding_id is required")
            if binding_id in binding_ids:
                raise ValueError(f"duplicate binding_id: {binding_id}")
            binding_ids.add(binding_id)

            if match_type not in {"ip", "cidr"}:
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].match_type must be ip or cidr")
            if not match_value:
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].match_value is required")
            if network_type not in {"internal", "external"}:
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].network_type must be internal or external")
            if not isinstance(priority, int) or isinstance(priority, bool):
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].priority must be an integer")
            if not isinstance(binding_enabled, bool):
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].enabled must be a boolean")

            try:
                if match_type == "ip":
                    ipaddress.ip_address(match_value)
                else:
                    ipaddress.ip_network(match_value, strict=False)
            except ValueError as exc:
                raise ValueError(f"entries[{asset_index}].bindings[{binding_index}].match_value is invalid: {exc}") from exc

            binding_count += 1
            if binding_enabled:
                enabled_binding_count += 1
            if network_type == "internal":
                internal_binding_count += 1
            else:
                external_binding_count += 1

    return {
        "version": version,
        "schemaVersion": schema_version,
        "assetCount": asset_count,
        "enabledAssetCount": enabled_asset_count,
        "bindingCount": binding_count,
        "enabledBindingCount": enabled_binding_count,
        "internalBindingCount": internal_binding_count,
        "externalBindingCount": external_binding_count,
    }


def sanitize_requested_by(value: Any) -> Dict[str, str]:
    if not isinstance(value, dict):
        return {}
    result: Dict[str, str] = {}
    for key in ("userId", "username", "displayName"):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            result[key] = raw.strip()[:128]
    return result


def build_asset_meta(
    summary: Dict[str, object],
    request_payload: Dict[str, object],
    yaml_content: str,
    operation: str,
) -> Dict[str, object]:
    return {
        "documentId": str(request_payload.get("documentId") or "").strip(),
        "currentVersion": summary["version"],
        "schemaVersion": summary["schemaVersion"],
        "checksumSha256": json_hash(yaml_content),
        "assetCount": summary["assetCount"],
        "enabledAssetCount": summary["enabledAssetCount"],
        "bindingCount": summary["bindingCount"],
        "enabledBindingCount": summary["enabledBindingCount"],
        "internalBindingCount": summary["internalBindingCount"],
        "externalBindingCount": summary["externalBindingCount"],
        "appliedAt": now_iso(),
        "requestId": str(request_payload.get("requestId") or "").strip(),
        "reason": str(request_payload.get("reason") or "").strip(),
        "requestedBy": sanitize_requested_by(request_payload.get("requestedBy")),
        "operation": operation,
    }


def set_last_asset_operation(payload: Dict[str, object]) -> None:
    with STATE_LOCK:
        STATE["last_asset_operation"] = payload


def read_asset_status_snapshot() -> Dict[str, object]:
    current_file = get_asset_current_file()
    meta_file = get_asset_meta_file()
    meta = load_json_file(meta_file)
    current_snapshot = file_snapshot(str(current_file))
    result: Dict[str, object] = {
        "currentFile": str(current_file),
        "metaFile": str(meta_file),
        "historyDir": str(get_asset_history_dir()),
        "currentFileExists": current_snapshot.get("exists", False),
        "lastModifiedAt": current_snapshot.get("modifiedAt"),
    }
    if meta:
        result.update(meta)
    return result


def apply_asset_document(request_payload: Dict[str, object], operation: str = "apply") -> Dict[str, object]:
    yaml_content = str(request_payload.get("yamlContent") or "")
    if not yaml_content.strip():
        raise ValueError("yamlContent is required")

    expected_version = str(request_payload.get("version") or "").strip() or None
    summary = validate_asset_yaml(yaml_content, expected_version)
    ensure_asset_directories()

    current_file = get_asset_current_file()
    meta_file = get_asset_meta_file()
    history_key = encode_history_key(str(summary["version"]))
    history_yaml_file = get_asset_history_dir() / f"{history_key}.yaml"
    history_meta_file = get_asset_history_dir() / f"{history_key}.meta.json"

    meta = build_asset_meta(summary, request_payload, yaml_content, operation)
    write_text_atomic(current_file, yaml_content)
    write_json_atomic(meta_file, meta)
    write_text_atomic(history_yaml_file, yaml_content)
    write_json_atomic(history_meta_file, meta)

    set_last_asset_operation(
        {
            "status": "succeeded",
            "operation": operation,
            "version": summary["version"],
            "requestId": meta["requestId"],
            "appliedAt": meta["appliedAt"],
            "documentId": meta["documentId"],
        }
    )
    refresh_snapshot()
    return {
        "ok": True,
        "operation": operation,
        "summary": summary,
        "meta": meta,
    }


def rollback_asset_document(request_payload: Dict[str, object]) -> Dict[str, object]:
    version = str(request_payload.get("version") or "").strip()
    if not version:
        raise ValueError("version is required for rollback")

    history_key = encode_history_key(version)
    history_yaml_file = get_asset_history_dir() / f"{history_key}.yaml"
    history_meta_file = get_asset_history_dir() / f"{history_key}.meta.json"
    if not history_yaml_file.exists():
        raise FileNotFoundError(f"no history snapshot found for version {version}")

    rollback_payload = {
        "requestId": str(request_payload.get("requestId") or "").strip() or f"rollback-{history_key}",
        "documentId": str((load_json_file(history_meta_file) or {}).get("documentId") or request_payload.get("documentId") or "").strip(),
        "version": version,
        "yamlContent": history_yaml_file.read_text(encoding="utf-8"),
        "requestedBy": request_payload.get("requestedBy"),
        "reason": str(request_payload.get("reason") or "platform-rollback").strip(),
    }
    return apply_asset_document(rollback_payload, operation="rollback")


def get_dispatch_auth_mode() -> str:
    explicit = env_text("SELK_DISPATCH_AUTH_MODE").lower()
    if explicit:
        if explicit not in {"bearer", "hmac"}:
            raise ConfigError("SELK_DISPATCH_AUTH_MODE must be bearer or hmac")
        return explicit

    if env_text("SELK_DISPATCH_KEY_ID") or env_text("SELK_DISPATCH_SHARED_SECRET") or env_text("SELK_DISPATCH_SHARED_SECRET_FILE"):
        return "hmac"
    if env_text("SELK_DISPATCH_BEARER_TOKEN") or env_text("SELK_DISPATCH_BEARER_TOKEN_FILE") or env_text("SELK_RUNTIME_TOKEN"):
        return "bearer"
    raise ConfigError("dispatcher auth is not configured")


def get_dispatch_hmac_key_id() -> str:
    key_id = env_text("SELK_DISPATCH_KEY_ID")
    if not key_id:
        raise ConfigError("SELK_DISPATCH_KEY_ID must be configured for hmac auth")
    return key_id


def get_dispatch_hmac_secret() -> str:
    secret = read_secret_from_env_or_file("SELK_DISPATCH_SHARED_SECRET", "SELK_DISPATCH_SHARED_SECRET_FILE")
    if not secret:
        raise ConfigError("dispatcher hmac secret is not configured")
    return secret


def get_dispatch_bearer_token() -> str:
    token = read_secret_from_env_or_file("SELK_DISPATCH_BEARER_TOKEN", "SELK_DISPATCH_BEARER_TOKEN_FILE")
    if token:
        return token
    legacy_token = env_text("SELK_RUNTIME_TOKEN")
    if legacy_token:
        return legacy_token
    raise ConfigError("dispatcher bearer token is not configured")


def cleanup_nonce_cache(now_epoch: float) -> None:
    expired_keys = [nonce for nonce, expires_at in NONCE_CACHE.items() if expires_at <= now_epoch]
    for nonce in expired_keys:
        NONCE_CACHE.pop(nonce, None)


def verify_request_auth(headers, method: str, path: str, body_text: str) -> Tuple[bool, str]:
    try:
        mode = get_dispatch_auth_mode()
        if mode == "bearer":
            expected = get_dispatch_bearer_token()
            auth_header = headers.get("Authorization", "")
            provided = ""
            if auth_header.startswith("Bearer "):
                provided = auth_header[7:]
            elif headers.get("X-Selk-Token"):
                provided = headers.get("X-Selk-Token", "")
            if not provided or not hmac.compare_digest(provided, expected):
                return False, "invalid bearer token"
            return True, ""

        key_id = headers.get("X-Selk-Key-Id", "").strip()
        timestamp_raw = headers.get("X-Selk-Timestamp", "").strip()
        nonce = headers.get("X-Selk-Nonce", "").strip()
        signature = headers.get("X-Selk-Signature", "").strip().lower()
        body_sha256 = headers.get("Content-SHA256", "").strip().lower()
        if not key_id or not timestamp_raw or not nonce or not signature or not body_sha256:
            return False, "missing hmac authentication headers"

        expected_key_id = get_dispatch_hmac_key_id()
        if key_id != expected_key_id:
            return False, "unknown hmac key id"

        if body_sha256 != json_hash(body_text):
            return False, "content sha256 mismatch"

        try:
            timestamp = int(timestamp_raw)
        except ValueError:
            return False, "invalid timestamp"

        now_epoch = time.time()
        allowed_skew = max(30, env_int("SELK_DISPATCH_ALLOWED_SKEW_SECONDS", 300))
        if abs(now_epoch - timestamp) > allowed_skew:
            return False, "request timestamp outside allowed skew"

        with NONCE_LOCK:
            cleanup_nonce_cache(now_epoch)
            if nonce in NONCE_CACHE:
                return False, "nonce already used"
            NONCE_CACHE[nonce] = now_epoch + allowed_skew

        signing_string = "\n".join(
            [
                method.upper(),
                path,
                timestamp_raw,
                nonce,
                body_sha256,
            ]
        )
        expected_signature = hmac.new(
            get_dispatch_hmac_secret().encode("utf-8"),
            signing_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            return False, "invalid hmac signature"
        return True, ""
    except ConfigError as exc:
        return False, str(exc)


def collect_snapshot(last_command: Optional[Dict[str, object]] = None) -> Dict[str, object]:
    stale_after_seconds = env_int("SELK_RUNTIME_STALE_SECONDS", 300)
    probe_prod_root = get_probe_prod_root()
    probe_service_name = env_text("SELK_PROBE_SERVICE", "selk-probe.service")
    engine_service_name = env_text("SELK_ENGINE_SERVICE", "justsoc-threat-engine.service")
    probe_health_url = env_text("SELK_PROBE_HEALTH_URL", "http://127.0.0.1:8081/healthz")
    probe_ready_url = env_text("SELK_PROBE_READY_URL", "http://127.0.0.1:8081/readyz")
    probe_log_path = env_text("SELK_PROBE_LOG_PATH", "/var/log/selk/selk-probe.log")
    engine_log_path = env_text("SELK_ENGINE_LOG_PATH", "/var/log/selk/threat-engine.log")
    suricata_eve_path = env_text("SELK_SURICATA_EVE_PATH", "/var/log/suricata/eve.json")
    suricata_process = env_text("SELK_SURICATA_PROCESS", "suricata")
    status_path = env_text("SELK_RUNTIME_STATUS_PATH", "/run/selk/runtime-status.json")
    metrics_path = env_text("SELK_RUNTIME_METRICS_PATH", DEFAULT_METRICS_PATH)
    control_path = env_text("SELK_RUNTIME_CONTROL_PATH", DEFAULT_CONTROL_PATH)

    probe_unit = systemd_unit(probe_service_name)
    engine_unit = systemd_unit(engine_service_name)
    probe_health = http_check(probe_health_url)
    probe_ready = http_check(probe_ready_url)
    probe_log = file_snapshot(probe_log_path)
    engine_log = file_snapshot(engine_log_path)
    eve_log = file_snapshot(suricata_eve_path)
    eve_fresh = is_fresh(eve_log, stale_after_seconds)
    suricata_process_count = count_processes(suricata_process)
    assets_status = read_asset_status_snapshot()

    probe_parts = [
        f"systemd {probe_unit.get('activeState', 'unknown')}/{probe_unit.get('subState', 'unknown')}",
        "healthz ok" if probe_health.get("ok") else "healthz unavailable",
        "readyz ok" if probe_ready.get("ok") else "readyz unavailable",
    ]
    probe_status = "down"
    if probe_unit.get("status") == "healthy" and probe_health.get("ok") and probe_ready.get("ok"):
        probe_status = "healthy"
    elif probe_unit.get("status") in {"healthy", "degraded"}:
        probe_status = "degraded"

    probe_component = {
        "name": "Probe",
        "status": probe_status,
        "message": combine_message(probe_parts),
        "unit": probe_service_name,
        "activeState": probe_unit.get("activeState"),
        "subState": probe_unit.get("subState"),
        "pid": probe_unit.get("pid"),
        "startedAt": probe_unit.get("startedAt"),
        "lastActivityAt": eve_log.get("modifiedAt") or probe_log.get("modifiedAt"),
        "healthUrl": probe_health_url,
        "readyUrl": probe_ready_url,
        "logPath": probe_log_path,
        "evidencePath": suricata_eve_path,
    }

    engine_status = str(engine_unit.get("status") or "unknown")
    engine_component = {
        "name": "Threat Engine",
        "status": engine_status,
        "message": combine_message([
            f"systemd {engine_unit.get('activeState', 'unknown')}/{engine_unit.get('subState', 'unknown')}",
            "status derived from systemd",
        ]),
        "unit": engine_service_name,
        "activeState": engine_unit.get("activeState"),
        "subState": engine_unit.get("subState"),
        "pid": engine_unit.get("pid"),
        "startedAt": engine_unit.get("startedAt"),
        "lastActivityAt": engine_log.get("modifiedAt"),
        "logPath": engine_log_path,
    }

    suricata_status = "down"
    if suricata_process_count > 0 and eve_fresh:
        suricata_status = "healthy"
    elif suricata_process_count > 0 or probe_status in {"healthy", "degraded"}:
        suricata_status = "degraded"

    suricata_component = {
        "name": "Suricata",
        "status": suricata_status,
        "message": combine_message([
            f"processes={suricata_process_count}",
            "eve.json fresh" if eve_fresh else "eve.json stale",
        ]),
        "processName": suricata_process,
        "lastActivityAt": eve_log.get("modifiedAt"),
        "evidencePath": suricata_eve_path,
    }

    kafka_status = "down"
    kafka_message = "probe and engine are not both healthy"
    if probe_status == "healthy" and engine_status == "healthy" and eve_fresh:
        kafka_status = "healthy"
        kafka_message = "probe, engine, and eve.json look healthy"
    elif probe_status in {"healthy", "degraded"} or engine_status in {"healthy", "degraded"}:
        kafka_status = "degraded"
        kafka_message = "chain health inferred from process and file activity"

    kafka_component = {
        "name": "Kafka Chain",
        "status": kafka_status,
        "message": kafka_message,
        "lastActivityAt": eve_log.get("modifiedAt") or engine_log.get("modifiedAt") or probe_log.get("modifiedAt"),
    }

    return {
        "generatedAt": now_iso(),
        "probeProdRoot": probe_prod_root,
        "statusPath": status_path,
        "metricsPath": metrics_path,
        "controlPath": control_path,
        "lastCommand": last_command,
        "lastAssetOperation": STATE.get("last_asset_operation"),
        "system": system_metrics(probe_prod_root),
        "assets": assets_status,
        "probe": probe_component,
        "engine": engine_component,
        "suricata": suricata_component,
        "kafka": kafka_component,
    }


def write_status(path: str, payload: Dict[str, object]) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(destination, payload)


def refresh_snapshot() -> Dict[str, object]:
    with STATE_LOCK:
        snapshot = collect_snapshot(last_command=STATE.get("last_command") if isinstance(STATE.get("last_command"), dict) else None)
        STATE["snapshot"] = snapshot
    status_path = env_text("SELK_RUNTIME_STATUS_PATH", "/run/selk/runtime-status.json")
    write_status(status_path, snapshot)
    return snapshot


class ProbeDispatcherHandler(BaseHTTPRequestHandler):
    server_version = "JustSocProbeDispatcher/1.0"

    def _json(self, status_code: int, payload: Dict[str, object]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _parse_json_body(self) -> Tuple[str, Dict[str, object]]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        body_text = raw_body.decode("utf-8") if raw_body else "{}"
        payload = json.loads(body_text) if body_text else {}
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return body_text, payload

    def _authorize(self, body_text: str = "") -> bool:
        path = urlsplit(self.path).path
        ok, error_message = verify_request_auth(self.headers, self.command, path, body_text)
        if ok:
            return True

        status = HTTPStatus.UNAUTHORIZED
        if "configured" in error_message:
            status = HTTPStatus.INTERNAL_SERVER_ERROR
        self._json(status, {"error": "unauthorized", "message": error_message})
        return False

    def log_message(self, format, *args):  # pragma: no cover - silence default HTTP logs
        return

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        metrics_path = env_text("SELK_RUNTIME_METRICS_PATH", DEFAULT_METRICS_PATH)
        asset_status_path = env_text("SELK_ASSET_STATUS_PATH", DEFAULT_ASSET_STATUS_PATH)

        if path == metrics_path:
            if not self._authorize():
                return
            with STATE_LOCK:
                snapshot = STATE.get("snapshot") if isinstance(STATE.get("snapshot"), dict) else {}
            if not snapshot:
                snapshot = refresh_snapshot()
            self._json(HTTPStatus.OK, snapshot)
            return

        if path == asset_status_path:
            if not self._authorize():
                return
            with STATE_LOCK:
                last_asset_operation = STATE.get("last_asset_operation")
            self._json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "authMode": get_dispatch_auth_mode(),
                    "assets": read_asset_status_snapshot(),
                    "lastAssetOperation": last_asset_operation,
                },
            )
            return

        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        control_path = env_text("SELK_RUNTIME_CONTROL_PATH", DEFAULT_CONTROL_PATH)
        asset_apply_path = env_text("SELK_ASSET_APPLY_PATH", DEFAULT_ASSET_APPLY_PATH)
        asset_validate_path = env_text("SELK_ASSET_VALIDATE_PATH", DEFAULT_ASSET_VALIDATE_PATH)
        asset_rollback_path = env_text("SELK_ASSET_ROLLBACK_PATH", DEFAULT_ASSET_ROLLBACK_PATH)

        if path == control_path:
            try:
                body_text, payload = self._parse_json_body()
            except Exception:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
                return
            if not self._authorize(body_text):
                return

            action = str(payload.get("action") or "restart").strip().lower()
            target = str(payload.get("target") or "").strip().lower()
            reason = str(payload.get("reason") or "manual").strip() or "manual"
            if action != "restart":
                self._json(HTTPStatus.BAD_REQUEST, {"error": "unsupported_action", "message": f"unsupported action: {action}"})
                return
            if target not in {"probe", "engine", "all"}:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "unsupported_target", "message": f"unsupported target: {target}"})
                return

            probe_service_name = env_text("SELK_PROBE_SERVICE", "selk-probe.service")
            engine_service_name = env_text("SELK_ENGINE_SERVICE", "justsoc-threat-engine.service")
            ok, message, units = restart_services(target, probe_service_name, engine_service_name)
            command_result = {
                "executedAt": now_iso(),
                "requestedAt": now_iso(),
                "action": action,
                "target": target,
                "reason": reason,
                "message": message,
                "status": "succeeded" if ok else "failed",
                "units": units,
            }
            with STATE_LOCK:
                STATE["last_command"] = command_result
            snapshot = refresh_snapshot()
            self._json(HTTPStatus.OK if ok else HTTPStatus.INTERNAL_SERVER_ERROR, {"command": command_result, "snapshot": snapshot})
            return

        try:
            body_text, payload = self._parse_json_body()
        except Exception:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return

        if path in {asset_apply_path, asset_validate_path, asset_rollback_path}:
            if not self._authorize(body_text):
                return

            try:
                if path == asset_validate_path:
                    yaml_content = str(payload.get("yamlContent") or "")
                    expected_version = str(payload.get("version") or "").strip() or None
                    summary = validate_asset_yaml(yaml_content, expected_version)
                    self._json(HTTPStatus.OK, {"ok": True, "summary": summary})
                    return

                if path == asset_apply_path:
                    result = apply_asset_document(payload, operation="apply")
                    self._json(HTTPStatus.OK, result)
                    return

                result = rollback_asset_document(payload)
                self._json(HTTPStatus.OK, result)
                return
            except FileNotFoundError as exc:
                set_last_asset_operation({"status": "failed", "operation": "rollback", "message": str(exc), "at": now_iso()})
                self._json(HTTPStatus.NOT_FOUND, {"error": "asset_history_not_found", "message": str(exc)})
                return
            except (ConfigError, ValueError) as exc:
                set_last_asset_operation({"status": "failed", "operation": "asset", "message": str(exc), "at": now_iso()})
                self._json(HTTPStatus.BAD_REQUEST, {"error": "asset_validation_failed", "message": str(exc)})
                return
            except Exception as exc:  # pragma: no cover - depends on runtime
                set_last_asset_operation({"status": "failed", "operation": "asset", "message": str(exc), "at": now_iso()})
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "asset_apply_failed", "message": str(exc)})
                return

        self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})


def polling_loop() -> None:
    interval_seconds = max(60, env_int("SELK_RUNTIME_POLL_SECONDS", 60))
    while RUNNING:
        refresh_snapshot()
        for _ in range(interval_seconds):
            if not RUNNING:
                break
            time.sleep(1)


def handle_signal(_signum, _frame) -> None:
    global RUNNING
    RUNNING = False
    if HTTP_SERVER is not None:
        try:
            HTTP_SERVER.shutdown()
        except Exception:
            pass


def validate_startup_configuration() -> None:
    require_yaml_module()
    mode = get_dispatch_auth_mode()
    if mode == "hmac":
        get_dispatch_hmac_key_id()
        get_dispatch_hmac_secret()
    else:
        get_dispatch_bearer_token()
    ensure_asset_directories()


def main() -> int:
    global HTTP_SERVER
    validate_startup_configuration()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    refresh_snapshot()
    polling_thread = threading.Thread(target=polling_loop, daemon=True)
    polling_thread.start()

    bind_host = env_text("SELK_RUNTIME_BIND", "0.0.0.0")
    bind_port = max(1, env_int("SELK_RUNTIME_PORT", 19091))
    HTTP_SERVER = ThreadingHTTPServer((bind_host, bind_port), ProbeDispatcherHandler)

    try:
        HTTP_SERVER.serve_forever(poll_interval=0.5)
    finally:
        HTTP_SERVER.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())