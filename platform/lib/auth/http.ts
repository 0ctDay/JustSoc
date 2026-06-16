import { NextRequest, NextResponse } from 'next/server';
import type { AuthPermissionCode } from '@/lib/auth/config';
import { getOptionalAuthContextFromRequest } from '@/lib/auth/session';
import type { AuthSessionContext } from '@/lib/auth/store';

export class AuthHttpError extends Error {
  status: number;

  code: string;

  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function authErrorToResponse(error: unknown) {
  if (error instanceof AuthHttpError) {
    return NextResponse.json(
      {
        error: error.code,
        message: error.message,
        ...(error.details ?? {}),
      },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json({ error: 'auth_unexpected_error', message }, { status: 500 });
}

export async function requireRequestAuth(request: NextRequest, permission?: AuthPermissionCode) {
  const session = await getOptionalAuthContextFromRequest(request);
  if (!session) {
    throw new AuthHttpError(401, 'unauthorized', '请先登录');
  }
  if (permission && !session.permissions.includes(permission)) {
    throw new AuthHttpError(403, 'forbidden', '当前账号无权访问该接口', { requiredPermission: permission });
  }
  return session;
}

type AuthedRouteHandler<TContext> = (
  request: NextRequest,
  context: TContext,
  auth: AuthSessionContext,
) => Promise<Response>;

export function withApiAuth<TContext = Record<string, never>>(
  handler: AuthedRouteHandler<TContext>,
  options?: { permission?: AuthPermissionCode },
) {
  return async (request: NextRequest, context: TContext) => {
    try {
      const auth = await requireRequestAuth(request, options?.permission);
      return await handler(request, context, auth);
    } catch (error) {
      return authErrorToResponse(error);
    }
  };
}