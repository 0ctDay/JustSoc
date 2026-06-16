import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_API_PERMISSION_RULES,
  AUTH_PAGE_PERMISSION_RULES,
  AUTH_PUBLIC_API_PREFIXES,
  AUTH_PUBLIC_PAGE_PATHS,
  AUTH_SESSION_COOKIE,
} from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/token';

function matchesPath(pathname: string, target: string) {
  return pathname === target || pathname.startsWith(`${target}/`);
}

function resolveRequiredPermission(pathname: string, rules: Array<{ prefix: string; permission: string }>) {
  return rules.find((rule) => matchesPath(pathname, rule.prefix))?.permission;
}

function isStaticAsset(pathname: string) {
  return pathname.startsWith('/_next')
    || pathname.startsWith('/favicon')
    || pathname.startsWith('/robots.txt')
    || pathname.startsWith('/sitemap.xml')
    || /\.[a-zA-Z0-9]+$/.test(pathname);
}

function unauthorizedApiResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden', message, ...(extra ?? {}) }, { status });
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const isApiRoute = pathname.startsWith('/api/');
  const isPublicPage = AUTH_PUBLIC_PAGE_PATHS.some((path) => matchesPath(pathname, path));
  const isPublicApi = AUTH_PUBLIC_API_PREFIXES.some((path) => matchesPath(pathname, path));

  let payload = null;
  let authConfigError = '';
  try {
    payload = await verifySessionToken(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  } catch (error) {
    authConfigError = error instanceof Error ? error.message : 'Unknown auth configuration error';
  }

  if (isPublicPage) {
    const publicHeaders = new Headers(request.headers);
    publicHeaders.set('x-justsoc-pathname', pathname);
    if (authConfigError) {
      publicHeaders.set('x-justsoc-auth-error', authConfigError);
    }
    return NextResponse.next({
      request: {
        headers: publicHeaders,
      },
    });
  }

  if (isPublicApi) {
    return NextResponse.next();
  }

  if (authConfigError) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'auth_not_configured', message: authConfigError }, { status: 500 });
    }
    return NextResponse.rewrite(new URL('/setup', request.url), {
      request: {
        headers: new Headers({
          ...Object.fromEntries(request.headers.entries()),
          'x-justsoc-auth-error': authConfigError,
          'x-justsoc-pathname': pathname,
        }),
      },
    });
  }

  if (!payload) {
    if (isApiRoute) {
      return unauthorizedApiResponse('请先登录', 401);
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const requiredPermission = resolveRequiredPermission(pathname, isApiRoute ? AUTH_API_PERMISSION_RULES : AUTH_PAGE_PERMISSION_RULES);
  if (requiredPermission && !payload.permissions.includes(requiredPermission)) {
    if (isApiRoute) {
      return unauthorizedApiResponse('当前账号无权访问该接口', 403, { requiredPermission });
    }
    return NextResponse.redirect(new URL('/overview', request.url));
  }

  const headers = new Headers(request.headers);
  headers.set('x-justsoc-user', payload.username);
  headers.set('x-justsoc-user-id', payload.uid);
  headers.set('x-justsoc-role-codes', payload.roles.join(','));
  headers.set('x-justsoc-permissions', payload.permissions.join(','));
  headers.set('x-justsoc-pathname', pathname);

  return NextResponse.next({
    request: {
      headers,
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
