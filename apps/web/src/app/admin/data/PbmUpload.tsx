'use client';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

type Preview = { headers: string[]; sample: string[][]; rowCount: number };
type Result = {
  saved: number;
  duplicate: boolean;
  unknownDrugs: number;
  dropped: { line: number; reason: string }[];
  droppedCount: number;
};
type Field = 'formularyId' | 'drug' | 'change' | 'newTier' | 'effectiveDate';

const MAX = 2 * 1024 * 1024;
/** First header that looks like the field, so most PBM files need no changes. */
const GUESS: Record<Field, RegExp> = {
  formularyId: /formulary|form.?id/i,
  drug: /rxcui|ndc|drug/i,
  change: /change|action|status|type/i,
  newTier: /tier/i,
  effectiveDate: /effective|date|start/i,
};

export function PbmUpload() {
  const t = useTranslations('admin');
  const router = useRouter();
  const id = useId();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<Record<Field, string>>({
    formularyId: '',
    drug: '',
    change: '',
    newTier: '',
    effectiveDate: '',
  });
  const [kind, setKind] = useState<'rxcui' | 'ndc'>('rxcui');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    setResult(null);
    setError(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX) return setError(t('tooBig'));
    const text = await file.text();
    try {
      const p = await api<Preview>('/api/admin/pbm/preview', { method: 'POST', body: { csv: text } });
      setCsv(text);
      setPreview(p);
      const pick = (f: Field) => p.headers.find((h) => GUESS[f].test(h)) ?? '';
      const drug = pick('drug');
      setKind(/ndc/i.test(drug) ? 'ndc' : 'rxcui');
      setMap({
        formularyId: pick('formularyId'),
        drug,
        change: pick('change'),
        newTier: pick('newTier'),
        effectiveDate: pick('effectiveDate'),
      });
      setLabel(file.name.replace(/\.csv$/i, ''));
    } catch (e) {
      setError(t('error', { message: e instanceof ApiError ? e.message : String(e) }));
    }
  }

  async function upload() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Result>('/api/admin/pbm', {
        method: 'POST',
        body: {
          csv,
          label,
          mapping: {
            formularyId: map.formularyId,
            drug: { column: map.drug, kind },
            change: map.change,
            newTier: map.newTier || null,
            effectiveDate: map.effectiveDate,
          },
        },
      });
      setResult(r);
      router.refresh();
    } catch (e) {
      setError(t('error', { message: e instanceof ApiError ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  const select = (f: Field, labelKey: string, optional = false) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${f}`} className="font-semibold">
        {t(labelKey)}
      </label>
      <select
        id={`${id}-${f}`}
        value={map[f]}
        onChange={(e) => setMap({ ...map, [f]: e.target.value })}
        className="min-h-target rounded-control border border-line-strong bg-surface px-2"
      >
        {optional && <option value="">{t('none')}</option>}
        {!optional && !map[f] && <option value="">—</option>}
        {preview!.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );
  const ready = preview && label.trim() && map.formularyId && map.drug && map.change && map.effectiveDate;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-file`} className="font-semibold">
          {t('file')}
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </div>

      {preview && (
        <>
          <TextField
            label={t('label')}
            placeholder={t('labelPlaceholder')}
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-semibold">{t('columns')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {select('formularyId', 'colFormulary')}
              <div className="flex flex-col gap-2">
                {select('drug', 'colDrug')}
                <div className="flex gap-4" role="radiogroup" aria-label={t('colDrug')}>
                  {(['rxcui', 'ndc'] as const).map((k) => (
                    <label key={k} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${id}-kind`}
                        checked={kind === k}
                        onChange={() => setKind(k)}
                      />
                      {t(k === 'rxcui' ? 'drugKindRxcui' : 'drugKindNdc')}
                    </label>
                  ))}
                </div>
              </div>
              {select('change', 'colChange')}
              {select('newTier', 'colTier', true)}
              {select('effectiveDate', 'colEffective')}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <p className="font-semibold">
              {t('preview')}{' '}
              <span className="font-normal text-muted">({t('rowsInFile', { count: preview.rowCount })})</span>
            </p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {preview.headers.map((h) => (
                      <th key={h} className="py-1 pr-4 text-left font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r, i) => (
                    <tr key={i} className="border-b border-line">
                      {r.map((c, j) => (
                        <td key={j} className="py-1 pr-4">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Button className="self-start" disabled={!ready || busy} onClick={upload}>
            {busy ? t('uploading') : t('upload')}
          </Button>
        </>
      )}

      {error && <Notice tone="act">{error}</Notice>}
      {result && (
        <Notice tone={result.duplicate ? 'info' : 'ok'}>
          <p>
            {result.duplicate
              ? t('duplicate')
              : t('result', { saved: result.saved, dropped: result.droppedCount })}
          </p>
          {result.unknownDrugs > 0 && <p>{t('unknownDrugs', { count: result.unknownDrugs })}</p>}
          {result.dropped.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {result.dropped.map((d) => (
                <li key={d.line}>{t('droppedLine', { line: d.line, reason: d.reason })}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </div>
  );
}
