/**
 * The scripted demo households (DATA_MODEL "Synthetic seed"). Synthetic MBIs start with 0, which
 * no real Medicare Beneficiary Identifier does, so they can never match a real person.
 */
import { hashFor } from '@tomoni/db';
import type { Scenario } from './synth';

export const RAJ_MBI = '0EG4TE5MK73';
export const KOKILA_MBI = '0EG4TE5MK74';

/** The mock's stand-in for the FHIR patient id CMS would return. Derived, never the MBI itself. */
export const mockBeneficiaryId = (mbi: string) => `mock-${hashFor.mbi(mbi).toString('hex').slice(0, 24)}`;

const SCRIPTED: Record<string, Scenario> = {
  // Raj: clopidogrel runs out in 9 days with no refills left; sitagliptin moves up a tier on
  // Jan 1 and his next refill after that is Jan 3; his plan premium jumps for 2027.
  [RAJ_MBI]: {
    meds: [
      { rxcui: '861007', lastFillDaysAgo: 12 },
      { rxcui: '197361', lastFillDaysAgo: 5 },
      { rxcui: '617310', lastFillDaysAgo: 40, daysSupply: 90 },
      { rxcui: '309362', lastFillDaysAgo: 21, refillsLeft: 0 },
      { rxcui: '665033', lastFillDaysAgo: 11 },
    ],
  },
  // Kokila: losartan ran out 5 days ago; her pharmacy closes Dec 12.
  [KOKILA_MBI]: {
    meds: [
      { rxcui: '979485', lastFillDaysAgo: 35, pharmacyNpi: '0999000002' },
      { rxcui: '966222', lastFillDaysAgo: 10, pharmacyNpi: '0999000002' },
    ],
  },
};

export const scriptedScenarios = () =>
  new Map(Object.entries(SCRIPTED).map(([mbi, s]) => [mockBeneficiaryId(mbi), s]));
