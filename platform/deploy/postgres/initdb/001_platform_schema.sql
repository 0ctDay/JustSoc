create table if not exists alert_user_preferences (
  user_key text not null,
  page_key text not null,
  preferences_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  primary key (user_key, page_key)
);

create table if not exists platform_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  updated_at timestamptz not null default current_timestamp
);

create table if not exists alert_ai_analysis (
  alert_id text primary key,
  alert_index text not null,
  alert_title text not null,
  result_json jsonb not null,
  ai_model text not null,
  triggered_by_user_key text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create table if not exists alert_agent_investigation (
  task_id text primary key,
  alert_id text not null,
  alert_index text not null,
  alert_title text not null,
  status text not null,
  runner_type text not null,
  external_task_id text,
  triggered_by_user_key text,
  request_json jsonb not null,
  result_json jsonb,
  progress_json jsonb,
  error_message text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create table if not exists alert_agent_chat_message (
  id text primary key,
  task_id text not null,
  role text not null,
  message_type text not null,
  content text not null,
  payload_json jsonb,
  created_at timestamptz not null default current_timestamp
);

create index if not exists idx_alert_agent_investigation_alert_id_created_at
  on alert_agent_investigation (alert_id, created_at desc);

create index if not exists idx_alert_agent_chat_message_task_id_created_at
  on alert_agent_chat_message (task_id, created_at asc);

create table if not exists probe_dispatcher_target (
  probe_id text primary key,
  display_name text not null,
  base_url text not null,
  auth_mode text not null,
  hmac_key_id text,
  hmac_shared_secret text,
  bearer_token text,
  enabled boolean not null default true,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  last_seen_at timestamptz
);

create index if not exists idx_probe_dispatcher_target_enabled
  on probe_dispatcher_target (enabled);

create table if not exists dispatcher_asset_document (
  document_id text primary key,
  document_name text not null,
  description text,
  schema_version integer not null,
  asset_version text not null,
  yaml_content text not null,
  checksum_sha256 text not null,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create table if not exists dispatcher_asset_publish_log (
  publish_id text primary key,
  document_id text not null references dispatcher_asset_document(document_id) on delete cascade,
  probe_id text not null,
  requested_by_user_id text,
  request_payload_json jsonb,
  status text not null,
  response_status integer,
  response_payload_json jsonb,
  error_message text,
  applied_version text,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  completed_at timestamptz
);

create index if not exists idx_dispatcher_asset_publish_log_document_created_at
  on dispatcher_asset_publish_log (document_id, created_at desc);

create index if not exists idx_dispatcher_asset_publish_log_probe_created_at
  on dispatcher_asset_publish_log (probe_id, created_at desc);
