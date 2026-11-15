'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@tomoni/ui';
import { api } from '@tomoni/web-shared';

/** Two buttons that POST and refresh the page: sign/decline on the desk, retry/cancel in ops. */
export function Decide({
  options,
}: {
  options: { label: string; path: string; body?: unknown; quiet?: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <Button
          key={o.label}
          variant={o.quiet ? 'quiet' : 'secondary'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(o.path, { method: 'POST', ...(o.body ? { body: o.body } : {}) });
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
