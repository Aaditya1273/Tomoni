import { getFormatter, getTranslations } from 'next-intl/server';
import type { DataFiles } from '@tomoni/contracts';
import { apiGet, getPrefs, requireSurface } from '@tomoni/web-shared/server';
import { StaffShell } from '@/components/StaffShell';
import { PbmUpload } from './PbmUpload';

export const metadata = { title: 'Data files' };

export default async function AdminData() {
  const me = await requireSurface('admin');
  const [t, ts, f, files, prefs] = await Promise.all([
    getTranslations('admin'),
    getTranslations('surfaces'),
    getFormatter(),
    apiGet<DataFiles>('/api/admin/data-files'),
    getPrefs(),
  ]);
  return (
    <StaffShell surface="desk" me={me} title={ts('admin')}>
      <main id="main" className="grid flex-1 gap-8 p-4 xl:grid-cols-[minmax(0,40rem)_1fr]">
        <section aria-labelledby="pbm-h" className="flex flex-col gap-3">
          <h1 id="pbm-h" className="text-lg font-semibold">
            {t('pbmHeading')}
          </h1>
          <p className="max-w-[65ch] text-muted">{t('pbmHelp')}</p>
          <PbmUpload />
        </section>
        <section aria-labelledby="files-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="files-h" className="text-lg font-semibold">
            {t('filesHeading')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-semibold">{t('label')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('kind')}</th>
                  <th className="py-2 pr-4 font-semibold">{t('effective')}</th>
                  <th className="py-2 pr-4 text-right font-semibold">{t('rows')}</th>
                  <th className="py-2 pr-4 text-right font-semibold">{t('dropped')}</th>
                  <th className="py-2 font-semibold">{t('loaded')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(files.data ?? []).map((v) => (
                  <tr key={v.id} className="border-b border-line">
                    <td className="py-2 pr-4">{v.label}</td>
                    <td className="py-2 pr-4">{v.kind}</td>
                    <td className="py-2 pr-4">{v.effectiveDate}</td>
                    <td className="py-2 pr-4 text-right">{v.rowCount}</td>
                    <td className="py-2 pr-4 text-right">{v.droppedCount}</td>
                    <td className="py-2">
                      {f.dateTime(new Date(v.loadedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: prefs.timeZone,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </StaffShell>
  );
}
