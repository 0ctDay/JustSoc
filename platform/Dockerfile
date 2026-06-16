# =============================================================================
# JustSoc Platform 镜像 —— Next.js 控制台 + Claude Code Bridge 同容器运行
#
# 单容器内由 supervisord(PID1) 管理两个进程：
#   - platform : Next.js standalone，对外 :3000
#   - bridge   : Claude Code Bridge，仅容器内 127.0.0.1:4317
# 设置页「重启 Bridge」通过 supervisorctl restart bridge 实现。
#
# 构建上下文为 ./platform，Bridge 源码位于 ./claude-code-bridge 子目录。
# =============================================================================

# ---- 平台依赖 ---------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 平台构建 (Next.js standalone) -----------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Bridge 构建 ------------------------------------------------------------
FROM node:22-alpine AS bridge-build
WORKDIR /build
# 故意不复制 package-lock.json：它在 Windows 上生成、只锁了 win32-x64 一个平台节点，
# 缺 linux 平台条目。一旦 lockfile 存在，npm(ci/install) 都会认为锁文件完整、不再补加
# 缺失平台的 optional 包，于是在 Alpine 上跳过 Claude Agent SDK 的原生 CLI
# (linux-x64-musl 这个平台相关 optionalDependency)，运行时即报 binary not found。
# 不带 lockfile 时让 npm install 在目标平台(alpine/musl)上自由解析，从而装上 musl 二进制。
COPY claude-code-bridge/package.json claude-code-bridge/tsconfig.json ./
RUN npm install \
 && test -d node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl
COPY claude-code-bridge/src ./src
COPY claude-code-bridge/public ./public
COPY claude-code-bridge/workspace ./workspace
RUN npm run build
# 注意：不要 `npm prune --omit=dev`。Claude Agent SDK 的原生 CLI 以平台相关的
# optionalDependency(@anthropic-ai/claude-agent-sdk-linux-x64-musl) 形式安装，
# prune/--omit 会把它一并删掉，导致运行时报
# "Native CLI binary for linux-x64 not found"。保留完整 node_modules。

# ---- 运行时 -----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# supervisord 管理 Next.js 与 Bridge；libstdc++ 供 Claude Code 原生 CLI(musl) 运行
RUN apk add --no-cache supervisor libstdc++

# 平台 standalone 产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Bridge 产物（含已裁剪的生产依赖、编译产物、静态页与 workspace）
COPY --from=bridge-build /build/package.json ./claude-code-bridge/package.json
COPY --from=bridge-build /build/node_modules ./claude-code-bridge/node_modules
COPY --from=bridge-build /build/dist ./claude-code-bridge/dist
COPY --from=bridge-build /build/public ./claude-code-bridge/public
COPY --from=bridge-build /build/workspace ./claude-code-bridge/workspace

# supervisor 配置
COPY deploy/supervisord.conf /etc/supervisord.conf

# Bridge 运行期需写 data/、workspace/；非 root 的 node 用户也要能用 supervisorctl(socket 在 /var/run)
RUN mkdir -p /app/claude-code-bridge/data/tasks \
 && chown -R node:node /app/claude-code-bridge/data /app/claude-code-bridge/workspace /var/run

# supervisord 需以 root 启动，再以 user=node 派生两个子进程（见 supervisord.conf）
EXPOSE 3000

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
