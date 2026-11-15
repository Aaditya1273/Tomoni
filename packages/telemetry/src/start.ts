// Import first in each entry point, before anything that loads http, pg or ioredis.
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { RedactingExporter } from './index';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= 'http';
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'tomoni',
    traceExporter: new RedactingExporter(new OTLPTraceExporter()),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/api/system/health' || req.url === '/api/events',
        // No headers: they carry cookies and CSRF tokens.
        headersToSpanAttributes: { server: { requestHeaders: [], responseHeaders: [] } },
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }), // SQL text only, never values
      new IORedisInstrumentation({ dbStatementSerializer: (cmd) => cmd }), // command name, no keys or values
    ],
  });
  sdk.start();
  const stop = () => void sdk.shutdown();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
