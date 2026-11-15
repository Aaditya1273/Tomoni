import { getRequestConfig } from 'next-intl/server';
import { messagesFor } from '@tomoni/i18n';
import { getPrefs } from '@tomoni/web-shared/server';

export default getRequestConfig(async () => {
  const { locale } = await getPrefs();
  return { locale, messages: messagesFor(locale) };
});
