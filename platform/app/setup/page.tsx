import { redirect } from 'next/navigation';
import SetupForm from '@/components/auth/SetupForm';
import { getOptionalServerAuthContext } from '@/lib/auth/session';
import { getAuthBootstrapStatus } from '@/lib/auth/store';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const [session, bootstrap] = await Promise.all([
    getOptionalServerAuthContext(),
    getAuthBootstrapStatus(),
  ]);

  if (!bootstrap.requiresSetup) {
    redirect(session ? '/overview' : '/login');
  }

  return <SetupForm />;
}
