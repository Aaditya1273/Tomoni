/**
 * Early-warning engine (BUILD_PROMPT §5.2). Pure: facts in, warning drafts out.
 *
 *   change detector  – consecutive plan/formulary/price versions for each patient's plan
 *   matcher          – each change against the medicines the patient actually fills
 *   scorer           – the first refill the change hits → daysUntilProblem → Access status
 *
 * Every draft names its source (a fill or a data file version) and carries the evidence
 * a family member or auditor needs to check it by hand.
 */

export type WarningType =
  | 'run_out'
  | 'late_refill'
  | 'premium_jump'
  | 'formulary_removal'
  | 'tier_change'
  | 'negotiated_price_change'
  | 'pharmacy_closure'
  | 'shortage'
  | 'gene_drug_mismatch';
export type AccessStatus = 'green' | 'amber' | 'red';

export interface FillFact {
  id: string;
  patientId: string;
  medicationId: string | null;
  rxcui: string | null;
  ndc: string | null;
  name: string;
  fillDate: string;
  daysSupply: number;
  refillsRemaining: number | null;
  pharmacyId: string | null;
}
export interface FileRef {
  versionId: string;
  label: string;
  sourceUrl: string;
  effectiveDate: string;
}
export interface PlanVersion extends FileRef {
  year: number;
  planKey: string; // contract-plan-segment
  name: string;
  premiumCents: number;
  formularyId: string;
}
export interface Facts {
  today: string;
  fills: FillFact[];
  patientPlans: { patientId: string; year: number; planKey: string }[];
  plans: PlanVersion[];
  formulary: { versionId: string; formularyId: string; rxcui: string; tier: number }[];
  prices: { versionId: string; planKey: string; rxcui: string; costCents: number }[]; // 30-day supply
  pbmChanges: (FileRef & {
    formularyId: string;
    rxcui: string;
    change: 'removal' | 'tier_change';
    newTier: number | null;
    changeDate: string;
  })[];
  shortages: (FileRef & { rxcui: string; reportedOn: string; resolvedOn: string | null })[];
  closures: (FileRef & { pharmacyId: string; pharmacyName: string; closesOn: string })[];
  /** Pharmacogenomic results and CPIC rules (Gene-to-Pill). Optional: most patients have none. */
  pgx?: {
    resultId: string;
    patientId: string;
    gene: string;
    diplotype: string;
    phenotype: string;
    reportedAt: string;
    lab: string;
  }[];
  geneRules?: {
    gene: string;
    phenotype: string;
    rxcui: string;
    drug: string;
    recommendationCode: string;
    sourceUrl: string;
    version: string;
  }[];
}

export interface WarningDraft {
  patientId: string;
  medicationId: string | null;
  rxcui: string | null;
  type: WarningType;
  problemDate: string;
  daysUntilProblem: number;
  accessStatus: AccessStatus;
  sourceKind: 'fill' | 'data_file' | 'pgx';
  sourceRef: string;
  sourceDate: string;
  evidence: Record<string, unknown>;
  dedupeKey: string;
}

/** Days after the supply ends before a missing refill counts as late. */
export const LATE_GRACE_DAYS = 3;
/** A medicine not refilled for this long after its supply ended is treated as stopped. */
export const STOPPED_AFTER_DAYS = 30;
/** Changes that took effect longer ago than this are history, not news. */
export const RECENT_CHANGE_DAYS = 30;
/** A premium or price rise must clear both thresholds to be worth a warning. */
export const RISE_MIN_CENTS = 1000;
export const RISE_MIN_FRACTION = 0.2;

const DAY = 86_400_000;
const toDays = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const fromDays = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromDays(toDays(iso) + n);
export const daysBetween = (from: string, to: string) => Math.round(toDays(to) - toDays(from));

/** Access Score (§5.2): green = nothing known within 60 days, amber = 15–60, red = under 15. */
export function accessStatus(daysUntilProblem: number): AccessStatus {
  if (daysUntilProblem < 15) return 'red';
  if (daysUntilProblem <= 60) return 'amber';
  return 'green';
}

export const worst = (xs: AccessStatus[]): AccessStatus =>
  xs.includes('red') ? 'red' : xs.includes('amber') ? 'amber' : 'green';

const rose = (before: number, after: number) =>
  after - before >= RISE_MIN_CENTS && (before === 0 || (after - before) / before >= RISE_MIN_FRACTION);

interface Regimen {
  last: FillFact;
  runOut: string;
}

/** The first refill on or after `date`, assuming the patient keeps refilling on schedule. */
function firstRefillOnOrAfter(r: Regimen, date: string): string {
  let d = r.runOut;
  const step = Math.max(r.last.daysSupply, 1);
  while (d < date) d = addDays(d, step);
  return d;
}

export function detectWarnings(f: Facts): WarningDraft[] {
  const out: WarningDraft[] = [];
  const seen = new Set<string>();
  const { today } = f;
  const draft = (
    w: Omit<WarningDraft, 'daysUntilProblem' | 'accessStatus' | 'dedupeKey' | 'problemDate'> & {
      problemDate: string;
    },
  ) => {
    const dedupeKey = `${w.type}:${w.patientId}:${w.rxcui ?? '-'}:${w.sourceRef}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const problemDate = w.problemDate < today ? today : w.problemDate;
    const days = daysBetween(today, problemDate);
    out.push({ ...w, problemDate, daysUntilProblem: days, accessStatus: accessStatus(days), dedupeKey });
  };

  // ── Regimens: the latest fill of each medicine still being taken ────────────
  const latest = new Map<string, FillFact>();
  for (const x of f.fills) {
    // Claims name a drug by RxCUI or NDC; family-entered fills only by their medication.
    const k = `${x.patientId}|${x.rxcui ?? x.ndc ?? x.medicationId}`;
    const prev = latest.get(k);
    if (!prev || x.fillDate > prev.fillDate || (x.fillDate === prev.fillDate && x.id > prev.id))
      latest.set(k, x);
  }
  const regimens = new Map<string, Regimen[]>();
  for (const last of latest.values()) {
    const runOut = addDays(last.fillDate, last.daysSupply);
    if (daysBetween(runOut, today) > STOPPED_AFTER_DAYS) continue;
    const list = regimens.get(last.patientId) ?? [];
    list.push({ last, runOut });
    regimens.set(last.patientId, list);
  }

  const fillEvidence = (r: Regimen) => ({
    fillId: r.last.id,
    drug: r.last.name,
    fillDate: r.last.fillDate,
    daysSupply: r.last.daysSupply,
    runOutDate: r.runOut,
    refillsRemaining: r.last.refillsRemaining,
  });
  const fileEvidence = (v: FileRef) => ({
    versionId: v.versionId,
    label: v.label,
    sourceUrl: v.sourceUrl,
    effectiveDate: v.effectiveDate,
  });
  const medFields = (r: Regimen) => ({ medicationId: r.last.medicationId, rxcui: r.last.rxcui });

  for (const [patientId, meds] of regimens) {
    for (const r of meds) {
      // late refill: the supply ended and no new fill arrived
      if (daysBetween(r.runOut, today) >= LATE_GRACE_DAYS) {
        draft({
          patientId,
          ...medFields(r),
          type: 'late_refill',
          problemDate: r.runOut,
          sourceKind: 'fill',
          sourceRef: r.last.id,
          sourceDate: r.last.fillDate,
          evidence: { ...fillEvidence(r), daysWithout: daysBetween(r.runOut, today) },
        });
      } else if (r.last.refillsRemaining === 0 && r.runOut >= today) {
        // run-out: no refills left on the prescription, so the next fill needs the doctor
        draft({
          patientId,
          ...medFields(r),
          type: 'run_out',
          problemDate: r.runOut,
          sourceKind: 'fill',
          sourceRef: r.last.id,
          sourceDate: r.last.fillDate,
          evidence: fillEvidence(r),
        });
      }
    }
  }

  // ── Plan, formulary and price changes ───────────────────────────────────────
  const tierOf = new Map(f.formulary.map((e) => [`${e.versionId}|${e.formularyId}|${e.rxcui}`, e.tier]));
  const priceOf = new Map(f.prices.map((p) => [`${p.versionId}|${p.planKey}|${p.rxcui}`, p.costCents]));
  const versionsByPlan = new Map<string, PlanVersion[]>();
  for (const p of f.plans) {
    const list = versionsByPlan.get(p.planKey) ?? [];
    list.push(p);
    versionsByPlan.set(p.planKey, list);
  }
  const plansOf = new Map<string, { year: number; planKey: string }[]>();
  for (const pp of f.patientPlans) {
    const list = plansOf.get(pp.patientId) ?? [];
    list.push(pp);
    plansOf.set(pp.patientId, list);
  }
  const thisYear = Number(today.slice(0, 4));

  for (const [patientId, pps] of plansOf) {
    // The patient's own timeline: each year's plan contributes its versions for that year.
    const timeline = pps
      .flatMap((pp) => (versionsByPlan.get(pp.planKey) ?? []).filter((v) => v.year === pp.year))
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const meds = (regimens.get(patientId) ?? []).filter((r) => r.last.rxcui);

    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1]!;
      const next = timeline[i]!;
      if (daysBetween(next.effectiveDate, today) > RECENT_CHANGE_DAYS) continue;
      const both = { before: fileEvidence(prev), after: fileEvidence(next) };

      if (rose(prev.premiumCents, next.premiumCents)) {
        draft({
          patientId,
          medicationId: null,
          rxcui: null,
          type: 'premium_jump',
          problemDate: next.effectiveDate,
          sourceKind: 'data_file',
          sourceRef: next.versionId,
          sourceDate: next.effectiveDate,
          evidence: {
            ...both,
            plan: next.name,
            premiumBeforeCents: prev.premiumCents,
            premiumAfterCents: next.premiumCents,
          },
        });
      }

      for (const r of meds) {
        const rx = r.last.rxcui!;
        const tb = tierOf.get(`${prev.versionId}|${prev.formularyId}|${rx}`);
        const ta = tierOf.get(`${next.versionId}|${next.formularyId}|${rx}`);
        const hit = firstRefillOnOrAfter(r, next.effectiveDate);
        const base = {
          patientId,
          ...medFields(r),
          problemDate: hit,
          sourceKind: 'data_file' as const,
          sourceRef: next.versionId,
          sourceDate: next.effectiveDate,
        };
        if (tb !== undefined && ta === undefined) {
          draft({
            ...base,
            type: 'formulary_removal',
            evidence: { ...both, drug: r.last.name, plan: next.name, tierBefore: tb, fillId: r.last.id },
          });
        } else if (tb !== undefined && ta !== undefined && ta > tb) {
          draft({
            ...base,
            type: 'tier_change',
            evidence: {
              ...both,
              drug: r.last.name,
              plan: next.name,
              tierBefore: tb,
              tierAfter: ta,
              fillId: r.last.id,
            },
          });
        }
        const pb = priceOf.get(`${prev.versionId}|${prev.planKey}|${rx}`);
        const pa = priceOf.get(`${next.versionId}|${next.planKey}|${rx}`);
        if (pb !== undefined && pa !== undefined && ta !== undefined && rose(pb, pa)) {
          draft({
            ...base,
            type: 'negotiated_price_change',
            evidence: {
              ...both,
              drug: r.last.name,
              plan: next.name,
              cost30BeforeCents: pb,
              cost30AfterCents: pa,
              fillId: r.last.id,
            },
          });
        }
      }
    }

    // PBM change lists apply to the formulary the patient is on today.
    const current = timeline.filter((v) => v.year === thisYear && v.effectiveDate <= today).at(-1);
    if (!current) continue;
    for (const c of f.pbmChanges) {
      if (c.formularyId !== current.formularyId || daysBetween(c.changeDate, today) > RECENT_CHANGE_DAYS)
        continue;
      const r = meds.find((m) => m.last.rxcui === c.rxcui);
      if (!r) continue;
      const tierNow = tierOf.get(`${current.versionId}|${current.formularyId}|${c.rxcui}`);
      if (c.change === 'tier_change' && (tierNow === undefined || (c.newTier ?? 0) <= tierNow)) continue;
      draft({
        patientId,
        ...medFields(r),
        type: c.change === 'removal' ? 'formulary_removal' : 'tier_change',
        problemDate: firstRefillOnOrAfter(r, c.changeDate),
        sourceKind: 'data_file',
        sourceRef: c.versionId,
        sourceDate: c.changeDate,
        evidence: {
          after: fileEvidence(c),
          drug: r.last.name,
          plan: current.name,
          tierBefore: tierNow ?? null,
          tierAfter: c.newTier,
          fillId: r.last.id,
        },
      });
    }
  }

  // ── Shortages (per medicine) and pharmacy closures (per patient) ────────────
  for (const [patientId, meds] of regimens) {
    for (const r of meds) {
      for (const s of f.shortages) {
        if (s.rxcui !== r.last.rxcui || (s.resolvedOn !== null && s.resolvedOn <= today)) continue;
        draft({
          patientId,
          ...medFields(r),
          type: 'shortage',
          problemDate: firstRefillOnOrAfter(r, today),
          sourceKind: 'data_file',
          sourceRef: s.versionId,
          sourceDate: s.reportedOn,
          evidence: {
            after: fileEvidence(s),
            drug: r.last.name,
            reportedOn: s.reportedOn,
            fillId: r.last.id,
          },
        });
      }
    }
    for (const c of f.closures) {
      if (daysBetween(c.closesOn, today) > RECENT_CHANGE_DAYS) continue;
      const hit = meds.filter((r) => r.last.pharmacyId === c.pharmacyId);
      if (!hit.length) continue;
      const first = hit.map((r) => firstRefillOnOrAfter(r, c.closesOn)).sort()[0]!;
      draft({
        patientId,
        medicationId: null,
        rxcui: null,
        type: 'pharmacy_closure',
        problemDate: first,
        sourceKind: 'data_file',
        sourceRef: c.versionId,
        sourceDate: c.closesOn,
        evidence: {
          after: fileEvidence(c),
          pharmacy: c.pharmacyName,
          closesOn: c.closesOn,
          drugs: hit.map((r) => r.last.name),
          fillIds: hit.map((r) => r.last.id),
        },
      });
    }
  }
  // ── Gene-to-Pill: a medicine the patient takes now, against their genotype (doctor only) ──
  for (const res of f.pgx ?? []) {
    for (const r of regimens.get(res.patientId) ?? []) {
      const rule = (f.geneRules ?? []).find(
        (g) => g.gene === res.gene && g.phenotype === res.phenotype && g.rxcui === r.last.rxcui,
      );
      if (!rule) continue;
      draft({
        patientId: res.patientId,
        ...medFields(r),
        type: 'gene_drug_mismatch',
        problemDate: today,
        sourceKind: 'pgx',
        sourceRef: res.resultId,
        sourceDate: res.reportedAt,
        evidence: {
          drug: r.last.name,
          gene: res.gene,
          diplotype: res.diplotype,
          phenotype: res.phenotype,
          lab: res.lab,
          recommendation: rule.recommendationCode,
          guideline: rule.sourceUrl,
          guidelineVersion: rule.version,
          fillId: r.last.id,
        },
      });
    }
  }
  return out;
}
