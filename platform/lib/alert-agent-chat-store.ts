import { randomUUID } from 'crypto';
import { db } from '@/lib/db';

export type AlertAgentChatMessage = {
  id: string;
  taskId: string;
  role: 'system' | 'user' | 'assistant';
  messageType: string;
  content: string;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
};

let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await db.query(`
    create table if not exists alert_agent_chat_message (
      id text primary key,
      task_id text not null,
      role text not null,
      message_type text not null,
      content text not null,
      payload_json jsonb null,
      created_at timestamptz not null default current_timestamp
    )
  `);
  ensured = true;
}

function normalizeRow(row: {
  id: string;
  task_id: string;
  role: 'system' | 'user' | 'assistant';
  message_type: string;
  content: string;
  payload_json: Record<string, unknown> | null;
  created_at: string;
}): AlertAgentChatMessage {
  return {
    id: row.id,
    taskId: row.task_id,
    role: row.role,
    messageType: row.message_type,
    content: row.content,
    payload: row.payload_json,
    createdAt: row.created_at,
  };
}

export async function listAlertAgentChatMessages(taskId: string): Promise<AlertAgentChatMessage[]> {
  await ensureTable();
  const result = await db.query<{
    id: string;
    task_id: string;
    role: 'system' | 'user' | 'assistant';
    message_type: string;
    content: string;
    payload_json: Record<string, unknown> | null;
    created_at: string;
  }>(
    `select id, task_id, role, message_type, content, payload_json, created_at
       from alert_agent_chat_message
      where task_id = $1
      order by created_at asc`,
    [taskId],
  );
  return result.rows.map(normalizeRow);
}

export async function appendAlertAgentChatMessage(input: {
  taskId: string;
  role: 'system' | 'user' | 'assistant';
  messageType: string;
  content: string;
  payload?: Record<string, unknown> | null;
  id?: string;
}): Promise<AlertAgentChatMessage> {
  await ensureTable();
  const messageId = input.id ?? randomUUID();
  const result = await db.query<{
    id: string;
    task_id: string;
    role: 'system' | 'user' | 'assistant';
    message_type: string;
    content: string;
    payload_json: Record<string, unknown> | null;
    created_at: string;
  }>(
    `insert into alert_agent_chat_message (id, task_id, role, message_type, content, payload_json)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (id)
     do update set
       role = excluded.role,
       message_type = excluded.message_type,
       content = excluded.content,
       payload_json = excluded.payload_json
     returning id, task_id, role, message_type, content, payload_json, created_at`,
    [messageId, input.taskId, input.role, input.messageType, input.content, input.payload ? JSON.stringify(input.payload) : null],
  );
  return normalizeRow(result.rows[0]);
}
