import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { deleteAssetDocument, getAssetDocument, listAssetPublishLogs, upsertAssetDocument } from '@/lib/asset-document-store';

export const runtime = 'nodejs';

export const GET = withApiAuth(async (_request: NextRequest, { params }: { params: { documentId: string } }) => {
  try {
    const document = await getAssetDocument(params.documentId);
    if (!document) {
      return NextResponse.json({ error: 'asset_document_not_found', message: 'asset document not found' }, { status: 404 });
    }
    const publishLogs = await listAssetPublishLogs(params.documentId);
    return NextResponse.json({ document, publishLogs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'asset_document_read_failed', message }, { status: 400 });
  }
}, { permission: 'assets:view' });

export const PUT = withApiAuth(async (request: NextRequest, { params }: { params: { documentId: string } }, auth) => {
  try {
    const payload = await request.json() as {
      documentName?: string;
      description?: string;
      yamlContent?: string;
    };

    const document = await upsertAssetDocument({
      documentId: params.documentId,
      ...payload,
    }, auth.userId);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'asset_document_write_failed', message }, { status: 400 });
  }
}, { permission: 'assets:edit' });

export const DELETE = withApiAuth(async (_request: NextRequest, { params }: { params: { documentId: string } }) => {
  try {
    await deleteAssetDocument(params.documentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'asset_document_delete_failed', message }, { status: 400 });
  }
}, { permission: 'assets:edit' });

