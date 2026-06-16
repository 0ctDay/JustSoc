#!/usr/bin/env bash
# =============================================================================
# JustSoc 应用层一键启动脚本
#
#   1) 前置检查 docker / docker compose
#   2) 交互式填写 Kafka 接入参数（须与探针侧 rules-engine/deploy/.env 一致）
#   3) 基于 .env.example 生成 / 更新 .env（控制面 DB 密码自动随机生成）
#   4) 先 docker compose build 构建镜像，构建成功后再 up -d 启动容器
#
# 用法:
#   ./start.sh        交互式配置 → 构建镜像 → 启动
#   ./start.sh -b     构建镜像时不使用缓存 (--no-cache)
#   ./start.sh -y     复用已有 .env，跳过交互
#
# 首次使用: chmod +x start.sh && ./start.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

REBUILD=0
ASSUME_YES=0
while getopts ":by" opt; do
  case "$opt" in
    b) REBUILD=1 ;;
    y) ASSUME_YES=1 ;;
    *) echo "未知选项: -$OPTARG" >&2; exit 1 ;;
  esac
done

# ---- 输出着色 ---------------------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_RST=$'\e[0m'
else
  C_OK=; C_WARN=; C_ERR=; C_RST=
fi
info() { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_OK" "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RST" "$*"; }
die()  { printf '%s✗ %s%s\n' "$C_ERR" "$*" "$C_RST" >&2; exit 1; }

# ---- 0. 前置检查 ------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "未找到 docker，请先安装 Docker。"
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "未找到 docker compose（需要 v2 插件或 docker-compose）。"
fi
[ -f "$ENV_EXAMPLE" ] || die "缺少 $ENV_EXAMPLE，请在仓库根目录运行本脚本。"

# ---- 工具函数 ---------------------------------------------------------------
# 读取 .env 中某 KEY 的当前值（取不到返回空，不触发 set -e）
env_val() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

# 占位符 (<...>) 视作未设置
clean_default() { case "$1" in *"<"*) printf '' ;; *) printf '%s' "$1" ;; esac; }

# 原地更新 / 追加 .env 中的 KEY=VALUE（值通过 awk 变量传入，特殊字符安全）
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" 'index($0,k"=")==1{print k"="v;next}{print}' \
        "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# ---- 1. 是否需要（重新）配置 ------------------------------------------------
RECONFIG=1
if [ -f "$ENV_FILE" ]; then
  if [ "$ASSUME_YES" -eq 1 ]; then
    RECONFIG=0
  else
    printf '检测到已存在 %s，是否重新配置 Kafka 参数? [y/N] ' "$ENV_FILE"
    read -r ans || ans=""
    case "$ans" in [yY]*) RECONFIG=1 ;; *) RECONFIG=0 ;; esac
  fi
fi

# ---- 2. 交互式填写 Kafka 参数 ----------------------------------------------
if [ "$RECONFIG" -eq 1 ]; then
  [ -f "$ENV_FILE" ] || cp "$ENV_EXAMPLE" "$ENV_FILE"

  info ""
  info "==== 配置 Kafka 接入参数（须与探针侧 rules-engine/deploy/.env 完全一致）===="

  # 2.1 对外地址 host:port
  d_boot="$(clean_default "$(env_val KAFKA_BOOTSTRAP)")"
  while :; do
    printf 'Kafka 对外地址 host:port (例 10.0.0.5:9092)%s: ' "${d_boot:+ [$d_boot]}"
    read -r in_boot || in_boot=""
    in_boot="${in_boot:-$d_boot}"
    [ -n "$in_boot" ] || { warn "不能为空"; continue; }
    case "$in_boot" in
      *:*) : ;;
      *) warn "需要 host:port 格式（带端口）"; continue ;;
    esac
    case "$in_boot" in
      127.0.0.1:*|localhost:*)
        warn "指向本机，logstash 容器通常连不到远程探针，确认无误再继续。" ;;
    esac
    break
  done

  # 2.2 SASL 用户名
  d_user="$(clean_default "$(env_val KAFKA_SASL_USERNAME)")"; d_user="${d_user:-kafka}"
  printf 'Kafka SASL 用户名 [%s]: ' "$d_user"
  read -r in_user || in_user=""
  in_user="${in_user:-$d_user}"

  # 2.3 SASL 密码（隐藏输入 + 二次确认）
  while :; do
    printf 'Kafka SASL 密码 (输入不回显): '
    read -rs in_pass || in_pass=""; echo
    [ -n "$in_pass" ] || { warn "不能为空"; continue; }
    [ "$in_pass" != "<change-me>" ] || { warn "请填写真实密码"; continue; }
    case "$in_pass" in *'$'*) warn "密码含 \$，在 .env 中可能被 compose 解析，建议避免或自行转义。";; esac
    printf '再次确认密码: '
    read -rs in_pass2 || in_pass2=""; echo
    [ "$in_pass" = "$in_pass2" ] || { warn "两次输入不一致，请重试。"; continue; }
    break
  done

  set_env KAFKA_BOOTSTRAP     "$in_boot"
  set_env KAFKA_SASL_USERNAME "$in_user"
  set_env KAFKA_SASL_PASSWORD "$in_pass"

  # 2.4 控制面 DB 密码：仍是占位符 / 空 则随机生成（仅容器内部使用）
  cur_pg="$(env_val POSTGRES_PASSWORD)"
  case "$cur_pg" in
    ""|"<change-me>")
      gen_pg="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 24 || true)"
      [ -n "$gen_pg" ] || gen_pg="selk$(date +%s)"
      set_env POSTGRES_PASSWORD "$gen_pg"
      ok "已为控制面数据库生成随机密码并写入 $ENV_FILE"
      ;;
  esac

  ok "Kafka 参数已写入 $ENV_FILE"
  info "提示：AI 分析相关项 (SELK_AI_* / ANTHROPIC_API_KEY) 如需使用，请手动编辑 $ENV_FILE。"
else
  ok "复用已有 $ENV_FILE"
fi

# ---- 2.6 确保会话令牌签名密钥 SELK_AUTH_SECRET（≥24 字符）---------------------
# 无论是否重新配置都执行：给缺失该项的旧 .env 自动补齐，否则平台登录会报错。
cur_secret="$(env_val SELK_AUTH_SECRET)"
if [ -z "$cur_secret" ] || [ "${#cur_secret}" -lt 24 ] || [ "$cur_secret" = "<change-me>" ]; then
  gen_secret="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 48 || true)"
  [ -n "$gen_secret" ] || gen_secret="selkauthsecret$(date +%s)$RANDOM$RANDOM"
  set_env SELK_AUTH_SECRET "$gen_secret"
  ok "已生成会话令牌签名密钥 SELK_AUTH_SECRET 并写入 $ENV_FILE"
fi

# ---- 2.7 预拉取基础镜像（带重试）-------------------------------------------
# 某些网络/镜像源下直接 build 会偶发
#   failed to resolve source metadata for docker.io/library/node:22-alpine ...
#   failed size validation: <a> != <b>: failed precondition
# 这是基础镜像层下载到本地 content store 时被截断/校验失败。先单独 pull、失败重试，
# 把损坏的层重新拉全，再进入 build 阶段就不会再报该错。
BASE_IMAGES="node:22-alpine postgres:16-alpine elasticsearch:8.12.2 logstash:8.12.2 kibana:8.12.2"
pull_with_retry() {
  local img="$1" n
  for n in 1 2 3; do
    if docker pull "$img"; then
      return 0
    fi
    warn "拉取 $img 失败（第 $n/3 次），5s 后重试…"
    sleep 5
  done
  return 1
}
info ""
info "==== 预拉取基础镜像 ===="
for _img in $BASE_IMAGES; do
  pull_with_retry "$_img" || die "基础镜像 $_img 拉取失败，请检查网络/镜像源后重试。"
done
ok "基础镜像就绪"

# ---- 3. 先构建镜像（构建失败则不会进入启动阶段，set -e 直接退出）-----------
info ""
info "==== 构建镜像 ($DC build) ===="
if [ "$REBUILD" -eq 1 ]; then
  $DC --env-file "$ENV_FILE" build --no-cache
else
  $DC --env-file "$ENV_FILE" build
fi
ok "镜像构建完成"

# ---- 4. 构建成功后再启动容器 ------------------------------------------------
info ""
info "==== 启动应用层服务 ($DC up) ===="
$DC --env-file "$ENV_FILE" up -d

info ""
$DC ps

PPORT="$(clean_default "$(env_val PLATFORM_PORT)")"; PPORT="${PPORT:-3000}"

info ""
ok "启动完成。常用入口（把 localhost 换成服务器 IP）:"
info "  Platform : http://localhost:$PPORT"
info "  Kibana   : http://localhost:5601"
info "  （Claude Code Bridge 已并入平台容器，仅容器内 127.0.0.1:4317）"
info ""
info "查看日志: $DC logs -f logstash      # 确认 Kafka 消费是否正常"
info "停止服务: $DC down"
