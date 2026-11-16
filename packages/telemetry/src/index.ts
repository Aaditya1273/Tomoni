/**
 * OpenTelemetry for the API and worker (BUILD_PROMPT Phase 7). Off unless
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. Spans never carry PHI: no request bodies or headers are
 * recorded, query strings are stripped before export (they can carry ids or names, as with
 * logs, SECURITY S13), and SQL is recorded as parameterized text without values.
 */
import { context } from '@opentelemetry/api';

export { metrics } from '@opentelemetry/api';
import { getRPCMetadata, RPCType } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';

const QUERY_KEYS = ['url.query', 'http.target', 'url.full', 'http.url'];

/** Removes query strings from every span attribute that can hold one. */
export function stripQueries(span: ReadableSpan): ReadableSpan {
  const attrs = span.attributes as Record<string, unknown>;
  for (const k of QUERY_KEYS) {
    const v = attrs[k];
    if (k === 'url.query') delete attrs[k];
    else if (typeof v === 'string' && v.includes('?')) attrs[k] = v.slice(0, v.indexOf('?'));
  }
  return span;
}

export class RedactingExporter implements SpanExporter {
  constructor(private inner: SpanExporter) {}
  export(spans: ReadableSpan[], done: Parameters<SpanExporter['export']>[1]) {
    this.inner.export(spans.map(stripQueries), done);
  }
  shutdown() {
    return this.inner.shutdown();
  }
  forceFlush() {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/** Name the HTTP span and its duration metric by route template (`/api/warnings/:id`), never the raw path. */
export function setRoute(method: string, route: string | undefined) {
  if (!route) return;
  const rpc = getRPCMetadata(context.active());
  if (rpc?.type === RPCType.HTTP) {
    rpc.route = route;
    rpc.span.updateName(`${method} ${route}`);
  }
}
