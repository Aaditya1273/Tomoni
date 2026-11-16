import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { localeInfo, messagesFor } from '@tomoni/i18n';
import { getPrefs, getSandbox } from './server';
import { fontVariables } from './fonts';
import { SandboxNotice } from './SandboxNotice';
import { OfflineBanner } from './OfflineBanner';
import { TimeZoneCookie } from './TimeZoneCookie';

/** <html> for both web apps: language, direction, theme, text size, fonts, sandbox badge. */
export async function RootDocument({ children }: { children: ReactNode }) {
  const [prefs, sandbox] = await Promise.all([getPrefs(), getSandbox()]);
  const info = localeInfo(prefs.locale);
  return (
    <html
      lang={prefs.locale}
      dir={info.dir}
      className={fontVariables}
      {...(prefs.theme !== 'system' ? { 'data-theme': prefs.theme } : {})}
      {...(prefs.largeText ? { 'data-text': 'large' } : {})}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider locale={prefs.locale} messages={messagesFor(prefs.locale)} timeZone="UTC">
          {sandbox.sandbox && <SandboxNotice mocks={sandbox.mockAdapters} />}
          <OfflineBanner />
          <TimeZoneCookie />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
