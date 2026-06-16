import { db } from '@/lib/db';

export type AggregationAgentTaskMapping = {
  bucketKey: string;
  taskId: string;
  title: string;
  windowStart: string;
  windowEnd: string;
  srcIp: string;
  selkCategory: string;
  createdAt?: string;
  updatedAt?: string;
};

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await db.query(`
    create table if not exists aggregation_agent_task (
      bucket_key text primary key,
      task_id text not null,
      title text not null,
      window_start text not null,
      window_end text not null,
      src_ip text not null,
      selk_category text not null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp
    )
  `);
  ensured = true;
}

function normalizeRow(row: {
  bucket_key: string;
  task_id: string;
  title: string;
  window_start: string;
  window_end: string;
  src_ip: string;
  selk_category: string;
  created_at: string;
  updated_at: string;
}): AggregationAgentTaskMapping {
  return {
    bucketKey: row.bucket_key,
    taskId: row.task_id,
    title: row.title,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    srcIp: row.src_ip,
    selkCategory: row.selk_category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAggregationAgentTaskMapping(bucketKey: string): Promise<AggregationAgentTaskMapping | null> {
  await ensureTable();
  const result = await db.query<{
    bucket_key: string;
    task_id: string;
    title: string;
    window_start: string;
    window_end: string;
    src_ip: string;
    selk_category: string;
    created_at: string;
    updated_at: string;
  }>(
    `select bucket_key, task_id, title, window_start, window_end, src_ip, selk_category, created_at, updated_at
       from aggregation_agent_task
      where bucket_key = $1`,
    [bucketKey],
  );
  return result.rowCount ? normalizeRow(result.rows[0]) : null;
}

export async function upsertAggregationAgentTaskMapping(input: {
  bucketKey: string;
  taskId: string;
  title: string;
  windowStart: string;
  windowEnd: string;
  srcIp: string;
  selkCategory: string;
}): Promise<AggregationAgentTaskMapping> {
  await ensureTable();
  const result = await db.query<{
    bucket_key: string;
    task_id: string;
    title: string;
    window_start: string;
    window_end: string;
    src_ip: string;
    selk_category: string;
    created_at: string;
    updated_at: string;
  }>(
    `insert into aggregation_agent_task (bucket_key, task_id, title, window_start, window_end, src_ip, selk_category)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (bucket_key)
     do update set
       task_id = excluded.task_id,
       title = excluded.title,
       window_start = excluded.window_start,
       window_end = excluded.window_end,
       src_ip = excluded.src_ip,
       selk_category = excluded.selk_category,
       updated_at = current_timestamp
     returning bucket_key, task_id, title, window_start, window_end, src_ip, selk_category, created_at, updated_at`,
    [input.bucketKey, input.taskId, input.title, input.windowStart, input.windowEnd, input.srcIp, input.selkCategory],
  );
  return normalizeRow(result.rows[0]);
}