import { createHash, createHmac, randomUUID } from 'crypto';
import type { AssetDocumentRecord } from '@/lib/asset-document-store';
import type { ProbeDispatcherTargetSecretRecord } from '@/lib/probe-dispatcher-store';

const DEFAULT_ASSET_APPLY_PATH = '/_selk_internal/v1/assets/apply';
const DEFAULT_ASSET_STATUS_PATH = '/_selk_internal/v1/assets/status';
const DEFAULT_ASSET_VALIDATE_PATH = '/_selk_internal/v1/assets/validate';

export type ProbeDispatcherRequestedBy = {
  userId?: string;
  username?: string;
  displayName?: string;
};

export type ProbeDispatcherAssetPublishResult = {
  statusCode: number;
  payload: Record<string, unknown>;
};

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function buildSigningString(method: string, path: string, timestamp: string, nonce: string, bodySha256: string) {
  return [method.toUpperCase(), path, timestamp, nonce, bodySha256].join('\n');
}

function signHmac(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload, 'utf-8').digest('hex');
}

function buildAssetRequestPayload(
  document: AssetDocumentRecord,
  requestedBy: ProbeDispatcherRequestedBy | undefined,
  reason: string | undefined,
) {
  return {
    requestId: randomUUID(),
    documentId: document.documentId,
    version: document.assetVersion,
    yamlContent: document.yamlContent,
    requestedBy: requestedBy ?? {},
    reason: reason?.trim() || 'platform-dispatch',
  };
}

export async function sendProbeDispatcherRequest(
  target: ProbeDispatcherTargetSecretRecord,
  path: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | null,
) {
  const requestBody = body ? JSON.stringify(body) : '';
  const bodySha256 = sha256Hex(requestBody);
  const url = new URL(path, `${target.baseUrl}/`);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-SHA256': bodySha256,
  });

  if (target.authMode === 'hmac') {
    if (!target.hmacKeyId || !target.hmacSharedSecret) {
      throw new Error(`probe target ${target.probeId} is missing hmac auth material`);
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const signature = signHmac(
      target.hmacSharedSecret,
      buildSigningString(method, url.pathname, timestamp, nonce, bodySha256),
    );
    headers.set('X-Selk-Key-Id', target.hmacKeyId);
    headers.set('X-Selk-Timestamp', timestamp);
    headers.set('X-Selk-Nonce', nonce);
    headers.set('X-Selk-Signature', signature);
  } else {
    if (!target.bearerToken) {
      throw new Error(`probe target ${target.probeId} is missing bearer auth material`);
    }
    headers.set('Authorization', `Bearer ${target.bearerToken}`);
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: method === 'GET' ? undefined : requestBody,
    cache: 'no-store',
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { rawBody: text };
    }
  }

  return {
    statusCode: response.status,
    payload,
  };
}

export async function publishAssetDocumentToProbe(
  target: ProbeDispatcherTargetSecretRecord,
  document: AssetDocumentRecord,
  requestedBy?: ProbeDispatcherRequestedBy,
  reason?: string,
): Promise<ProbeDispatcherAssetPublishResult> {
  return sendProbeDispatcherRequest(
    target,
    process.env.SELK_DISPATCHER_ASSET_APPLY_PATH ?? DEFAULT_ASSET_APPLY_PATH,
    'POST',
    buildAssetRequestPayload(document, requestedBy, reason),
  );
}

export async function validateAssetDocumentForProbe(
  target: ProbeDispatcherTargetSecretRecord,
  document: AssetDocumentRecord,
  requestedBy?: ProbeDispatcherRequestedBy,
  reason?: string,
) {
  return sendProbeDispatcherRequest(
    target,
    process.env.SELK_DISPATCHER_ASSET_VALIDATE_PATH ?? DEFAULT_ASSET_VALIDATE_PATH,
    'POST',
    buildAssetRequestPayload(document, requestedBy, reason),
  );
}

export async function fetchProbeDispatcherAssetStatus(target: ProbeDispatcherTargetSecretRecord) {
  return sendProbeDispatcherRequest(
    target,
    process.env.SELK_DISPATCHER_ASSET_STATUS_PATH ?? DEFAULT_ASSET_STATUS_PATH,
    'GET',
    null,
  );
}
