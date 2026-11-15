import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@tomoni/web-shared/root';
import { getMe } from '@tomoni/web-shared/server';

const HREF = { family: '/family', desk: '/desk', ops: '/ops', admin: '/desk' } as const;

export default async function Choose() {
  const me = await getMe();
  if (!me) redirect('/login');
  const t = await getTranslations();
  const options = me.surfaces.filter((s): s is keyof typeof HREF => s in HREF);
  return (
    <AuthShell title={t('auth.chooseSurface')}>
      <ul className="flex flex-col gap-3">
        {options.map((s) => (
          <li key={s}>
            <Link
              href={HREF[s]}
              className="flex min-h-target items-center rounded-control border border-line-strong bg-surface px-4 font-semibold hover:bg-sunken"
            >
              {t(`surfaces.${s}`)}
            </Link>
          </li>
        ))}
      </ul>
    </AuthShell>
  );
}
