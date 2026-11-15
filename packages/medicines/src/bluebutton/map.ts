/**
 * FHIR ExplanationOfBenefit (Blue Button 2.0 v2, CARIN BB profiles) → fill / claim.
 * Only the fields Tomoni uses are read, each checked; an EOB that lacks them is dropped and
 * counted rather than half-imported.
 */
import { z } from 'zod';

const Coding = z.object({
  system: z.string().optional(),
  code: z.string().optional(),
  display: z.string().optional(),
});
const Concept = z.object({ coding: z.array(Coding).optional() });
const Period = z.object({ start: z.iso.date().optional(), end: z.iso.date().optional() });

export const Eob = z.object({
  resourceType: z.literal('ExplanationOfBenefit'),
  id: z.string().regex(/^[A-Za-z0-9\-.]{1,64}$/),
  type: Concept,
  billablePeriod: Period.optional(),
  facility: z
    .object({ identifier: z.object({ system: z.string(), value: z.string() }).optional() })
    .optional(),
  provider: z
    .object({ identifier: z.object({ system: z.string(), value: z.string() }).optional() })
    .optional(),
  supportingInfo: z
    .array(
      z.object({
        category: Concept,
        valueQuantity: z.object({ value: z.number() }).optional(),
      }),
    )
    .optional(),
  diagnosis: z.array(z.object({ diagnosisCodeableConcept: Concept.optional() })).optional(),
  item: z
    .array(
      z.object({
        productOrService: Concept,
        servicedDate: z.iso.date().optional(),
        quantity: z.object({ value: z.number() }).optional(),
        adjudication: z
          .array(z.object({ category: Concept, amount: z.object({ value: z.number() }).optional() }))
          .optional(),
      }),
    )
    .optional(),
});
export type Eob = z.infer<typeof Eob>;

export interface MappedFill {
  kind: 'fill';
  sourceRef: string;
  ndc: string;
  name: string | null;
  fillDate: string;
  daysSupply: number;
  quantity: number;
  fillNumber: number | null;
  refillsAuthorized: number | null;
  pharmacyNpi: string | null;
  patientPaidCents: number | null;
}
export interface MappedClaim {
  kind: 'claim';
  sourceRef: string;
  claimKind: 'inpatient' | 'outpatient' | 'carrier' | 'snf' | 'hha' | 'hospice';
  startDate: string;
  endDate: string | null;
  dxCodes: string[];
}

const EOB_TYPE = 'https://bluebutton.cms.gov/resources/codesystem/eob-type';
const NDC = 'http://hl7.org/fhir/sid/ndc';
const NPI = 'http://hl7.org/fhir/sid/us-npi';
const CLAIM_KINDS = {
  INPATIENT: 'inpatient',
  OUTPATIENT: 'outpatient',
  CARRIER: 'carrier',
  SNF: 'snf',
  HHA: 'hha',
  HOSPICE: 'hospice',
} as const;

const codes = (c: z.infer<typeof Concept> | undefined) => c?.coding ?? [];
const info = (e: Eob, code: string) =>
  e.supportingInfo?.find((s) => codes(s.category).some((c) => c.code?.toLowerCase() === code))?.valueQuantity
    ?.value;

/** Map one EOB. Returns null for EOB types Tomoni doesn't use, or when a required field is missing. */
export function mapEob(raw: unknown): MappedFill | MappedClaim | null {
  const p = Eob.safeParse(raw);
  if (!p.success) return null;
  const e = p.data;
  const type = codes(e.type)
    .find((c) => c.system === EOB_TYPE)
    ?.code?.toUpperCase();
  if (type === 'PDE') {
    const item = e.item?.[0];
    const ndc = codes(item?.productOrService).find((c) => c.system === NDC);
    const days = info(e, 'dayssupply');
    const fillDate = item?.servicedDate ?? e.billablePeriod?.start;
    const qty = item?.quantity?.value;
    if (
      !ndc?.code ||
      !/^\d{11}$/.test(ndc.code) ||
      !fillDate ||
      !days ||
      days < 1 ||
      days > 365 ||
      !qty ||
      qty <= 0
    )
      return null;
    const npi =
      [e.facility?.identifier, e.provider?.identifier].find((i) => i?.system === NPI)?.value ?? null;
    const paid = item?.adjudication?.find((a) =>
      codes(a.category).some((c) => c.code === 'paidbypatient' || c.code?.endsWith('ptnt_pay_amt')),
    )?.amount?.value;
    const int = (v: number | undefined) => (v === undefined || !Number.isInteger(v) || v < 0 ? null : v);
    return {
      kind: 'fill',
      sourceRef: e.id,
      ndc: ndc.code,
      name: ndc.display?.slice(0, 200) ?? null,
      fillDate,
      daysSupply: Math.round(days),
      quantity: qty,
      fillNumber: int(info(e, 'refillnum')),
      refillsAuthorized: int(info(e, 'refillsauthorized')),
      pharmacyNpi: npi && /^\d{10}$/.test(npi) ? npi : null,
      patientPaidCents: paid === undefined || paid < 0 ? null : Math.round(paid * 100),
    };
  }
  const kind = type ? CLAIM_KINDS[type as keyof typeof CLAIM_KINDS] : undefined;
  if (!kind || !e.billablePeriod?.start) return null;
  return {
    kind: 'claim',
    sourceRef: e.id,
    claimKind: kind,
    startDate: e.billablePeriod.start,
    endDate: e.billablePeriod.end ?? null,
    dxCodes: [
      ...new Set(
        (e.diagnosis ?? [])
          .flatMap((d) => codes(d.diagnosisCodeableConcept))
          .map((c) => c.code)
          .filter((c): c is string => !!c && /^[A-Z0-9.]{3,8}$/.test(c)),
      ),
    ].slice(0, 25),
  };
}

/** Pull the EOB resources out of one or more FHIR search Bundles. */
export function eobsFromBundles(bundles: unknown[]): unknown[] {
  return bundles.flatMap((b) => {
    const entries = (b as { entry?: { resource?: unknown }[] })?.entry;
    return Array.isArray(entries) ? entries.map((x) => x?.resource).filter(Boolean) : [];
  });
}
