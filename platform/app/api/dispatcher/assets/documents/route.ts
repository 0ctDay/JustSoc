import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/auth/http';
import { listAssetDocuments, listAssetPublishLogs, upsertAssetDocument } from '@/lib/asset-document-store';

export const runtime = 'nodejs';

export const GET = withApiAuth(async () => {
  try {
    const [documents, publishLogs] = await Promise.all([
      listAssetDocuments(),
      listAssetPublishLogs(),
    ]);
    return NextResponse.json({ documents, publishLogs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'asset_documents_read_failed', message }, { status: 500 });
  }
}, { permission: 'assets:view' });

export const POST = withApiAuth(async (request: NextRequest, _context, auth) => {
  try {
    const payload = await request.json() as {
      documentId?: string;
      documentName?: string;
      description?: string;
      yamlContent?: string;
    };

    const document = await upsertAssetDocument(payload, auth.userId);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'asset_document_write_failed', message }, { status: 400 });
  }
}, { permission: 'assets:edit' });
