#!/usr/bin/env sh
# =============================================================================
# Kafka topic 初始化脚本（由 docker-compose.yml 挂载到 /selk-scripts/ 并调用）
#
# 职责：
#   1. 生成 SASL/PLAIN 客户端配置 client.properties
#   2. 轮询等待 kafka broker 起来
#   3. 创建项目所需的 3 个 topic（已存在则跳过）
#   4. 退出（restart: "no"，不再拉起）
# =============================================================================
set -eu

BOOTSTRAP="${BOOTSTRAP:-kafka:9092}"
CLIENT_PROPS="${CLIENT_PROPS:-/tmp/client.properties}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-60}"

# kafka-topics.sh 的完整路径（官方镜像里在 /opt/kafka/bin/）
KAFKA_BIN="${KAFKA_BIN:-/opt/kafka/bin}"
KAFKA_TOPICS="$KAFKA_BIN/kafka-topics.sh"

if [ ! -x "$KAFKA_TOPICS" ]; then
  # 回退：尝试 PATH 里找
  KAFKA_TOPICS="$(command -v kafka-topics.sh 2>/dev/null || true)"
  if [ -z "$KAFKA_TOPICS" ]; then
    echo "[kafka-init-topics] kafka-topics.sh not found" >&2
    exit 1
  fi
fi

if [ -z "${SASL_USERNAME:-}" ] || [ -z "${SASL_PASSWORD:-}" ]; then
  echo "[kafka-init-topics] SASL_USERNAME / SASL_PASSWORD not set" >&2
  exit 1
fi

echo "[kafka-init-topics] writing client.properties -> $CLIENT_PROPS"
cat > "$CLIENT_PROPS" <<EOF
security.protocol=SASL_PLAINTEXT
sasl.mechanism=PLAIN
sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="${SASL_USERNAME}" password="${SASL_PASSWORD}";
EOF

echo "[kafka-init-topics] waiting for broker at $BOOTSTRAP (timeout=${WAIT_TIMEOUT}s)..."
elapsed=0
until "$KAFKA_TOPICS" --bootstrap-server "$BOOTSTRAP" --command-config "$CLIENT_PROPS" --list >/dev/null 2>&1; do
  sleep 2
  elapsed=$((elapsed + 2))
  if [ "$elapsed" -ge "$WAIT_TIMEOUT" ]; then
    echo "[kafka-init-topics] broker not ready after ${WAIT_TIMEOUT}s, abort" >&2
    exit 1
  fi
  echo "  ... still waiting (${elapsed}s)"
done
echo "[kafka-init-topics] broker is up"

create_topic() {
  name="$1"
  retention="$2"
  echo "[kafka-init-topics] ensuring topic: $name (retention.ms=$retention)"
  "$KAFKA_TOPICS" \
    --bootstrap-server "$BOOTSTRAP" \
    --command-config "$CLIENT_PROPS" \
    --create --if-not-exists \
    --topic "$name" \
    --partitions 1 \
    --replication-factor 1 \
    --config "retention.ms=$retention"
}

create_topic "selk.alerts.enriched" "3600000"
create_topic "selk.suricata.eve"   "3600000"
create_topic "selk.eve.raw"        "3600000"

echo "[kafka-init-topics] done"
