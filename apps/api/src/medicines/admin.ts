/** Admin: PBM change-list upload with column mapping (BUILD_PROMPT §5.1), and the data file log. */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import { desc } from 'drizzle-orm';
import {
  DataFiles,
  ErrorBody,
  PbmCsvBody,
  PbmPreview,
  PbmUploadBody,
  PbmUploadResult,
} from '@tomoni/contracts';
import { schema, withScope } from '@tomoni/db';
import { applyPbmMapping, pbmPreview, savePbmChanges } from '@tomoni/medicines';
import { requireAuth } from '../auth/session';

const BODY = 3 * 1024 * 1024; // the CSV travels as a JSON string

export const adminRoutes =
  (deps: { queue: Queue }): FastifyPluginAsyncZod =>
  async (app) => {
    const guard = requireAuth({ roles: ['admin'] });

    app.get(
      '/api/admin/data-files',
      { preHandler: guard, schema: { tags: ['admin'], response: { 200: DataFiles } } },
      async (req) =>
        withScope('app', req.auth!.scope, async (db) =>
          (
            await db
              .select()
              .from(schema.dataFileVersion)
              .orderBy(desc(schema.dataFileVersion.loadedAt))
              .limit(100)
          ).map((v) => ({
            id: v.id,
            kind: v.kind,
            label: v.label,
            sourceUrl: v.sourceUrl,
            effectiveDate: v.effectiveDate,
            rowCount: v.rowCount,
            droppedCount: v.droppedCount,
            loadedAt: v.loadedAt.toISOString(),
          })),
        ),
    );

    app.post(
      '/api/admin/pbm/preview',
      {
        preHandler: guard,
        bodyLimit: BODY,
        schema: { tags: ['admin'], body: PbmCsvBody, response: { 200: PbmPreview } },
      },
      async (req) => pbmPreview(req.body.csv),
    );

    app.post(
      '/api/admin/pbm',
      {
        preHandler: guard,
        bodyLimit: BODY,
        schema: { tags: ['admin'], body: PbmUploadBody, response: { 200: PbmUploadResult, 400: ErrorBody } },
      },
      async (req, reply) => {
        const { csv, label, mapping } = req.body;
        const mapped = applyPbmMapping(csv, mapping);
        if (!mapped.ok)
          return reply
            .code(400)
            .send({
              error: 'bad_mapping',
              message: `These columns are not in the file: ${mapped.missing.join(', ')}.`,
            });
        const saved = await withScope('app', req.auth!.scope, (db) =>
          savePbmChanges(db, {
            text: csv,
            label,
            rows: mapped.rows,
            dropped: mapped.dropped.length + mapped.overLimit,
            loadedBy: req.auth!.userId,
          }),
        );
        if (saved.versionId) await deps.queue.add('engine.run', {});
        return {
          versionId: saved.versionId,
          saved: saved.saved,
          duplicate: saved.duplicate,
          unknownDrugs: saved.unknown,
          dropped: mapped.dropped.slice(0, 50),
          droppedCount: mapped.dropped.length + mapped.overLimit,
          total: mapped.total,
        };
      },
    );
  };
