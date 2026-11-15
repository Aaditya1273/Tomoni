/**
 * India bridge (Phase 4b): with no Blue Button, the family enters each medicine from the
 * prescription or pharmacy bill, with a photo as evidence. The warning engine then treats the
 * entry like any fill: supply = quantity ÷ doses a day, run-out when no refills are left.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AddMedicineBody, ErrorBody } from '@tomoni/contracts';
import { audit, schema, withScope } from '@tomoni/db';
import { today } from '@tomoni/medicines';
import { requireAuth } from '../auth/session';
import { imageType, LocalObjectStore, type ObjectStore } from '../lib/objects';

const MAX_PHOTO = 5 * 1024 * 1024;

export const familyMedicineRoutes =
  (deps: { queue: Queue; objects?: ObjectStore }): FastifyPluginAsyncZod =>
  async (app) => {
    const objects = deps.objects ?? new LocalObjectStore();

    app.post(
      '/api/family/patients/:id/medicines',
      {
        preHandler: requireAuth({ roles: ['family_member', 'patient', 'representative'] }),
        bodyLimit: 8 * 1024 * 1024,
        config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
        schema: {
          tags: ['family'],
          params: z.object({ id: z.uuid() }),
          body: AddMedicineBody,
          response: { 200: z.object({ fillId: z.uuid() }), 400: ErrorBody, 403: ErrorBody },
        },
      },
      async (req, reply) => {
        const b = req.body;
        const now = today();
        if (b.filledOn > now || b.filledOn < `${Number(now.slice(0, 4)) - 1}${now.slice(4)}`)
          return reply
            .code(400)
            .send({ error: 'bad_date', message: 'The fill date must be within the last year.' });
        let photo: Buffer | null = null;
        if (b.photo) {
          photo = Buffer.from(b.photo, 'base64');
          if (photo.length > MAX_PHOTO || !imageType(photo))
            return reply
              .code(400)
              .send({ error: 'bad_photo', message: 'Send a JPEG, PNG or WebP photo under 5 MB.' });
        }
        const key = photo ? `rx/${req.params.id}/${randomUUID()}` : null;
        if (key && photo) await objects.put(key, photo);
        try {
          const fillId = await withScope('app', req.auth!.scope, async (db) => {
            // One medication per name per patient; RLS allows this only for the family, outside the US.
            const [existing] = await db
              .select({ id: schema.medication.id })
              .from(schema.medication)
              .where(
                and(
                  eq(schema.medication.patientId, req.params.id),
                  eq(schema.medication.source, 'family'),
                  sql`lower(display_name) = lower(${b.name})`,
                ),
              );
            const medId =
              existing?.id ??
              (
                await db
                  .insert(schema.medication)
                  .values({ patientId: req.params.id, displayName: b.name, source: 'family' })
                  .returning({ id: schema.medication.id })
              )[0]!.id;
            const [f] = await db
              .insert(schema.fill)
              .values({
                patientId: req.params.id,
                medicationId: medId,
                fillDate: b.filledOn,
                daysSupply: Math.max(1, Math.ceil(b.quantity / b.dosesPerDay)),
                quantity: String(b.quantity),
                refillsRemaining: b.refillsLeft,
                source: 'manual',
                sourceRef: `family:${randomUUID()}`,
                evidenceRef: key,
              })
              .returning({ id: schema.fill.id });
            await audit(db, {
              action: 'create',
              entityType: 'fill',
              entityId: f!.id,
              patientId: req.params.id,
              purpose: 'treatment',
              details: { source: 'family', photo: !!key },
            });
            return f!.id;
          });
          await deps.queue.add('engine.run', { patientIds: [req.params.id] });
          return { fillId };
        } catch {
          return reply
            .code(403)
            .send({ error: 'forbidden', message: 'You cannot add medicines for this person here.' });
        }
      },
    );

    app.get(
      '/api/fills/:id/photo',
      { preHandler: requireAuth(), schema: { tags: ['family'], params: z.object({ id: z.uuid() }) } },
      async (req, reply) => {
        const fill = await withScope('app', req.auth!.scope, async (db) => {
          const [f] = await db
            .select({ id: schema.fill.id, key: schema.fill.evidenceRef, patientId: schema.fill.patientId })
            .from(schema.fill)
            .where(eq(schema.fill.id, req.params.id));
          if (f?.key)
            await audit(db, {
              action: 'read',
              entityType: 'fill_photo',
              entityId: f.id,
              patientId: f.patientId,
              purpose: 'treatment',
            });
          return f;
        });
        const bytes = fill?.key ? await objects.get(fill.key) : null;
        if (!bytes) return reply.code(404).send({ error: 'not_found', message: 'No photo.' });
        return reply
          .type(imageType(bytes)!)
          .header('content-disposition', 'inline')
          .header('cache-control', 'private, no-store')
          .send(bytes);
      },
    );
  };
