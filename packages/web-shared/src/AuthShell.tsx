import type { ReactNode } from 'react';
import { Wordmark } from '@tomoni/ui';
import { getPrefs } from './server';
import { PrefsMenu } from './PrefsMenu';

/** Sign-in screens: the name large, one narrow column, preferences reachable before signing in. */
export async function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const prefs = await getPrefs();
  return (
    <div
      data-surface="family"
      className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col gap-10 px-5 pt-16 pb-10"
    >
      <Wordmark className="text-4xl leading-none" />
      <main id="main" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl leading-tight font-semibold">{title}</h1>
          {lead && <p className="text-muted">{lead}</p>}
        </div>
        {children}
      </main>
      <footer className="mt-auto">
        <PrefsMenu initialTheme={prefs.theme} initialLargeText={prefs.largeText} />
      </footer>
    </div>
  );
}
