import { loadAlertDetail } from '@/lib/alert-detail';
import { esRequest } from '@/lib/es';

type AlertHit = {
  _id: string;
  _index: string;
  _source?: Record<string, unknown>;
};

type AggregationAgentContextInput = {
  windowStart: string;
  windowEnd: string;
  srcIp: string;
  selkCategory: string;
  totalAlerts: number;
  successfulAlerts: number;
  attackResult: string;
  title: string;
};

type AggregationAgentContextResult = {
  title: string;
  prompt: string;
  summary: {
    totalAlerts: number;
    successfulAlerts: number;
    attackResult: string;
    topSignatures: Array<{ value: string; count: number }>;
    topDestinationIps: Array<{ value: string; count: number }>;
    sampleCount: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function cropText(value: string, limit: number) {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[truncated]`;
}

function countTopValues(values: string[], size: number) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, size)
    .map(([value, count]) => ({ value, count }));
}

function chooseRepresentativeSampleIds(hits: AlertHit[], maxSamples = 8) {
  const successful: AlertHit[] = [];
  const remaining: AlertHit[] = [];

  for (const hit of hits) {
    const source = hit._source ?? {};
    if (asRecord(source.engine).attack_success === true) {
      successful.push(hit);
    } else {
      remaining.push(hit);
    }
  }

  const selected: AlertHit[] = [];
  const seenSignatures = new Set<string>();

  function tryAdd(hit: AlertHit) {
    if (selected.some((item) => item._id === hit._id)) return;
    const signature = asString(asRecord(hit._source?.alert).signature) || hit._id;
    if (seenSignatures.has(signature) && selected.length >= Math.min(3, maxSamples)) return;
    seenSignatures.add(signature);
    selected.push(hit);
  }

  for (const hit of successful.slice(0, 3)) {
    tryAdd(hit);
  }

  for (const hit of remaining) {
    if (selected.length >= maxSamples) break;
    tryAdd(hit);
  }

  for (const hit of successful.slice(3)) {
    if (selected.length >= maxSamples) break;
    tryAdd(hit);
  }

  return selected.slice(0, maxSamples).map((hit) => hit._id);
}

async function fetchBucketHits(input: AggregationAgentContextInput) {
  const response = await esRequest<{
    hits?: {
      hits?: AlertHit[];
    };
  }>('selk-*/_search?ignore_unavailable=true', {
    method: 'POST',
    body: JSON.stringify({
      size: 50,
      track_total_hits: true,
      sort: [{ '@timestamp': { order: 'desc' } }],
      query: {
        bool: {
          filter: [
            { term: { 'event_type.keyword': 'alert' } },
            { range: { '@timestamp': { gte: input.windowStart, lt: input.windowEnd } } },
            { term: { 'selk.src_ip_category.keyword': `${input.srcIp}||${input.selkCategory}` } },
          ],
        },
      },
    }),
  });

  return response.hits?.hits ?? [];
}

function buildPrompt(input: AggregationAgentContextInput, summary: AggregationAgentContextResult['summary'], samples: Array<Record<string, unknown>>) {
  const bucketScope = {
    indexPattern: 'selk-*',
    filters: [
      { term: { 'event_type.keyword': 'alert' } },
      { range: { '@timestamp': { gte: input.windowStart, lt: input.windowEnd } } },
      { term: { 'selk.src_ip_category.keyword': `${input.srcIp}||${input.selkCategory}` } },
    ],
  };

  return [
    '你是一个面向 SOC / 告警平台的聚合级攻击调查 Agent。',
    '你的任务不是做泛泛研判，而是围绕当前这个“告警聚合桶”判断是否存在已经实际攻击成功的告警，并在需要时完成全链路调查。',
    '',
    '【调查目标】',
    '1. 先判断当前聚合桶内是否存在“实际攻击成功”的告警或高可信成功证据。不要把普通扫描、探测、规则命中直接等同于攻击成功。',
    '2. 如果没有成功证据，明确给出“未发现成功攻击证据”或“暂不能确认成功”的结论，并说明依据，不要臆造完整攻击链。',
    '3. 如果存在成功证据或高可信成功迹象，必须使用 ES MCP 继续调查整个聚合桶及其相关上下文，自主分析从开始、探测到利用成功的完整攻击链，而不是只分析单条告警、单个样本或我提供的示例。',
    '4. 代表样本和聚合摘要只用于初始定位、假设生成和选取调查锚点，不能当作最终全量证据。',
    '',
    '【ES MCP 调查要求】',
    '1. 优先围绕下面给出的聚合桶过滤条件进行检索，并在必要时扩展到相关目标 IP、URL、端口、攻击阶段和相邻时间窗。',
    '2. 一旦确认存在成功攻击，必须自行向前追溯初始探测和利用过程，向后查看是否存在持续利用、横向动作或重复访问痕迹。',
    '3. 重点输出“成功是否成立”和“攻击链如何串起来”，不要只罗列命中的规则名称。',
    '',
    '【大日志量场景下的效率要求】',
    '1. 先做分层检索：先 count / aggregation / topN / 时间切片，再拉取少量关键原始文档。',
    '2. 先缩小范围再取明细：优先按时间窗、源 IP、目标 IP、URL、端口、攻击阶段做聚合，避免直接抓取大批原始日志。',
    '3. 尽量只取必要字段和少量代表事件；不要把长 payload、完整 HTTP 报文或大量原始日志整段搬进输出。',
    '4. 如需扩大范围，应说明扩大依据，并继续保持小批量、逐步下钻，兼顾效率和 Token 消耗。',
    '5. successfulAlerts、attackResult 这些字段可以作为优先调查线索，但不能代替你对 ES 日志的验证。',
    '',
    '【输出要求】',
    '结论必须精简，避免长篇大论，严格按以下 4 个方向输出：',
    '1. 攻击成功的结论和证据',
    '   - 明确写“已确认成功 / 未确认成功 / 暂不能确认成功”之一。',
    '   - 只保留最关键的证据点，优先给出时间、目标、阶段、请求特征、成功迹象。',
    '2. 从开始-探测-利用的时间线梳理',
    '   - 按时间顺序概括关键节点；如果没有成功，仅写到已观察到的阶段，并明确缺失的关键证据。',
    '3. 串联事件分析需求（由用户决定是否需要）',
    '   - 只给可选的后续串联分析建议，例如是否继续关联同源 IP、同目标、同 URL、相邻时间窗、其他日志类型等。',
    '4. 处置方式',
    '   - 给出简洁、可执行的处置建议，优先包含封禁、隔离、排查、加固、复核范围。',
    '',
    '【聚合桶信息】',
    JSON.stringify({
      title: input.title,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      srcIp: input.srcIp,
      selkCategory: input.selkCategory,
      totalAlerts: input.totalAlerts,
      successfulAlerts: input.successfulAlerts,
      attackResult: input.attackResult,
    }, null, 2),
    '',
    '【建议优先使用的聚合桶检索范围】',
    JSON.stringify(bucketScope, null, 2),
    '',
    '【聚合摘要】',
    JSON.stringify(summary, null, 2),
    '',
    '【代表样本（仅用于初始定位，不代表完整攻击链）】',
    JSON.stringify(samples, null, 2),
  ].join('\n');
}

export async function buildAggregationAgentContext(input: AggregationAgentContextInput): Promise<AggregationAgentContextResult> {
  const hits = await fetchBucketHits(input);
  const topSignatures = countTopValues(
    hits.map((hit) => asString(asRecord(hit._source?.alert).signature)),
    5,
  );
  const topDestinationIps = countTopValues(
    hits.map((hit) => asString(hit._source?.dest_ip)),
    5,
  );

  const sampleIds = chooseRepresentativeSampleIds(hits, 8);
  const sampleDetails = await Promise.all(
    sampleIds.map((id) => loadAlertDetail(id, 'selk-suricata-*')),
  );

  const samples = sampleDetails
    .filter((detail): detail is NonNullable<typeof detail> => detail !== null)
    .map((detail) => ({
      id: detail.id,
      timestamp: asString(detail.document['@timestamp']),
      title: detail.title,
      srcIp: asString(detail.document.src_ip),
      destIp: asString(detail.document.dest_ip),
      destPort: asString(detail.document.dest_port),
      signature: asString(asRecord(detail.document.alert).signature),
      attackStage: detail.engine.attack_stage ?? '',
      attackSuccess: detail.engine.attack_success,
      attackSuccessConfidence: detail.engine.attack_success_confidence ?? '',
      payloadPrintable: cropText(detail.payloadPrintable, 600),
      httpRequest: cropText(detail.http.request.raw, 1200),
      httpResponse: cropText(detail.http.response.raw, 800),
    }));

  const summary = {
    totalAlerts: input.totalAlerts,
    successfulAlerts: input.successfulAlerts,
    attackResult: input.attackResult,
    topSignatures,
    topDestinationIps,
    sampleCount: samples.length,
  };

  const title = `[聚合调查] ${input.srcIp} / ${input.selkCategory} / ${input.windowStart}`;
  return {
    title,
    prompt: buildPrompt(input, summary, samples),
    summary,
  };
}