'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Notice, TextField } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

/** India bridge: enter a medicine from the prescription or bill; the phone camera takes the photo. */
export function AddMedicine({ patientId, today }: { patientId: string; today: string }) {
  const t = useTranslations('family.addMed');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'act'; text: string } | null>(null);
  if (!open)
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {t('title')}
      </Button>
    );
  return (
    <form
      method="post"
      className="flex flex-col gap-3 rounded-panel bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const file = fd.get('photo');
        const photo =
          file instanceof File && file.size
            ? btoa(
                Array.from(new Uint8Array(await file.arrayBuffer()), (b) => String.fromCharCode(b)).join(''),
              )
            : null;
        const refills = String(fd.get('refills') ?? '');
        setBusy(true);
        setMsg(null);
        try {
          await api(`/api/family/patients/${patientId}/medicines`, {
            method: 'POST',
            body: {
              name: String(fd.get('name')),
              dosesPerDay: Number(fd.get('perDay')),
              quantity: Number(fd.get('quantity')),
              filledOn: String(fd.get('filledOn')),
              refillsLeft: refills === '' ? null : Number(refills),
              photo,
            },
          });
          setMsg({ tone: 'ok', text: t('saved') });
          (e.target as HTMLFormElement).reset();
          setTimeout(() => router.refresh(), 1500);
        } catch (err) {
          setMsg({
            tone: 'act',
            text: t('failed', { message: err instanceof ApiError ? err.message : String(err) }),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-semibold">{t('title')}</p>
      <p className="text-sm text-muted">{t('help')}</p>
      <TextField
        name="name"
        label={t('name')}
        placeholder={t('namePlaceholder')}
        required
        minLength={2}
        maxLength={120}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="perDay"
          label={t('perDay')}
          type="number"
          required
          min={1}
          max={12}
          defaultValue={1}
        />
        <TextField
          name="quantity"
          label={t('quantity')}
          type="number"
          required
          min={1}
          max={1000}
          defaultValue={30}
        />
        <TextField
          name="filledOn"
          label={t('filledOn')}
          type="date"
          required
          max={today}
          defaultValue={today}
        />
        <TextField
          name="refills"
          label={t('refills')}
          hint={t('refillsUnknown')}
          type="number"
          min={0}
          max={20}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`photo-${patientId}`} className="font-semibold">
          {t('photo')}
        </label>
        <input
          id={`photo-${patientId}`}
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
        />
      </div>
      <Button type="submit" className="self-start" disabled={busy}>
        {t('save')}
      </Button>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
