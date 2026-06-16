# Claude Code Bridge

涓€涓嫭绔嬬殑 TypeScript 瀛愰」鐩紝鐢ㄥ畼鏂?Claude Agent SDK 椹卞姩鍐呯疆 Claude Code锛屽苟榛樿鎸傝浇浠撳簱鐜版湁鐨?Elasticsearch MCP锛?
- API 浼樺厛锛氬悗绔彁渚涗换鍔″垱寤恒€佺画鑱娿€丼SE 杈撳嚭娴併€佸鎵?闂瓟鍝嶅簲銆佷腑鏂帴鍙?- Web 娴嬭瘯鍙帮細鍗曢〉闈欐€佸墠绔紝鏂逛究鐩存帴鍦ㄦ祻瑙堝櫒閲屼笅鍙戜换鍔″拰瑙傚療 Claude Code 浜や簰
- 杩愯鏃跺彲閰嶏細鏀寔閰嶇疆 `model`銆乣permissionMode`銆乣maxTurns`銆丆laude 杩愯鏃剁幆澧冨彉閲忋€丒S MCP 璁よ瘉鍙傛暟锛涘伐浣滅洰褰曞浐瀹氫负褰撳墠鐩綍涓嬬殑 `workspace/`

## 鐩綍

```text
claude-code-bridge/
  package.json
  tsconfig.json
  public/
    index.html
    app.js
    styles.css
  src/
    server.ts
    lib/
      task-manager.ts
      task-store.ts
      types.ts
    types/
      anthropic-sdk.d.ts
  data/
    tasks/
```

## API

- `GET /api/health`
- `GET /api/defaults`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:taskId`
- `GET /api/tasks/:taskId/events`
- `POST /api/tasks/:taskId/messages`
- `POST /api/tasks/:taskId/decision`
- `POST /api/tasks/:taskId/interrupt`
- `GET /api/tasks/:taskId/session-info`

Detailed API reference: `docs/api.md`

## 鍚姩

```bash
cd claude-code-bridge
npm install
npm run dev
```

寮€鍙戞ā寮忎細鐩存帴鐩戝惉 `src/**/*.ts` 骞惰嚜鍔ㄩ噸鍚€?
鐢熶骇妯″紡锛?
```bash
npm run build
npm start
```

榛樿鐩戝惉 `0.0.0.0:4317`銆?
## 杩愯瑕佹眰

- Node.js 22+
- 瀹夎 `@anthropic-ai/claude-agent-sdk`
- Claude 渚ц璇佸彲閫氳繃鏈満 Claude Code / Anthropic 鐩稿叧鐜鍙橀噺鎻愪緵

## 璁捐璇存槑

### 1. Claude Code 鎺ュ叆

- 閫氳繃瀹樻柟 SDK 鍙戣捣 `query()`
- 棣栬疆浠诲姟鍜屽悗缁画鑱婇兘缁戝畾鍒板悓涓€涓?Claude session id
- 榛樿鍚敤 `tools: { type: "preset", preset: "claude_code" }`
- 榛樿鍚敤 `systemPrompt: { type: "preset", preset: "claude_code" }`

### 2. MCP 鎺ュ叆

- 榛樿鎸傝浇 `workspace/scripts/es-mcp-server.mjs`
- 榛樿 ES 鍦板潃浼氳鍙?`workspace/.claude/.mcp.json` 涓殑 `SELK_ES_ENDPOINT`
- 鍙湪椤甸潰閲岃鐩?endpoint銆丄PI key銆乥earer token銆乥asic auth銆乧ustom headers
- 椤甸潰閲岀殑 ES MCP 閰嶇疆鍙褰撳墠浠诲姟鐢熸晥锛屼笉浼氬啓鍥?`workspace/.claude/.mcp.json`
- 椤甸潰閲岀殑鏁忔劅 ES 閰嶇疆鍙細浣滀负 MCP 瀛愯繘绋嬬幆澧冨彉閲忎娇鐢紱浠诲姟蹇収鍙繚鐣欒劚鏁忕姸鎬侊紝鏈嶅姟閲嶅惎鍚庝笉浼氭仮澶嶆槑鏂?secret

### 2.1 鍙厤缃」涓€瑙?
- 鍥哄畾椤癸細
  - Claude 宸ヤ綔鐩綍鍥哄畾涓哄綋鍓嶇洰褰曚笅鐨?`workspace/`
- 椤圭洰绾ч粯璁ら」锛?  - `workspace/.claude/.mcp.json`
    - 鍐呯疆 ES MCP 鐨勯粯璁?`SELK_ES_ENDPOINT`
  - `workspace/.claude/settings.local.json`
    - Claude Code 鐨?project-local 璁剧疆
  - `workspace/scripts/es-mcp-server.mjs`
    - 鍐呯疆 ES MCP 鑴氭湰浣嶇疆
- 椤甸潰鎴?API 鐨勪换鍔＄骇杩愯鏃堕」锛?  - `additionalDirectories`
  - `model`
  - `permissionMode`
  - `effort`
  - `maxTurns`
  - `systemPromptAppend`
  - `debug`
  - `strictMcpConfig`
  - `loadSettings.user|project|local`
  - `envVars`
  - `allowedTools` / `disallowedTools`
  - `elasticsearch.enabled`
  - `elasticsearch.endpoint`
  - `elasticsearch.apiKey|bearerToken|username|password|headersJson`
- 鎸佷箙鍖栬涓猴細
  - 浠诲姟蹇収浼氫繚鐣欒劚鏁忓悗鐨勮繍琛岄厤缃拰闈炴晱鎰熷瓧娈?  - `envVars` 鐨勫€硷紝浠ュ強 ES 鐨?`apiKey`銆乣bearerToken`銆乣password`銆乣headersJson` 涓嶄細鏄庢枃钀界洏
  - 杩欎簺鏁忔劅鍊煎彧鍦ㄥ綋鍓嶆湇鍔¤繘绋嬪拰 MCP 瀛愯繘绋嬬幆澧冨彉閲忛噷鐢熸晥锛屾湇鍔￠噸鍚悗涓嶄細鑷姩鎭㈠

### 3. Web 浜や簰

- Claude 杈撳嚭閫氳繃 SSE 鎺ㄥ埌娴忚鍣?- 宸ュ叿瀹℃壒鍜?`AskUserQuestion` 浼氬湪椤甸潰涓婄敓鎴愪氦浜掑崱鐗?- 鐢ㄦ埛鎵瑰噯 / 鎷掔粷 / 鎻愪氦鍥炵瓟鍚庯紝鍚庣浼氱户缁綋鍓?run

### 4. 鐜鍙橀噺澶勭悊

- 鍓嶇鍙互涓烘瘡娆′换鍔℃彁浜?`envVars`
- 鍚庣浼氭妸杩欎簺鍙橀噺娉ㄥ叆 Claude 杩愯鏃?- 鍊间笉浼氬湪鍚庣画浠诲姟蹇収閲屽師鏍峰洖鏄撅紝鍙繚鐣欏彉閲忓悕鍒楄〃

## 绀轰緥

### 鍒涘缓浠诲姟

```bash
curl -X POST http://localhost:4317/api/tasks ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"妫€鏌?platform 鐩綍閲岀殑 API 璺敱璁捐\",\"config\":{\"permissionMode\":\"default\"}}"
```

### 缁х画鍙戦€佹秷鎭?
```bash
curl -X POST http://localhost:4317/api/tasks/<taskId>/messages ^
  -H "Content-Type: application/json" ^
  -d "{\"content\":\"缁х画锛屾妸淇鏂规鏁寸悊鎴愬彲鎵ц姝ラ\"}"
```

### 鐩戝惉 SSE

```bash
curl http://localhost:4317/api/tasks/<taskId>/events
```

## 褰撳墠楠岃瘉

鏈湴宸插畬鎴愯繖浜涢獙璇侊細

- `tsc -p tsconfig.json` 缂栬瘧閫氳繃
- `GET /api/health` 姝ｅ父
- `GET /` 闈欐€佸墠绔繑鍥?`200`
- 鍦ㄦ湭瀹夎 SDK 鐨勭幆澧冮噷锛屽垱寤轰换鍔′細杩涘叆 `error`锛屽苟杩斿洖鏄庣‘鎻愮ず锛氬厛鎵ц `npm install`

褰撳墠娌℃湁瀹屾垚鐨勫彧鏈夌湡瀹?Claude Code 鑱旈€氭祴璇曪紝鍥犱负姝ゅ伐浣滃尯褰撳墠鏃犳硶鑱旂綉瀹夎 `@anthropic-ai/claude-agent-sdk`銆?
