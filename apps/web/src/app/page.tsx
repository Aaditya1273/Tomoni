import { redirect } from 'next/navigation';
import { getMe } from '@tomoni/web-shared/server';

const HOME = { family: '/family', desk: '/desk', ops: '/ops', admin: '/admin/data', sponsor: null } as const;

/** Route each person to their surface. Sponsors never land in this app (D-002). */
export default async function Index() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.mfa.required && !me.mfa.verified) redirect('/mfa');
  const here = me.surfaces.filter((s) => HOME[s] !== null);
  if (here.length === 0) redirect('/login?wrongApp=1');
  if (here.length > 1) redirect('/choose');
  redirect(HOME[here[0]!]!);
}
