import { db } from '@/lib/db';

export type AlertAgentInvestigationRecord = {
  taskId: string;
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  status: string;
  runnerType: string;
  externalTaskId?: string;
  triggeredByUserKey?: string;
  requestJson: Record<string, unknown>;
  resultJson?: Record<string, unknown> | null;
  progressJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await db.query(`
    create table if not exists alert_agent_investigation (
      task_id text primary key,
      alert_id text not null,
      alert_index text not null,
      alert_title text not null,
      status text not null,
      runner_type text not null,
      external_task_id text null,
      triggered_by_user_key text null,
      request_json jsonb not null,
      result_json jsonb null,
      progress_json jsonb null,
      error_message text null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )
  `);
  ensured = true;
}

function normalizeRow(row: {
  task_id: string;
  alert_id: string;
  alert_index: string;
  alert_title: string;
  status: string;
  runner_type: string;
  external_task_id: string | null;
  triggered_by_user_key: string | null;
  request_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  progress_json: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}): AlertAgentInvestigationRecord {
  return {
    taskId: row.task_id,
    alertId: row.alert_id,
    alertIndex: row.alert_index,
    alertTitle: row.alert_title,
    status: row.status,
    runnerType: row.runner_type,
    externalTaskId: row.external_task_id ?? undefined,
    triggeredByUserKey: row.triggered_by_user_key ?? undefined,
    requestJson: row.request_json,
    resultJson: row.result_json,
    progressJson: row.progress_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createAlertAgentInvestigation(input: {
  taskId: string;
  alertId: string;
  alertIndex: string;
  alertTitle: string;
  status: string;
  runnerType: string;
  triggeredByUserKey?: string;
  requestJson: Record<string, unknown>;
}): Promise<AlertAgentInvestigationRecord> {
  await ensureTable();
  const result = await db.query<{
    task_id: string;
    alert_id: string;
    alert_index: string;
    alert_title: string;
    status: string;
    runner_type: string;
    external_task_id: string | null;
    triggered_by_user_key: string | null;
    request_json: Record<string, unknown>;
    result_json: Record<string, unknown> | null;
    progress_json: Record<string, unknown> | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `insert into alert_agent_investigation (task_id, alert_id, alert_index, alert_title, status, runner_type, triggered_by_user_key, request_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     returning task_id, alert_id, alert_index, alert_title, status, runner_type, external_task_id, triggered_by_user_key, request_json, result_json, progress_json, error_message, created_at, updated_at`,
    [input.taskId, input.alertId, input.alertIndex, input.alertTitle, input.status, input.runnerType, input.triggeredByUserKey ?? null, JSON.stringify(input.requestJson)],
  );
  return normalizeRow(result.rows[0]);
}

export async function updateAlertAgentInvestigation(taskId: string, patch: {
  status?: string;
  externalTaskId?: string | null;
  progressJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
}): Promise<AlertAgentInvestigationRecord | null> {
  await ensureTable();
  const result = await db.query<{
    task_id: string;
    alert_id: string;
    alert_index: string;
    alert_title: string;
    status: string;
    runner_type: string;
    external_task_id: string | null;
    triggered_by_user_key: string | null;
    request_json: Record<string, unknown>;
    result_json: Record<string, unknown> | null;
    progress_json: Record<string, unknown> | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `update alert_agent_investigation
        set status = coalesce($2, status),
            external_task_id = coalesce($3, external_task_id),
            progress_json = coalesce($4::jsonb, progress_json),
            result_json = coalesce($5::jsonb, result_json),
            error_message = $6,
            updated_at = current_timestamp
      where task_id = $1
      returning task_id, alert_id, alert_index, alert_title, status, runner_type, external_task_id, triggered_by_user_key, request_json, result_json, progress_json, error_message, created_at, updated_at`,
    [taskId, patch.status ?? null, patch.externalTaskId ?? null, patch.progressJson ? JSON.stringify(patch.progressJson) : null, patch.resultJson ? JSON.stringify(patch.resultJson) : null, patch.errorMessage ?? null],
  );
  return result.rowCount ? normalizeRow(result.rows[0]) : null;
}

export async function getAlertAgentInvestigationByTaskId(taskId: string): Promise<AlertAgentInvestigationRecord | null> {
  await ensureTable();
  const result = await db.query<{
    task_id: string;
    alert_id: string;
    alert_index: string;
    alert_title: string;
    status: string;
    runner_type: string;
    external_task_id: string | null;
    triggered_by_user_key: string | null;
    request_json: Record<string, unknown>;
    result_json: Record<string, unknown> | null;
    progress_json: Record<string, unknown> | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select task_id, alert_id, alert_index, alert_title, status, runner_type, external_task_id, triggered_by_user_key, request_json, result_json, progress_json, error_message, created_at, updated_at
       from alert_agent_investigation
      where task_id = $1`,
    [taskId],
  );
  return result.rowCount ? normalizeRow(result.rows[0]) : null;
}

export async function getLatestAlertAgentInvestigation(alertId: string): Promise<AlertAgentInvestigationRecord | null> {
  await ensureTable();
  const result = await db.query<{
    task_id: string;
    alert_id: string;
    alert_index: string;
    alert_title: string;
    status: string;
    runner_type: string;
    external_task_id: string | null;
    triggered_by_user_key: string | null;
    request_json: Record<string, unknown>;
    result_json: Record<string, unknown> | null;
    progress_json: Record<string, unknown> | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select task_id, alert_id, alert_index, alert_title, status, runner_type, external_task_id, triggered_by_user_key, request_json, result_json, progress_json, error_message, created_at, updated_at
       from alert_agent_investigation
      where alert_id = $1
      order by updated_at desc
      limit 1`,
    [alertId],
  );
  return result.rowCount ? normalizeRow(result.rows[0]) : null;
}
