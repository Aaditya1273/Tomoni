import { expect, it } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { RedactingExporter } from '../src';

it('SECURITY S13: query strings never leave the process in a span', async () => {
  const span = {
    attributes: {
      'url.path': '/api/desk/apcm',
      'url.query': 'name=Raj%20Patel',
      'url.full': 'http://x/api/desk/apcm?name=Raj',
      'http.target': '/api/desk/apcm?name=Raj',
    },
  } as unknown as ReadableSpan;
  let sent: ReadableSpan[] = [];
  const ex = new RedactingExporter({
    export: (s, done) => {
      sent = s;
      done({ code: 0 });
    },
    shutdown: async () => {},
  });
  ex.export([span], () => {});
  expect(sent[0]!.attributes).toEqual({
    'url.path': '/api/desk/apcm',
    'url.full': 'http://x/api/desk/apcm',
    'http.target': '/api/desk/apcm',
  });
  expect(JSON.stringify(sent)).not.toContain('Raj');
});
