import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AuthHttpError, authErrorToResponse, requireRequestAuth } from '@/lib/auth/http';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

// 平台与 Bridge 同容器运行，由 supervisord 管理。重启即让 supervisord 拉起新的 bridge 进程。
export async function POST(request: NextRequest) {
  try {
    await requireRequestAuth(request, 'bridge:manage');

    const { stdout, stderr } = await execFileAsync(
      'supervisorctl',
      ['-c', '/etc/supervisord.conf', 'restart', 'bridge'],
      { timeout: 30_000 },
    );

    return NextResponse.json({ ok: true, output: (stdout || stderr || '').trim() });
  } catch (error) {
    if (error instanceof AuthHttpError) {
      return authErrorToResponse(error);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'claude_bridge_restart_failed', message }, { status: 502 });
  }
}
