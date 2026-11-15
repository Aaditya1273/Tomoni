import { getFormatter, getTranslations } from 'next-intl/server';
import type { WarningItem } from '@tomoni/contracts';
import { day, drugName } from '@/lib/medicines';

/** Shared wording for a warning: the sentence, the "when" label and the source line. */
export async function warningWords(w: WarningItem, asOf: string) {
  const [t, f] = await Promise.all([getTranslations('family'), getFormatter()]);
  const date = (iso: string) =>
    f.dateTime(day(iso), {
      month: 'short',
      day: 'numeric',
      ...(iso.slice(0, 4) !== asOf.slice(0, 4) ? { year: 'numeric' } : {}),
    });
  const money = (cents: number | undefined) =>
    f.number((cents ?? 0) / 100, { style: 'currency', currency: 'USD' });
  const x = w.facts;
  const drug = w.drug ? drugName(w.drug) : '';
  const when =
    w.daysUntilProblem === 0
      ? t('whenNow')
      : w.daysUntilProblem === 1
        ? t('whenTomorrow')
        : t('whenDays', { days: w.daysUntilProblem });
  const plan = x.plan ?? '';
  const sentence = {
    run_out: () => t('w.run_out', { drug, when: when.toLowerCase() }),
    late_refill: () => t('w.late_refill', { drug, days: x.daysWithout ?? 0 }),
    premium_jump: () =>
      t('w.premium_jump', {
        plan,
        before: money(x.premiumBeforeCents),
        after: money(x.premiumAfterCents),
        date: date(w.source.date),
      }),
    formulary_removal: () =>
      t('w.formulary_removal', { plan, drug, date: date(w.source.date), problemDate: date(w.problemDate) }),
    tier_change: () =>
      t('w.tier_change', {
        drug,
        plan,
        before: x.tierBefore ?? '?',
        after: x.tierAfter ?? '?',
        date: date(w.source.date),
      }),
    negotiated_price_change: () =>
      t('w.negotiated_price_change', {
        plan,
        drug,
        before: money(x.cost30BeforeCents),
        after: money(x.cost30AfterCents),
        date: date(w.source.date),
      }),
    pharmacy_closure: () =>
      t('w.pharmacy_closure', {
        pharmacy: x.pharmacy ?? '',
        date: date(x.closesOn ?? w.source.date),
        count: x.drugs?.length ?? 0,
      }),
    shortage: () => t('w.shortage', { drug, problemDate: date(w.problemDate) }),
    gene_drug_mismatch: () => t('w.gene_drug_mismatch'),
  }[w.type]();
  const l = w.source.label;
  const source =
    w.source.kind === 'data_file'
      ? t('source.file', { label: l, date: date(w.source.date) })
      : t(
          l === 'claims:bluebutton'
            ? 'source.claims'
            : l === 'claims:family'
              ? 'source.claimsFamily'
              : l === 'claims:manual'
                ? 'source.claimsManual'
                : 'source.claimsMock',
          {
            date: date(w.source.date),
          },
        );
  return { sentence, when, source, date };
}
