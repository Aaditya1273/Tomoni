import { describe, expect, it } from 'vitest';
import { accessStatus, detectWarnings, type Facts, type FillFact, type PlanVersion } from '../src/engine';

const TODAY = '2026-11-15';
const fill = (o: Partial<FillFact> & Pick<FillFact, 'id' | 'fillDate'>): FillFact => ({
  patientId: 'p1',
  medicationId: 'm1',
  rxcui: '197361',
  ndc: '00093505601',
  name: 'Amlodipine 5 MG Oral Tablet',
  daysSupply: 30,
  refillsRemaining: null,
  pharmacyId: 'ph1',
  ...o,
});
const file = (versionId: string, effectiveDate: string) => ({
  versionId,
  label: `CMS ${versionId}`,
  sourceUrl: 'https://data.cms.gov/x',
  effectiveDate,
});
const plan = (versionId: string, effectiveDate: string, o: Partial<PlanVersion> = {}): PlanVersion => ({
  ...file(versionId, effectiveDate),
  year: Number(effectiveDate.slice(0, 4)),
  planKey: 'S5601-001-0',
  name: 'Demo PDP',
  premiumCents: 3800,
  formularyId: 'F1',
  ...o,
});
const facts = (o: Partial<Facts>): Facts => ({
  today: TODAY,
  fills: [],
  patientPlans: [],
  plans: [],
  formulary: [],
  prices: [],
  pbmChanges: [],
  shortages: [],
  closures: [],
  ...o,
});
const types = (f: Facts) => detectWarnings(f).map((w) => w.type);

describe('scorer', () => {
  it('maps days to Access status at the §5.2 boundaries', () => {
    expect([0, 14, 15, 60, 61].map(accessStatus)).toEqual(['red', 'red', 'amber', 'amber', 'green']);
  });
});

describe('fills', () => {
  it('flags a late refill once the grace period has passed, red, from the fill', () => {
    const [w] = detectWarnings(facts({ fills: [fill({ id: 'f1', fillDate: '2026-10-10' })] })); // ran out Nov 9
    expect(w).toMatchObject({
      type: 'late_refill',
      accessStatus: 'red',
      daysUntilProblem: 0,
      sourceKind: 'fill',
      sourceRef: 'f1',
      sourceDate: '2026-10-10',
    });
    expect(w!.evidence).toMatchObject({ runOutDate: '2026-11-09', daysWithout: 6 });
  });

  it('is quiet inside the grace period and when the newest fill covers today', () => {
    expect(types(facts({ fills: [fill({ id: 'f1', fillDate: '2026-10-14' })] }))).toEqual([]); // ran out Nov 13
    expect(
      types(
        facts({
          fills: [fill({ id: 'f1', fillDate: '2026-09-01' }), fill({ id: 'f2', fillDate: '2026-11-01' })],
        }),
      ),
    ).toEqual([]);
  });

  it('treats a medicine not refilled for over 30 days as stopped', () => {
    expect(types(facts({ fills: [fill({ id: 'f1', fillDate: '2026-09-01' })] }))).toEqual([]);
  });

  it('warns of a run-out only when no refills remain', () => {
    const f = (r: number | null) =>
      facts({ fills: [fill({ id: 'f1', fillDate: '2026-10-25', refillsRemaining: r })] });
    expect(types(f(2))).toEqual([]);
    expect(types(f(null))).toEqual([]);
    const [w] = detectWarnings(f(0));
    expect(w).toMatchObject({
      type: 'run_out',
      problemDate: '2026-11-24',
      daysUntilProblem: 9,
      accessStatus: 'red',
    });
  });
});

describe('plan and formulary changes', () => {
  const base = {
    fills: [fill({ id: 'f1', fillDate: '2026-11-01' })], // runs out Dec 1, then Dec 31, Jan 30
    patientPlans: [
      { patientId: 'p1', year: 2026, planKey: 'S5601-001-0' },
      { patientId: 'p1', year: 2027, planKey: 'S5601-001-0' },
    ],
  };
  const v26 = plan('v26', '2026-01-01');
  const v27 = plan('v27', '2027-01-01', { premiumCents: 6100, formularyId: 'F2' });
  const entries = (tier27: number | null) => [
    { versionId: 'v26', formularyId: 'F1', rxcui: '197361', tier: 2 },
    ...(tier27 === null ? [] : [{ versionId: 'v27', formularyId: 'F2', rxcui: '197361', tier: tier27 }]),
  ];

  it('detects a tier rise across years, hitting the first refill on or after Jan 1', () => {
    const ws = detectWarnings(facts({ ...base, plans: [v26, v27], formulary: entries(4) }));
    const tier = ws.find((w) => w.type === 'tier_change')!;
    expect(tier).toMatchObject({
      problemDate: '2027-01-30',
      daysUntilProblem: 76,
      accessStatus: 'green',
      sourceRef: 'v27',
      sourceDate: '2027-01-01',
    });
    expect(tier.evidence).toMatchObject({ tierBefore: 2, tierAfter: 4, before: { versionId: 'v26' } });
  });

  it('detects a removal and a premium jump, and nothing when the tier drops', () => {
    expect(types(facts({ ...base, plans: [v26, v27], formulary: entries(null) })).sort()).toEqual([
      'formulary_removal',
      'premium_jump',
    ]);
    expect(
      types(facts({ ...base, plans: [v26, { ...v27, premiumCents: 3900 }], formulary: entries(1) })),
    ).toEqual([]);
  });

  it('ignores a rise under both thresholds and ignores medicines the patient does not take', () => {
    expect(
      types(facts({ ...base, plans: [v26, { ...v27, premiumCents: 4300 }], formulary: entries(2) })),
    ).toEqual([]);
    const other = [{ versionId: 'v26', formularyId: 'F1', rxcui: '999', tier: 1 }];
    expect(types(facts({ ...base, plans: [v26, { ...v27, premiumCents: 3800 }], formulary: other }))).toEqual(
      [],
    );
  });

  it('flags a negotiated-price rise on a covered drug', () => {
    const ws = detectWarnings(
      facts({
        ...base,
        plans: [v26, { ...v27, premiumCents: 3800 }],
        formulary: entries(2),
        prices: [
          { versionId: 'v26', planKey: 'S5601-001-0', rxcui: '197361', costCents: 400 },
          { versionId: 'v27', planKey: 'S5601-001-0', rxcui: '197361', costCents: 2200 },
        ],
      }),
    );
    expect(ws.map((w) => w.type)).toEqual(['negotiated_price_change']);
    expect(ws[0]!.evidence).toMatchObject({ cost30BeforeCents: 400, cost30AfterCents: 2200 });
  });

  it('applies a PBM change list to the formulary the patient is on today', () => {
    const pbm = {
      ...file('pbm1', '2026-11-10'),
      formularyId: 'F1',
      rxcui: '197361',
      change: 'removal' as const,
      newTier: null,
      changeDate: '2026-12-01',
    };
    const ws = detectWarnings(facts({ ...base, plans: [v26], formulary: entries(null), pbmChanges: [pbm] }));
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      type: 'formulary_removal',
      problemDate: '2026-12-01',
      accessStatus: 'amber',
    });
    expect(
      types(
        facts({
          ...base,
          plans: [v26],
          formulary: entries(null),
          pbmChanges: [{ ...pbm, formularyId: 'F9' }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('shortages and closures', () => {
  const fills = [fill({ id: 'f1', fillDate: '2026-11-01' })];
  it('flags an unresolved shortage at the next refill', () => {
    const s = { ...file('s1', '2026-11-01'), rxcui: '197361', reportedOn: '2026-11-01', resolvedOn: null };
    expect(detectWarnings(facts({ fills, shortages: [s] }))[0]).toMatchObject({
      type: 'shortage',
      problemDate: '2026-12-01',
    });
    expect(types(facts({ fills, shortages: [{ ...s, resolvedOn: '2026-11-10' }] }))).toEqual([]);
  });

  it('flags the first refill after the pharmacy closes, once per patient', () => {
    const c = {
      ...file('c1', '2026-11-05'),
      pharmacyId: 'ph1',
      pharmacyName: 'Main St Pharmacy',
      closesOn: '2026-12-10',
    };
    const two = [...fills, fill({ id: 'f9', rxcui: '861007', medicationId: 'm2', fillDate: '2026-11-12' })]; // Dec 12
    const ws = detectWarnings(facts({ fills: two, closures: [c] }));
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      type: 'pharmacy_closure',
      problemDate: '2026-12-12',
      daysUntilProblem: 27,
      rxcui: null,
    });
    expect(ws[0]!.evidence).toMatchObject({ fillIds: ['f1', 'f9'] });
    expect(types(facts({ fills, closures: [{ ...c, pharmacyId: 'other' }] }))).toEqual([]);
  });
});

describe('dedupe keys', () => {
  it('are stable for the same facts and change when a new fill arrives', () => {
    const a = detectWarnings(facts({ fills: [fill({ id: 'f1', fillDate: '2026-10-10' })] }));
    const b = detectWarnings(facts({ fills: [fill({ id: 'f1', fillDate: '2026-10-10' })] }));
    expect(a[0]!.dedupeKey).toBe(b[0]!.dedupeKey);
    const c = detectWarnings(facts({ fills: [fill({ id: 'f2', fillDate: '2026-10-11' })] }));
    expect(c[0]!.dedupeKey).not.toBe(a[0]!.dedupeKey);
  });
});

describe('Gene-to-Pill (doctor only)', () => {
  const rule = {
    gene: 'CYP2C19',
    phenotype: 'Poor Metabolizer',
    rxcui: '309362',
    drug: 'clopidogrel',
    recommendationCode: 'avoid_consider_alternative',
    sourceUrl: 'https://cpicpgx.org/guidelines/guideline-for-clopidogrel-and-cyp2c19/',
    version: '2022',
  };
  const res = {
    resultId: 'r1',
    patientId: 'p1',
    gene: 'CYP2C19',
    diplotype: '*2/*2',
    phenotype: 'Poor Metabolizer',
    reportedAt: '2026-11-10',
    lab: 'Demo Lab',
  };
  const clopidogrel = fill({
    id: 'f1',
    fillDate: '2026-11-01',
    rxcui: '309362',
    name: 'clopidogrel 75 MG Oral Tablet',
  });

  it('a poor metabolizer on clopidogrel raises a mismatch citing CPIC', () => {
    const [w] = detectWarnings(facts({ fills: [clopidogrel], pgx: [res], geneRules: [rule] }));
    expect(w).toMatchObject({
      type: 'gene_drug_mismatch',
      sourceKind: 'pgx',
      sourceRef: 'r1',
      accessStatus: 'red',
    });
    expect(w!.evidence).toMatchObject({ gene: 'CYP2C19', diplotype: '*2/*2', guideline: rule.sourceUrl });
  });
  it('no rule for the phenotype, or not taking the drug: nothing', () => {
    expect(
      types(
        facts({
          fills: [clopidogrel],
          pgx: [{ ...res, phenotype: 'Normal Metabolizer' }],
          geneRules: [rule],
        }),
      ),
    ).toEqual([]);
    expect(
      types(facts({ fills: [fill({ id: 'f2', fillDate: '2026-11-01' })], pgx: [res], geneRules: [rule] })),
    ).toEqual([]);
  });
});
