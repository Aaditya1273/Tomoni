import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { BillingStatus } from '@tomoni/contracts';
import { apiGet, requireSurface } from '@tomoni/web-shared/server';
import { MockManage } from './MockManage';

export const metadata = { title: 'Sandbox payment account' };

/** Stands in for the provider's customer portal in the sandbox (D-030). */
export default async function MockManagePage({
  searchParams,
}: {
  searchParams: Promise<{ household?: string }>;
}) {
  const [, t, sp, plans] = await Promise.all([
    requireSurface('family'),
    getTranslations('family.plan'),
    searchParams,
    apiGet<BillingStatus[]>('/api/family/billing'),
  ]);
  const plan = plans.data?.find((p) => p.householdId === sp.household);
  if (!plan || (plan.status !== 'active' && plan.status !== 'past_due')) notFound();
  return (
    <main id="main" className="flex flex-1 flex-col gap-4 pt-10">
      <h1 className="text-2xl font-semibold">{t('mockManageTitle')}</h1>
      <p className="text-pretty">{t('mockManageBody')}</p>
      <MockManage householdId={plan.householdId} ending={plan.cancelAt !== null} />
    </main>
  );
}
