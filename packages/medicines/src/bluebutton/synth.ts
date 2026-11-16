/**
 * Synthetic Blue Button data for `MockBlueButton` and the dev seed (DECISIONS D-012).
 * Deterministic: the same beneficiary id and reference date always give the same EOBs, so
 * re-syncing is idempotent. Output is FHIR EOB JSON in the CARIN BB shape the real sandbox
 * returns, and goes through the same `mapEob` as real data.
 */
import { addDays } from '../engine';

export interface SynthDrug {
  ndc: string;
  rxcui: string;
  name: string;
}
/** A planted medicine: when it was last filled and what is left on the prescription. */
export interface Plant {
  rxcui: string;
  lastFillDaysAgo: number;
  daysSupply?: 30 | 90;
  refillsLeft?: number;
  pharmacyNpi?: string;
}
export interface Scenario {
  meds: Plant[];
}

const DX: Record<string, string> = {
  '861007': 'E11.9',
  '665033': 'E11.9',
  '1545653': 'E11.9',
  '197361': 'I10',
  '314076': 'I10',
  '979485': 'I10',
  '310798': 'I10',
  '866436': 'I10',
  '617310': 'E78.5',
  '198211': 'E78.5',
  '1364445': 'I48.91',
  '855332': 'I48.91',
  '966222': 'E03.9',
  '309362': 'I25.10',
  '745679': 'J44.9',
  '863669': 'N40.0',
};
const CHRONIC = Object.keys(DX);

function prng(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C4BB = 'http://hl7.org/fhir/us/carin-bb/CodeSystem/C4BBSupportingInfoType';
const EOB_TYPE = 'https://bluebutton.cms.gov/resources/codesystem/eob-type';
const compact = (d: string) => d.replaceAll('-', '');

function pde(
  id: string,
  d: SynthDrug,
  date: string,
  days: number,
  fillNum: number,
  authorized: number,
  npi: string,
  paid: number,
) {
  return {
    resourceType: 'ExplanationOfBenefit',
    id,
    status: 'active',
    type: {
      coding: [
        { system: EOB_TYPE, code: 'PDE' },
        { system: 'http://terminology.hl7.org/CodeSystem/claim-type', code: 'pharmacy' },
      ],
    },
    billablePeriod: { start: date, end: date },
    facility: { identifier: { system: 'http://hl7.org/fhir/sid/us-npi', value: npi } },
    supportingInfo: [
      {
        sequence: 1,
        category: { coding: [{ system: C4BB, code: 'dayssupply' }] },
        valueQuantity: { value: days },
      },
      {
        sequence: 2,
        category: { coding: [{ system: C4BB, code: 'refillnum' }] },
        valueQuantity: { value: fillNum },
      },
      {
        sequence: 3,
        category: { coding: [{ system: C4BB, code: 'refillsAuthorized' }] },
        valueQuantity: { value: authorized },
      },
    ],
    item: [
      {
        sequence: 1,
        productOrService: {
          coding: [{ system: 'http://hl7.org/fhir/sid/ndc', code: d.ndc, display: d.name }],
        },
        servicedDate: date,
        quantity: { value: days },
        adjudication: [
          {
            category: {
              coding: [
                {
                  system: 'http://hl7.org/fhir/us/carin-bb/CodeSystem/C4BBAdjudication',
                  code: 'paidbypatient',
                },
              ],
            },
            amount: { value: paid, currency: 'USD' },
          },
        ],
      },
    ],
  };
}

function visit(
  id: string,
  kind: 'CARRIER' | 'INPATIENT' | 'OUTPATIENT',
  start: string,
  end: string,
  dx: string[],
  revenue?: string,
) {
  return {
    resourceType: 'ExplanationOfBenefit',
    id,
    status: 'active',
    type: { coding: [{ system: EOB_TYPE, code: kind }] },
    billablePeriod: { start, end },
    diagnosis: dx.map((code, i) => ({
      sequence: i + 1,
      diagnosisCodeableConcept: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code }] },
    })),
    ...(revenue
      ? {
          item: [
            {
              sequence: 1,
              revenue: {
                coding: [
                  { system: 'https://bluebutton.cms.gov/resources/variables/rev_cntr', code: revenue },
                ],
              },
              productOrService: {
                coding: [{ system: 'https://bluebutton.cms.gov/resources/codesystem/hcpcs', code: '99284' }],
              },
            },
          ],
        }
      : {}),
  };
}

export interface SynthInput {
  beneficiaryId: string;
  refDate: string;
  drugs: SynthDrug[];
  pharmacyNpis: string[];
  scenario?: Scenario;
}

/** Six months of fills and visits up to `refDate`, as one FHIR searchset Bundle. */
export function synthBundle(inp: SynthInput) {
  const rnd = prng(inp.beneficiaryId);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const byRx = new Map(inp.drugs.map((d) => [d.rxcui, d]));
  const tag = inp.beneficiaryId.replace(/[^A-Za-z0-9]/g, '').slice(-12);
  const home = pick(inp.pharmacyNpis);

  let plants = inp.scenario?.meds;
  if (!plants) {
    const n = 2 + Math.floor(rnd() * 4);
    const chosen = new Set<string>();
    while (chosen.size < n) chosen.add(pick(CHRONIC));
    plants = [...chosen].map((rxcui) => {
      const daysSupply = rnd() < 0.7 ? 30 : 90;
      const roll = rnd();
      if (roll < 0.03) return { rxcui, daysSupply, lastFillDaysAgo: daysSupply + 4 + Math.floor(rnd() * 16) }; // late
      if (roll < 0.06)
        return {
          rxcui,
          daysSupply,
          lastFillDaysAgo: Math.max(0, daysSupply - 5 - Math.floor(rnd() * 30)),
          refillsLeft: 0,
        };
      return { rxcui, daysSupply, lastFillDaysAgo: Math.floor(rnd() * (daysSupply - 4)) };
    });
  }

  const entry: unknown[] = [];
  for (const p of plants) {
    const d = byRx.get(p.rxcui);
    if (!d) continue;
    const days = p.daysSupply ?? 30;
    const authorized = days === 90 ? 3 : 11;
    let fillNum = authorized - (p.refillsLeft ?? 1 + Math.floor(rnd() * (authorized - 1)));
    const npi = p.pharmacyNpi ?? home;
    let date = addDays(inp.refDate, -p.lastFillDaysAgo);
    const start = addDays(inp.refDate, -180);
    while (date >= start) {
      const paid = Math.round((1 + rnd() * 9) * 100) / 100;
      entry.push({
        resource: pde(
          `pde-${tag}-${d.rxcui}-${compact(date)}`,
          d,
          date,
          days,
          fillNum,
          authorized,
          npi,
          paid,
        ),
      });
      fillNum = fillNum === 0 ? authorized : fillNum - 1;
      date = addDays(date, -(days + Math.floor(rnd() * 3)));
    }
  }

  const dx = [...new Set(plants.map((p) => DX[p.rxcui]).filter((x): x is string => !!x))];
  for (let k = 0; k < 2; k++) {
    const day = addDays(inp.refDate, -(20 + k * 90 + Math.floor(rnd() * 30)));
    entry.push({ resource: visit(`carrier-${tag}-${compact(day)}`, 'CARRIER', day, day, dx) });
  }
  if (rnd() < 0.04) {
    const adm = addDays(inp.refDate, -(30 + Math.floor(rnd() * 120)));
    entry.push({
      resource: visit(`inpatient-${tag}-${compact(adm)}`, 'INPATIENT', adm, addDays(adm, 3), [
        dx[0] ?? 'I50.9',
      ]),
    });
  }
  if (rnd() < 0.06) {
    const day = addDays(inp.refDate, -(10 + Math.floor(rnd() * 150)));
    entry.push({ resource: visit(`ed-${tag}-${compact(day)}`, 'OUTPATIENT', day, day, ['R07.9'], '0450') });
  }
  return { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry };
}
