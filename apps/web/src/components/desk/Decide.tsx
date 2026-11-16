'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@tomoni/ui';
import { api, ApiError } from '@tomoni/web-shared';

/**
 * Buttons that POST and refresh the page: sign/decline on the desk, retry/cancel in ops. A refusal
 * (a draft changed since it was opened, say) is shown, never swallowed.
 */
export function Decide({
  options,
}: {
  options: { label: string; path: string; body?: unknown; quiet?: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {options.map((o) => (
          <Button
            key={o.label}
            variant={o.quiet ? 'quiet' : 'secondary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(o.path, { method: 'POST', ...(o.body ? { body: o.body } : {}) });
                router.refresh();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-act">
          {error}
        </p>
      )}
    </div>
  );
}
