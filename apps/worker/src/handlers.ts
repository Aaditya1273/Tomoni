import { eq, sql } from 'drizzle-orm';
import { systemScope } from '@tomoni/core';
import type { JobData, JobName } from '@tomoni/contracts';
import { pool, schema, withScope } from '@tomoni/db';
import { blueButtonFromEnv, ingestBundles, runEngine, today, type BlueButton } from '@tomoni/medicines';

let bb: BlueButton | undefined;
const blueButton = () => (bb ??= blueButtonFromEnv());

export const handlers: { [N in JobName]: (data: JobData<N>) => Promise<unknown> } = {
  async 'audit.seal'() {
    const { rows } = await pool('worker').query<{ n: number }>('SELECT audit.seal(5000) AS n');
    return { sealed: rows[0]?.n ?? 0 };
  },

  'engine.run': ({ patientIds }) =>
    withScope('worker', systemScope('engine'), (db) =>
      runEngine(db, { today: today(), ...(patientIds ? { patientIds } : {}) }),
    ),

  async 'bluebutton.sync'({ patientId }) {
    const adapter = blueButton();
    const scope = systemScope('bluebutton.sync');
    const link = await withScope('worker', scope, async (db) => {
      const [l] = await db
        .select()
        .from(schema.bluebuttonLink)
        .where(eq(schema.bluebuttonLink.patientId, patientId));
      return l;
    });
    if (!link || link.revokedAt) return { skipped: 'not connected' };
    if (link.mode !== adapter.mode) return { skipped: `link is ${link.mode}, adapter is ${adapter.mode}` };

    let tokens = {
      fhirPatientId: link.fhirPatientId,
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      expiresAt: link.expiresAt,
      scope: link.scope,
    };
    if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now() + 60_000)
      tokens = await adapter.refresh(tokens);
    // The mock's data is a snapshot as of the day the family connected, so re-syncs are idempotent.
    const asOf = adapter.mode === 'mock' ? link.connectedAt.toISOString().slice(0, 10) : today();
    const bundles = await adapter.fetchBundles(tokens, asOf); // network call outside any DB transaction

    return withScope('worker', scope, async (db) => {
      const r = await ingestBundles(db, patientId, bundles, adapter.mode === 'mock' ? 'mock' : 'bluebutton');
      await db
        .update(schema.bluebuttonLink)
        .set({
          lastSyncedAt: sql`now()`,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        })
        .where(eq(schema.bluebuttonLink.patientId, patientId));
      const engine = await runEngine(db, { today: today(), patientIds: [patientId] });
      return { ...r, warnings: engine.open };
    });
  },
};
