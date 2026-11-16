/**
 * Blue Button EOBs → care.medication / care.fill / care.claim for one patient. Idempotent:
 * an EOB id that is already stored is skipped (UNIQUE(source, source_ref)).
 */
import { sql } from 'drizzle-orm';
import { audit, schema, type Db } from '@tomoni/db';
import { eobsFromBundles, mapEob, type MappedClaim, type MappedFill } from './bluebutton/map';

export interface IngestResult {
  fills: number;
  claims: number;
  skipped: number;
}

export async function ingestBundles(
  db: Db,
  patientId: string,
  bundles: unknown[],
  source: 'bluebutton' | 'mock',
): Promise<IngestResult> {
  const mapped = eobsFromBundles(bundles).map(mapEob);
  const fills = mapped.filter((m): m is MappedFill => m?.kind === 'fill');
  const claims = mapped.filter((m): m is MappedClaim => m?.kind === 'claim');
  const skipped = mapped.length - fills.length - claims.length;

  const ndcs = [...new Set(fills.map((f) => f.ndc))];
  const npis = [...new Set(fills.map((f) => f.pharmacyNpi).filter((n): n is string => !!n))];
  const drugs = ndcs.length
    ? (
        await db.execute<{ ndc: string; rxcui: string; name: string }>(
          sql`SELECT ndc, rxcui, name FROM care.drug WHERE ndc = ANY(${sql.param(ndcs)}::text[])`,
        )
      ).rows
    : [];
  const pharmacies = npis.length
    ? (
        await db.execute<{ id: string; npi: string }>(
          sql`SELECT id, npi FROM care.pharmacy WHERE npi = ANY(${sql.param(npis)}::text[])`,
        )
      ).rows
    : [];
  const drugOf = new Map(drugs.map((d) => [d.ndc, d]));
  const pharmacyOf = new Map(pharmacies.map((p) => [p.npi, p.id]));

  // One medication per drug the claims show; names from the drug list, else the EOB display.
  const meds = new Map<string, string>();
  for (const f of fills) {
    const d = drugOf.get(f.ndc);
    if (d && !meds.has(d.rxcui)) meds.set(d.rxcui, d.name.startsWith('RxCUI ') ? (f.name ?? d.name) : d.name);
  }
  const medIds = new Map<string, string>();
  if (meds.size) {
    const rows = await db
      .insert(schema.medication)
      .values(
        [...meds].map(([rxcui, displayName]) => ({
          patientId,
          rxcui,
          displayName,
          source: 'claims' as const,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.medication.patientId, schema.medication.rxcui],
        targetWhere: sql`rxcui IS NOT NULL`,
        set: { active: true },
      })
      .returning({ id: schema.medication.id, rxcui: schema.medication.rxcui });
    for (const r of rows) medIds.set(r.rxcui!, r.id);
  }

  let fillCount = 0;
  if (fills.length) {
    const rows = await db
      .insert(schema.fill)
      .values(
        fills.map((f) => {
          const rxcui = drugOf.get(f.ndc)?.rxcui ?? null;
          return {
            patientId,
            medicationId: rxcui ? (medIds.get(rxcui) ?? null) : null,
            ndc: f.ndc,
            rxcui,
            fillDate: f.fillDate,
            daysSupply: f.daysSupply,
            quantity: String(f.quantity),
            fillNumber: f.fillNumber,
            refillsRemaining:
              f.refillsAuthorized !== null && f.fillNumber !== null
                ? Math.max(0, f.refillsAuthorized - f.fillNumber)
                : null,
            pharmacyId: f.pharmacyNpi ? (pharmacyOf.get(f.pharmacyNpi) ?? null) : null,
            patientPaidCents: f.patientPaidCents,
            source,
            sourceRef: f.sourceRef,
          };
        }),
      )
      .onConflictDoNothing({ target: [schema.fill.source, schema.fill.sourceRef] })
      .returning({ id: schema.fill.id });
    fillCount = rows.length;
  }

  let claimCount = 0;
  if (claims.length) {
    const rows = await db
      .insert(schema.claim)
      .values(
        claims.map((c) => ({
          patientId,
          kind: c.claimKind,
          startDate: c.startDate,
          endDate: c.endDate,
          dxCodes: c.dxCodes,
          edVisit: c.edVisit,
          source,
          sourceRef: c.sourceRef,
        })),
      )
      .onConflictDoNothing({ target: [schema.claim.source, schema.claim.sourceRef] })
      .returning({ id: schema.claim.id });
    claimCount = rows.length;
  }

  if (fillCount || claimCount)
    await audit(db, {
      action: 'create',
      entityType: 'fill',
      patientId,
      purpose: 'treatment',
      details: { source, fills: fillCount, claims: claimCount, skipped },
    });
  return { fills: fillCount, claims: claimCount, skipped };
}
