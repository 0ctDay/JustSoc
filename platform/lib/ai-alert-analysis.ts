import { AlertDetailPayload, getAlertRecord, getAlertString, loadAlertDetail } from '@/lib/alert-detail';
import { getRuntimeMonitorSettings } from '@/lib/runtime-monitor-settings';
import { getAlertAiAnalysis, upsertAlertAiAnalysis } from '@/lib/ai-alert-analysis-store';

const DEFAULT_AI_MODEL = process.env.SELK_AI_MODEL ?? 'gpt-4o-mini';
const SETTINGS_CACHE_TTL_MS = 30_000;
const MAX_REQUEST_RAW_LENGTH = 6000;
const MAX_REQUEST_BODY_LENGTH = 3000;
const MAX_RESPONSE_RAW_LENGTH = 4000;
const MAX_PAYLOAD_PRINTABLE_LENGTH = 3000;
const SYSTEM_PROMPT = `浣犳槸涓€涓潰鍚戝畨鍏ㄨ繍钀ヤ腑蹇冿紙SOC锛夌殑鍛婅鐮斿垽鍔╂墜銆?
浣犵殑浠诲姟鏄熀浜庣粰瀹氱殑鍗曟潯鍛婅璇︽儏锛屽浜嬩欢杩涜鍒濇瀹夊叏鐮斿垽锛屽苟杈撳嚭缁撴瀯鍖栦腑鏂?JSON銆?
浣犲彧鑳戒緷鎹緭鍏ヤ腑鐨勫瓧娈佃繘琛屽垎鏋愶紝閲嶇偣鍏虫敞锛?1. alert.signature
2. HTTP 璇锋眰鍖?3. HTTP 璇锋眰浣?4. HTTP 鍝嶅簲鍖?5. rule 淇℃伅
6. engine.attack_* 杈呭姪淇℃伅

瑕佹眰锛?- 涓嶅緱缂栭€犳湭鎻愪緵鐨勪簨瀹?- 涓嶅緱榛樿鏀诲嚮涓€瀹氭垚鍔?- 濡傛灉璇佹嵁涓嶈冻锛屽繀椤绘槑纭啓鍑衡€滆瘉鎹笉瓒斥€?- 浼樺厛寮曠敤璇锋眰鍖呫€佽姹備綋銆佸搷搴斿寘涓殑鍏抽敭璇佹嵁
- engine.attack_* 鍙兘浣滀负杈呭姪锛屼笉鍙浛浠ｅ師濮嬭瘉鎹垽鏂?- 濡傛灉瑙勫垯鍛戒腑涓庤姹傝瘉鎹笉涓€鑷达紝蹇呴』鏄庣‘鎸囧嚭瀛樺湪鍋忓樊锛岄渶瑕佷汉宸ュ鏍?
璇蜂弗鏍艰緭鍑?JSON锛屼笉瑕?markdown锛屼笉瑕侀澶栬В閲娿€?
杈撳嚭缁撴瀯锛?{
  "summary": "涓€鍙ヨ瘽缁撹",
  "judgement": {
    "risk_level": "low | medium | high | critical",
    "confidence": "low | medium | high",
    "is_likely_true_positive": true,
    "is_likely_successful_attack": false
  },
  "evidence": [
    "璇佹嵁1",
    "璇佹嵁2"
  ],
  "analysis": {
    "attack_intent": "鏀诲嚮鎰忓浘鍒ゆ柇",
    "success_assessment": "鏄惁鎴愬姛鍙婄悊鐢?,
    "scope_hint": "褰卞搷鑼冨洿鎻愮ず鎴栬瘉鎹笉瓒宠鏄?,
    "rule_consistency": "瑙勫垯鍛戒腑涓庡師濮嬭姹傛槸鍚︿竴鑷?
  },
  "recommended_actions": [
    "寤鸿鍔ㄤ綔1",
    "寤鸿鍔ㄤ綔2",
    "寤鸿鍔ㄤ綔3"
  ]
}`;

export type AiAlertAnalysisResult = {
  summary: string;
  judgement: {
    risk_level: string;
    confidence: string;
    is_likely_true_positive: boolean;
    is_likely_successful_attack: boolean;
  };
  evidence: string[];
  analysis: {
    attack_intent: string;
    success_assessment: string;
    scope_hint: string;
    rule_consistency: string;
  };
  recommended_actions: string[];
};

export type PersistedAiAnalysis = {
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  aiModel: string;
  triggeredByUserKey?: string;
  result: AiAlertAnalysisResult;
  createdAt?: string;
  updatedAt?: string;
};

type AiExecutionSettings = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
};

let cachedAiSettings: { expiresAt: number; value: AiExecutionSettings } | null = null;

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function cropText(value: string, limit: number) {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function extractRule(document: Record<string, unknown>) {
  const alert = getAlertRecord(document.alert);
  const rule = getAlertRecord(document.rule);
  return {
    signature: getAlertString(alert.signature),
    signature_id: getAlertString(alert.signature_id),
    severity: getAlertString(alert.severity),
    category: getAlertString(alert.category),
    rule_message: getAlertString(rule.msg),
    rule_classtype: getAlertString(rule.classtype),
    rule_reference: getAlertString(rule.reference),
  };
}

function buildAnalysisPayload(detail: AlertDetailPayload) {
  const document = detail.document;
  return {
    alert_context: {
      id: detail.id,
      index: detail.index,
      title: detail.title,
      timestamp: getAlertString(document['@timestamp']),
      src_ip: getAlertString(document.src_ip),
      src_port: getAlertString(document.src_port),
      dest_ip: getAlertString(document.dest_ip),
      dest_port: getAlertString(document.dest_port),
      proto: getAlertString(document.proto),
      app_proto: getAlertString(document.app_proto),
    },
    rule: extractRule(document),
    evidence: {
      http_request_raw: cropText(detail.http.request.raw, MAX_REQUEST_RAW_LENGTH),
      http_request_body: cropText(detail.http.request.body, MAX_REQUEST_BODY_LENGTH),
      http_response_raw: cropText(detail.http.response.raw, MAX_RESPONSE_RAW_LENGTH),
      payload_printable: cropText(detail.payloadPrintable, MAX_PAYLOAD_PRINTABLE_LENGTH),
    },
    engine: {
      attack_stage: detail.engine.attack_stage ?? '',
      attack_success: detail.engine.attack_success,
      attack_success_confidence: detail.engine.attack_success_confidence ?? '',
      attack_success_reason: detail.engine.attack_success_reason,
    },
  };
}

function normalizeAiResult(value: unknown): AiAlertAnalysisResult {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const judgement = record.judgement && typeof record.judgement === 'object' ? record.judgement as Record<string, unknown> : {};
  const analysis = record.analysis && typeof record.analysis === 'object' ? record.analysis as Record<string, unknown> : {};

  return {
    summary: getAlertString(record.summary),
    judgement: {
      risk_level: getAlertString(judgement.risk_level),
      confidence: getAlertString(judgement.confidence),
      is_likely_true_positive: judgement.is_likely_true_positive === true,
      is_likely_successful_attack: judgement.is_likely_successful_attack === true,
    },
    evidence: asStringArray(record.evidence),
    analysis: {
      attack_intent: getAlertString(analysis.attack_intent),
      success_assessment: getAlertString(analysis.success_assessment),
      scope_hint: getAlertString(analysis.scope_hint),
      rule_consistency: getAlertString(analysis.rule_consistency),
    },
    recommended_actions: asStringArray(record.recommended_actions),
  };
}

async function getAiExecutionSettings(forceRefresh = false): Promise<AiExecutionSettings> {
  const now = Date.now();
  if (!forceRefresh && cachedAiSettings && cachedAiSettings.expiresAt > now) {
    return cachedAiSettings.value;
  }

  const settings = await getRuntimeMonitorSettings();
  if (!settings.aiBaseUrl) {
    throw new Error('AI HTTP 地址未配置');
  }
  if (!settings.aiApiKey) {
    throw new Error('AI SK 未配置');
  }

  const value = {
    aiBaseUrl: settings.aiBaseUrl.replace(/\/+$/, ''),
    aiApiKey: settings.aiApiKey,
    aiModel: settings.aiModel || DEFAULT_AI_MODEL,
  };
  cachedAiSettings = {
    value,
    expiresAt: now + SETTINGS_CACHE_TTL_MS,
  };
  return value;
}

async function requestAi(detail: AlertDetailPayload, settings: AiExecutionSettings): Promise<{ aiModel: string; result: AiAlertAnalysisResult }> {
  const response = await fetch(`${settings.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.aiModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(buildAnalysisPayload(detail), null, 2) },
      ],
    }),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((payload && typeof payload === 'object' && 'error' in payload) ? JSON.stringify((payload as Record<string, unknown>).error) : `AI request failed with ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 杩斿洖鍐呭涓虹┖');
  }

  try {
    return {
      aiModel: settings.aiModel,
      result: normalizeAiResult(JSON.parse(content)),
    };
  } catch {
    throw new Error('AI 杩斿洖鍐呭涓嶆槸鍚堟硶 JSON');
  }
}

export async function getPersistedAlertAnalysis(alertId: string): Promise<PersistedAiAnalysis | null> {
  const stored = await getAlertAiAnalysis(alertId);
  if (!stored) return null;
  return {
    alertId: stored.alertId,
    alertIndex: stored.alertIndex,
    alertTitle: stored.alertTitle,
    aiModel: stored.aiModel,
    triggeredByUserKey: stored.triggeredByUserKey,
    result: stored.result,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

export async function analyzeAndPersistAlertById(
  alertId: string,
  userKey?: string,
  options?: { force?: boolean; settings?: AiExecutionSettings; indexPattern?: string },
): Promise<{ analysis: PersistedAiAnalysis; skipped: boolean }> {
  const existing = await getPersistedAlertAnalysis(alertId);
  if (existing && !options?.force) {
    return { analysis: existing, skipped: true };
  }

  const detail = await loadAlertDetail(alertId, options?.indexPattern);
  if (!detail) {
    throw new Error('Alert not found');
  }

  const settings = options?.settings ?? await getAiExecutionSettings();
  const { aiModel, result } = await requestAi(detail, settings);
  const stored = await upsertAlertAiAnalysis({
    alertId: detail.id,
    alertIndex: detail.index,
    alertTitle: detail.title,
    aiModel,
    triggeredByUserKey: userKey,
    result,
  });

  return {
    skipped: false,
    analysis: {
      alertId: stored.alertId,
      alertIndex: stored.alertIndex,
      alertTitle: stored.alertTitle,
      aiModel: stored.aiModel,
      triggeredByUserKey: stored.triggeredByUserKey,
      result: stored.result,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    },
  };
}

export async function analyzeAndPersistAlerts(
  alertIds: string[],
  userKey?: string,
  options?: { force?: boolean; concurrency?: number; indexPattern?: string },
) {
  const limitedAlertIds = alertIds.slice(0, 20);
  const items: Array<{ alertId: string; ok: boolean; skipped?: boolean; result?: PersistedAiAnalysis; error?: string }> = new Array(limitedAlertIds.length);
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, limitedAlertIds.length || 1));
  const settings = await getAiExecutionSettings();
  let cursor = 0;

  async function worker() {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= limitedAlertIds.length) {
        return;
      }
      const alertId = limitedAlertIds[currentIndex];
      try {
        const result = await analyzeAndPersistAlertById(alertId, userKey, { force: options?.force, settings, indexPattern: options?.indexPattern });
        items[currentIndex] = { alertId, ok: true, skipped: result.skipped, result: result.analysis };
      } catch (error) {
        items[currentIndex] = {
          alertId,
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const succeeded = items.filter((item) => item?.ok).length;
  const failed = items.length - succeeded;
  const skipped = items.filter((item) => item?.skipped).length;
  return {
    items,
    total: items.length,
    succeeded,
    failed,
    skipped,
  };
}
