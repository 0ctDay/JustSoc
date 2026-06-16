import { redirect } from 'next/navigation';
import LoginForm from '@/components/auth/LoginForm';
import { getOptionalServerAuthContext } from '@/lib/auth/session';
import { getAuthBootstrapStatus } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const [session, bootstrap] = await Promise.all([
    getOptionalServerAuthContext(),
    getAuthBootstrapStatus(),
  ]);

  if (session) {
    redirect('/overview');
  }

  if (bootstrap.requiresSetup) {
    redirect('/setup');
  }

  return <LoginForm />;
}