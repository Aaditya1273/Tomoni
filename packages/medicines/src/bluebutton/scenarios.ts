/**
 * The scripted demo households (DATA_MODEL "Synthetic seed"). Synthetic MBIs start with 0, which
 * no real Medicare Beneficiary Identifier does, so they can never match a real person.
 */
import { createHash } from 'node:crypto';
import type { Scenario } from './synth';

export const RAJ_MBI = '0EG4TE5MK73';
export const KOKILA_MBI = '0EG4TE5MK74';
const RAJ_PHARMACY = '0999000001'; // Main Street Pharmacy, which is not closing

/**
 * The mock's stand-in for the FHIR patient id CMS would return. A plain hash, not the keyed
 * lookup hash, so the synthetic world is identical on every machine (D-012); only synthetic MBIs
 * ever reach the mock.
 */
export const mockBeneficiaryId = (mbi: string) =>
  `mock-${createHash('sha256').update(mbi.toUpperCase()).digest('hex').slice(0, 24)}`;

const SCRIPTED: Record<string, Scenario> = {
  // Raj: clopidogrel runs out in 9 days with no refills left; sitagliptin moves up a tier on
  // Jan 1 and his next refill after that is Jan 3; his plan premium jumps for 2027.
  [RAJ_MBI]: {
    meds: [
      { rxcui: '861007', lastFillDaysAgo: 12, pharmacyNpi: RAJ_PHARMACY },
      { rxcui: '197361', lastFillDaysAgo: 5, pharmacyNpi: RAJ_PHARMACY },
      { rxcui: '617310', lastFillDaysAgo: 40, daysSupply: 90, pharmacyNpi: RAJ_PHARMACY },
      { rxcui: '309362', lastFillDaysAgo: 21, refillsLeft: 0, pharmacyNpi: RAJ_PHARMACY },
      { rxcui: '665033', lastFillDaysAgo: 11, pharmacyNpi: RAJ_PHARMACY },
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
