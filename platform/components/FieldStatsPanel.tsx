import StatusPanel from '@/components/StatusPanel';
import type { AlertFieldDefinition } from '@/lib/alert-fields';

type AggregationBucket = {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
};

type Aggregations = {
  field_missing?: { doc_count?: number };
  field_cardinality?: { value?: number };
  field_terms?: { buckets?: AggregationBucket[] };
  field_histogram?: { buckets?: AggregationBucket[] };
};

export default function FieldStatsPanel({
  field,
  aggregations,
  loading,
  errorMessage,
  onQuickFilter,
}: {
  field: AlertFieldDefinition | null;
  aggregations: Aggregations | null;
  loading: boolean;
  errorMessage: string;
  onQuickFilter?: (fieldName: string, value: string, mode: 'include' | 'exclude') => void;
}) {
  if (!field) {
    return <StatusPanel title="字段统计" description="点击任意可聚合字段即可查看当前结果集下的统计。" />;
  }

  if (loading) {
    return <StatusPanel title={`字段统计：${field.label}`} description="正在计算字段分布。" />;
  }

  if (errorMessage) {
    return <StatusPanel title={`字段统计：${field.label}`} description={errorMessage} tone="error" />;
  }

  const buckets = field.statsKind === 'date_histogram'
    ? aggregations?.field_histogram?.buckets ?? []
    : aggregations?.field_terms?.buckets ?? [];

  return (
    <div className="state-grid">
      <article className="card stat-card">
        <div className="stat-label">当前字段</div>
        <div className="stat-value">{field.label}</div>
        <div className="stat-subtext">{field.name}</div>
      </article>

      <article className="card stat-card">
        <div className="stat-label">缺失文档数</div>
        <div className="stat-value">{(aggregations?.field_missing?.doc_count ?? 0).toLocaleString('zh-CN')}</div>
        <div className="stat-subtext">当前结果集中未包含该字段的文档数</div>
      </article>

      <article className="card stat-card">
        <div className="stat-label">近似去重值</div>
        <div className="stat-value">{(aggregations?.field_cardinality?.value ?? 0).toLocaleString('zh-CN')}</div>
        <div className="stat-subtext">用于快速判断字段分布离散程度</div>
      </article>

      <article className="card section-card section-card-wide">
        <h3 className="section-card-title">Top 值分布</h3>
        {buckets.length === 0 ? (
          <div className="empty-hint">当前查询范围内没有统计结果。</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>值</th><th>文档数</th></tr>
              </thead>
              <tbody>
                {buckets.map((bucket) => {
                  const bucketValue = bucket.key_as_string ?? String(bucket.key);
                  return (
                    <tr key={String(bucket.key)}>
                      <td>
                        {field && onQuickFilter ? (
                          <span className="field-value-chip-wrap">
                            <button className="field-value-chip" type="button" onClick={() => onQuickFilter(field.name, bucketValue, 'include')}>{bucketValue}</button>
                            <span className="field-quick-actions-inline">
                              <button className="field-inline-button" type="button" onClick={() => onQuickFilter(field.name, bucketValue, 'include')}>+</button>
                              <button className="field-inline-button" type="button" onClick={() => onQuickFilter(field.name, bucketValue, 'exclude')}>-</button>
                            </span>
                          </span>
                        ) : (
                          bucketValue
                        )}
                      </td>
                      <td>{bucket.doc_count.toLocaleString('zh-CN')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}
