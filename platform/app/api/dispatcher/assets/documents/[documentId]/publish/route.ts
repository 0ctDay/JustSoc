import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { completeAssetPublishLog, createAssetPublishLog, getAssetDocument } from '@/lib/asset-document-store';
import { publishAssetDocumentToProbe, type ProbeDispatcherRequestedBy, validateAssetDocumentForProbe } from '@/lib/probe-dispatcher-client';
import { getProbeDispatcherTargetWithSecrets, touchProbeDispatcherTargetLastSeen } from '@/lib/probe-dispatcher-store';

export const runtime = 'nodejs';

export const POST = withApiAuth(async (request: NextRequest, { params }: { params: { documentId: string } }, auth) => {
  try {
    const payload = await request.json() as {
      probeIds?: string[];
      reason?: string;
      validateOnly?: boolean;
    };

    const document = await getAssetDocument(params.documentId);
    if (!document) {
      return NextResponse.json({ error: 'asset_document_not_found', message: 'asset document not found' }, { status: 404 });
    }

    const probeIds = Array.isArray(payload.probeIds)
      ? payload.probeIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];
    if (!probeIds.length) {
      return NextResponse.json({ error: 'dispatcher_target_missing', message: 'probeIds is required' }, { status: 400 });
    }

    const requestedBy: ProbeDispatcherRequestedBy = {
      userId: auth.userId,
      username: auth.username,
      displayName: auth.displayName,
    };

    const results: Array<Record<string, unknown>> = [];

    for (const probeId of probeIds) {
      const target = await getProbeDispatcherTargetWithSecrets(probeId);
      if (!target) {
        results.push({
          probeId,
          ok: false,
          error: 'dispatcher_target_not_found',
          message: 'dispatcher target not found',
        });
        continue;
      }

      const publishLog = await createAssetPublishLog({
        documentId: document.documentId,
        probeId: target.probeId,
        requestedByUserId: auth.userId,
        requestPayload: {
          validateOnly: payload.validateOnly === true,
          assetVersion: document.assetVersion,
          checksumSha256: document.checksumSha256,
          reason: payload.reason?.trim() || 'platform-dispatch',
        },
      });

      try {
        const result = payload.validateOnly === true
          ? await validateAssetDocumentForProbe(target, document, requestedBy, payload.reason)
          : await publishAssetDocumentToProbe(target, document, requestedBy, payload.reason);

        const ok = result.statusCode >= 200 && result.statusCode < 300;
        if (ok) {
          await touchProbeDispatcherTargetLastSeen(target.probeId);
        }
        await completeAssetPublishLog(publishLog.publishId, {
          status: ok ? 'succeeded' : 'failed',
          responseStatus: result.statusCode,
          responsePayload: result.payload,
          errorMessage: ok ? undefined : String(result.payload.message ?? result.payload.error ?? 'dispatcher request failed'),
          appliedVersion: ok ? document.assetVersion : undefined,
        });
        results.push({
          probeId: target.probeId,
          ok,
          statusCode: result.statusCode,
          payload: result.payload,
          publishId: publishLog.publishId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await completeAssetPublishLog(publishLog.publishId, {
          status: 'failed',
          errorMessage: message,
        });
        results.push({
          probeId: target.probeId,
          ok: false,
          error: 'dispatcher_publish_failed',
          message,
          publishId: publishLog.publishId,
        });
      }
    }

    const failed = results.filter((item) => item.ok !== true).length;
    return NextResponse.json(
      {
        documentId: document.documentId,
        assetVersion: document.assetVersion,
        validateOnly: payload.validateOnly === true,
        results,
      },
      { status: failed ? 207 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'asset_document_publish_failed', message }, { status: 400 });
  }
}, { permission: 'assets:publish' });

