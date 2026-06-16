#!/usr/bin/env sh
# =============================================================================
# Kafka 容器入口脚本（由 docker-compose.yml 挂载到 /selk-scripts/ 并调用）
#
# 职责：
#   1. 用环境变量 SASL_USERNAME / SASL_PASSWORD 动态生成 broker 的 JAAS 配置
#   2. exec 回官方镜像的启动脚本 /etc/kafka/docker/run
#
# 之所以抽成脚本：原 docker-compose.yml 里的 heredoc 在 yaml + compose 双层转义下
# 容易出现变量展开错位；放文件里最可靠。
# =============================================================================
set -eu

JAAS_PATH="${JAAS_PATH:-/tmp/kafka_server_jaas.conf}"

if [ -z "${SASL_USERNAME:-}" ] || [ -z "${SASL_PASSWORD:-}" ]; then
  echo "[kafka-entrypoint] SASL_USERNAME / SASL_PASSWORD not set" >&2
  exit 1
fi

echo "[kafka-entrypoint] writing JAAS -> $JAAS_PATH (user=$SASL_USERNAME)"
cat > "$JAAS_PATH" <<EOF
KafkaServer {
  org.apache.kafka.common.security.plain.PlainLoginModule required
  username="${SASL_USERNAME}"
  password="${SASL_PASSWORD}"
  user_${SASL_USERNAME}="${SASL_PASSWORD}";
};
EOF

exec /etc/kafka/docker/run
