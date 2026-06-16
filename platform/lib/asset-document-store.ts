import { createHash, randomUUID } from 'crypto';
import { db } from '@/lib/db';

type AssetDocumentRow = {
  document_id: string;
  document_name: string;
  description: string | null;
  schema_version: number;
  asset_version: string;
  yaml_content: string;
  checksum_sha256: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type AssetPublishLogRow = {
  publish_id: string;
  document_id: string;
  probe_id: string;
  requested_by_user_id: string | null;
  request_payload_json: unknown;
  status: string;
  response_status: number | null;
  response_payload_json: unknown;
  error_message: string | null;
  applied_version: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

export type AssetDocumentRecord = {
  documentId: string;
  documentName: string;
  description?: string;
  schemaVersion: number;
  assetVersion: string;
  yamlContent: string;
  checksumSha256: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetPublishLogRecord = {
  publishId: string;
  documentId: string;
  probeId: string;
  requestedByUserId?: string;
  requestPayload?: unknown;
  status: string;
  responseStatus?: number;
  responsePayload?: unknown;
  errorMessage?: string;
  appliedVersion?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type UpsertAssetDocumentInput = {
  documentId?: string;
  documentName?: string;
  description?: string;
  yamlContent?: string;
};

let ensured = false;

function normalizeDocumentId(value: unknown) {
  const documentId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(documentId)) {
    throw new Error('documentId must start with a letter or digit and contain only lowercase letters, digits, underscore, or dash');
  }
  return documentId;
}

function normalizeDocumentName(value: unknown) {
  const documentName = typeof value === 'string' ? value.trim() : '';
  if (!documentName) {
    throw new Error('documentName is required');
  }
  if (documentName.length > 120) {
    throw new Error('documentName must be 120 characters or fewer');
  }
  return documentName;
}

function normalizeDescription(value: unknown) {
  const description = typeof value === 'string' ? value.trim() : '';
  return description ? description.slice(0, 500) : undefined;
}

function normalizeYamlContent(value: unknown) {
  const yamlContent = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
  if (!yamlContent) {
    throw new Error('yamlContent is required');
  }
  return `${yamlContent}\n`;
}

function extractTopLevelScalar(yamlContent: string, key: string) {
  const pattern = new RegExp(`^${key}:\\s*(?:"([^"]+)"|'([^']+)'|([^#\\n\\r]+))\\s*(?:#.*)?$`, 'm');
  const matched = yamlContent.match(pattern);
  if (!matched) return '';
  return (matched[1] ?? matched[2] ?? matched[3] ?? '').trim();
}

function parseSchemaVersion(yamlContent: string) {
  const raw = extractTopLevelScalar(yamlContent, 'schema_version');
  if (!raw) {
    throw new Error('yamlContent must contain top-level schema_version');
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('schema_version must be a positive integer');
  }
  return parsed;
}

function parseAssetVersion(yamlContent: string) {
  const assetVersion = extractTopLevelScalar(yamlContent, 'version');
  if (!assetVersion) {
    throw new Error('yamlContent must contain top-level version');
  }
  if (assetVersion.length > 200) {
    throw new Error('asset version must be 200 characters or fewer');
  }
  return assetVersion;
}

function hashYamlContent(yamlContent: string) {
  return createHash('sha256').update(yamlContent, 'utf-8').digest('hex');
}

function toAssetDocumentRecord(row: AssetDocumentRow): AssetDocumentRecord {
  return {
    documentId: row.document_id,
    documentName: row.document_name,
    description: row.description ?? undefined,
    schemaVersion: row.schema_version,
    assetVersion: row.asset_version,
    yamlContent: row.yaml_content,
    checksumSha256: row.checksum_sha256,
    createdByUserId: row.created_by_user_id ?? undefined,
    updatedByUserId: row.updated_by_user_id ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toAssetPublishLogRecord(row: AssetPublishLogRow): AssetPublishLogRecord {
  return {
    publishId: row.publish_id,
    documentId: row.document_id,
    probeId: row.probe_id,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    requestPayload: row.request_payload_json ?? undefined,
    status: row.status,
    responseStatus: row.response_status ?? undefined,
    responsePayload: row.response_payload_json ?? undefined,
    errorMessage: row.error_message ?? undefined,
    appliedVersion: row.applied_version ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString(),
  };
}

async function ensureAssetDocumentTables() {
  if (ensured) return;
  await db.query(`
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
    )
  `);
  await db.query(`
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
    )
  `);
  await db.query('create index if not exists idx_dispatcher_asset_publish_log_document_created_at on dispatcher_asset_publish_log(document_id, created_at desc)');
  await db.query('create index if not exists idx_dispatcher_asset_publish_log_probe_created_at on dispatcher_asset_publish_log(probe_id, created_at desc)');
  ensured = true;
}

export async function listAssetDocuments() {
  await ensureAssetDocumentTables();
  const result = await db.query<AssetDocumentRow>(
    `select document_id, document_name, description, schema_version, asset_version, yaml_content, checksum_sha256, created_by_user_id, updated_by_user_id, created_at, updated_at
       from dispatcher_asset_document
      order by document_id asc`,
  );
  return result.rows.map(toAssetDocumentRecord);
}

export async function getAssetDocument(documentId: string) {
  await ensureAssetDocumentTables();
  const result = await db.query<AssetDocumentRow>(
    `select document_id, document_name, description, schema_version, asset_version, yaml_content, checksum_sha256, created_by_user_id, updated_by_user_id, created_at, updated_at
       from dispatcher_asset_document
      where document_id = $1`,
    [normalizeDocumentId(documentId)],
  );
  return result.rowCount ? toAssetDocumentRecord(result.rows[0]) : null;
}

export async function upsertAssetDocument(input: UpsertAssetDocumentInput, actorUserId?: string) {
  const documentId = normalizeDocumentId(input.documentId);
  const documentName = normalizeDocumentName(input.documentName);
  const description = normalizeDescription(input.description);
  const yamlContent = normalizeYamlContent(input.yamlContent);
  const schemaVersion = parseSchemaVersion(yamlContent);
  const assetVersion = parseAssetVersion(yamlContent);
  const checksumSha256 = hashYamlContent(yamlContent);

  await ensureAssetDocumentTables();
  const result = await db.query<AssetDocumentRow>(
    `insert into dispatcher_asset_document (
       document_id, document_name, description, schema_version, asset_version, yaml_content, checksum_sha256, created_by_user_id, updated_by_user_id
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     on conflict (document_id)
     do update set
       document_name = excluded.document_name,
       description = excluded.description,
       schema_version = excluded.schema_version,
       asset_version = excluded.asset_version,
       yaml_content = excluded.yaml_content,
       checksum_sha256 = excluded.checksum_sha256,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = current_timestamp
     returning document_id, document_name, description, schema_version, asset_version, yaml_content, checksum_sha256, created_by_user_id, updated_by_user_id, created_at, updated_at`,
    [documentId, documentName, description ?? null, schemaVersion, assetVersion, yamlContent, checksumSha256, actorUserId ?? null],
  );

  return toAssetDocumentRecord(result.rows[0]);
}

export async function deleteAssetDocument(documentId: string) {
  await ensureAssetDocumentTables();
  await db.query('delete from dispatcher_asset_document where document_id = $1', [normalizeDocumentId(documentId)]);
}

export async function createAssetPublishLog(input: {
  documentId: string;
  probeId: string;
  requestedByUserId?: string;
  requestPayload?: unknown;
}) {
  await ensureAssetDocumentTables();
  const publishId = randomUUID();
  const result = await db.query<AssetPublishLogRow>(
    `insert into dispatcher_asset_publish_log (
       publish_id, document_id, probe_id, requested_by_user_id, request_payload_json, status
     )
     values ($1, $2, $3, $4, $5::jsonb, 'pending')
     returning publish_id, document_id, probe_id, requested_by_user_id, request_payload_json, status, response_status, response_payload_json, error_message, applied_version, created_at, updated_at, completed_at`,
    [publishId, normalizeDocumentId(input.documentId), input.probeId.trim().toLowerCase(), input.requestedByUserId ?? null, JSON.stringify(input.requestPayload ?? null)],
  );
  return toAssetPublishLogRecord(result.rows[0]);
}

export async function completeAssetPublishLog(
  publishId: string,
  input: {
    status: 'succeeded' | 'failed';
    responseStatus?: number;
    responsePayload?: unknown;
    errorMessage?: string;
    appliedVersion?: string;
  },
) {
  await ensureAssetDocumentTables();
  const result = await db.query<AssetPublishLogRow>(
    `update dispatcher_asset_publish_log
        set status = $2,
            response_status = $3,
            response_payload_json = $4::jsonb,
            error_message = $5,
            applied_version = $6,
            updated_at = current_timestamp,
            completed_at = current_timestamp
      where publish_id = $1
      returning publish_id, document_id, probe_id, requested_by_user_id, request_payload_json, status, response_status, response_payload_json, error_message, applied_version, created_at, updated_at, completed_at`,
    [
      publishId,
      input.status,
      input.responseStatus ?? null,
      JSON.stringify(input.responsePayload ?? null),
      input.errorMessage ?? null,
      input.appliedVersion ?? null,
    ],
  );
  return result.rowCount ? toAssetPublishLogRecord(result.rows[0]) : null;
}

export async function listAssetPublishLogs(documentId?: string) {
  await ensureAssetDocumentTables();
  const result = documentId
    ? await db.query<AssetPublishLogRow>(
      `select publish_id, document_id, probe_id, requested_by_user_id, request_payload_json, status, response_status, response_payload_json, error_message, applied_version, created_at, updated_at, completed_at
         from dispatcher_asset_publish_log
        where document_id = $1
        order by created_at desc
        limit 100`,
      [normalizeDocumentId(documentId)],
    )
    : await db.query<AssetPublishLogRow>(
      `select publish_id, document_id, probe_id, requested_by_user_id, request_payload_json, status, response_status, response_payload_json, error_message, applied_version, created_at, updated_at, completed_at
         from dispatcher_asset_publish_log
        order by created_at desc
        limit 100`,
    );
  return result.rows.map(toAssetPublishLogRecord);
}

