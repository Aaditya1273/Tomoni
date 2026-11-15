import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireSurface } from '@tomoni/web-shared/server';
import { MockPay } from './MockPay';

export const metadata = { title: 'Sandbox checkout' };

/** Same-site paths only, so this page can't be used as an open redirect. */
const local = (p: string | undefined, fallback: string) =>
  p && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') ? p : fallback;

/** Stands in for the provider's checkout in the sandbox (D-030). No card is asked for. */
export default async function MockCheckout({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; success?: string; cancel?: string }>;
}) {
  const [, t, sp] = await Promise.all([
    requireSurface('family'),
    getTranslations('family.plan'),
    searchParams,
  ]);
  if (!sp.ref || !/^mock_cs_[0-9a-f-]{36}$/.test(sp.ref)) notFound();
  return (
    <main id="main" className="flex flex-1 flex-col gap-4 pt-10">
      <h1 className="text-2xl font-semibold">{t('mockTitle')}</h1>
      <p className="text-pretty">{t('mockBody')}</p>
      <MockPay
        checkoutRef={sp.ref}
        success={local(sp.success, '/family?billing=done')}
        cancel={local(sp.cancel, '/family?billing=canceled')}
      />
    </main>
  );
}
