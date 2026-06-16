import { db } from '@/lib/db';
import type { AiAlertAnalysisResult } from '@/lib/ai-alert-analysis';

export type StoredAlertAiAnalysis = {
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  aiModel: string;
  triggeredByUserKey?: string;
  result: AiAlertAnalysisResult;
  createdAt?: string;
  updatedAt?: string;
};

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await db.query(`
    create table if not exists alert_ai_analysis (
      alert_id text primary key,
      alert_index text not null,
      alert_title text not null,
      result_json jsonb not null,
      ai_model text not null,
      triggered_by_user_key text null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )
  `);
  ensured = true;
}

function normalizeStoredResult(row: {
  alert_id: string;
  alert_index: string;
  alert_title: string;
  result_json: AiAlertAnalysisResult;
  ai_model: string;
  triggered_by_user_key: string | null;
  created_at: string;
  updated_at: string;
}): StoredAlertAiAnalysis {
  return {
    alertId: row.alert_id,
    alertIndex: row.alert_index,
    alertTitle: row.alert_title,
    aiModel: row.ai_model,
    triggeredByUserKey: row.triggered_by_user_key ?? undefined,
    result: row.result_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAlertAiAnalysis(alertId: string): Promise<StoredAlertAiAnalysis | null> {
  await ensureTable();
  const result = await db.query<{
    alert_id: string;
    alert_index: string;
    alert_title: string;
    result_json: AiAlertAnalysisResult;
    ai_model: string;
    triggered_by_user_key: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select alert_id, alert_index, alert_title, result_json, ai_model, triggered_by_user_key, created_at, updated_at
       from alert_ai_analysis
      where alert_id = $1`,
    [alertId],
  );

  if (!result.rowCount) {
    return null;
  }
  return normalizeStoredResult(result.rows[0]);
}

export async function upsertAlertAiAnalysis(input: {
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  aiModel: string;
  triggeredByUserKey?: string;
  result: AiAlertAnalysisResult;
}): Promise<StoredAlertAiAnalysis> {
  await ensureTable();
  const result = await db.query<{
    alert_id: string;
    alert_index: string;
    alert_title: string;
    result_json: AiAlertAnalysisResult;
    ai_model: string;
    triggered_by_user_key: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `insert into alert_ai_analysis (alert_id, alert_index, alert_title, result_json, ai_model, triggered_by_user_key)
     values ($1, $2, $3, $4::jsonb, $5, $6)
     on conflict (alert_id)
     do update set
       alert_index = excluded.alert_index,
       alert_title = excluded.alert_title,
       result_json = excluded.result_json,
       ai_model = excluded.ai_model,
       triggered_by_user_key = excluded.triggered_by_user_key,
       updated_at = current_timestamp
     returning alert_id, alert_index, alert_title, result_json, ai_model, triggered_by_user_key, created_at, updated_at`,
    [
      input.alertId,
      input.alertIndex,
      input.alertTitle,
      JSON.stringify(input.result),
      input.aiModel,
      input.triggeredByUserKey ?? null,
    ],
  );

  return normalizeStoredResult(result.rows[0]);
}
