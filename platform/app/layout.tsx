import './globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import GitHubEmbeddedChat from '@/components/GitHubEmbeddedChat';
import NavLinks from '@/components/NavLinks';
import SessionMenu from '@/components/auth/SessionMenu';
import PageContent from '@/components/PageContent';
import { getOptionalServerAuthContext } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'JustSoc Platform',
  description: 'JustSoc 态势感知平台',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const pathname = headers().get('x-justsoc-pathname') ?? '/';
  const session = await getOptionalServerAuthContext();
  const isPublicPage = pathname === '/login' || pathname.startsWith('/login/') || pathname === '/setup' || pathname.startsWith('/setup/');

  if (!session && !isPublicPage) {
    const nextPath = pathname === '/' ? '/overview' : pathname;
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const navLinks = session?.permissions.includes('workspace:view')
    ? [
        { href: '/overview', label: '总览' },
        { href: '/aggregations', label: '聚合分析' },
        { href: '/alerts', label: '告警中心' },
        { href: '/logs', label: '日志检索' },
        { href: '/assets', label: '资产视图' },
        ...(session.permissions.includes('settings:manage') ? [{ href: '/settings', label: '设置' }] : []),
        ...(session.permissions.includes('rbac:manage') ? [{ href: '/access', label: '账号权限' }] : []),
      ]
    : [
        ...(session?.permissions.includes('settings:manage') ? [{ href: '/settings', label: '设置' }] : []),
        ...(session?.permissions.includes('rbac:manage') ? [{ href: '/access', label: '账号权限' }] : []),
      ];

  return (
    <html lang="zh-CN">
      <body>
        {session ? (
          <>
            <div className="layout">
              <header className="topbar">
                <div className="topbar-inner">
                  <div>
                    <div className="brand">JustSoc</div>
                    <div className="subtitle">态势感知与攻击研判控制台</div>
                  </div>
                  <div className="topbar-actions">
                    <NavLinks links={navLinks} />
                    <SessionMenu displayName={session.displayName} username={session.username} roles={session.roles} />
                  </div>
                </div>
              </header>
              <main className="content">
                <PageContent>{children}</PageContent>
              </main>
            </div>
            {session.permissions.includes('bridge:manage') ? <GitHubEmbeddedChat /> : null}
          </>
        ) : (
          <main className="content auth-content">
            <PageContent>{children}</PageContent>
          </main>
        )}
      </body>
    </html>
  );
}
