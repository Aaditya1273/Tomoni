import { getRequestConfig } from 'next-intl/server';
import { messagesFor } from '@tomoni/i18n';
import { getPrefs } from '@tomoni/web-shared/server';

export default getRequestConfig(async () => {
  const { locale } = await getPrefs();
  // Medicine dates are calendar days, not instants: format them in UTC so they never slip a day.
  return { locale, messages: messagesFor(locale), timeZone: 'UTC', now: new Date() };
});
