import { describe, expect, it } from 'vitest';
import { canMove, move, rankPlans, SKILL_FOR_WARNING, SKILLS, type PlanOption } from '../src';

describe('rule 2.11: neutral plan ranking', () => {
  const plans: PlanOption[] = [
    {
      planKey: 'A',
      name: 'A',
      premiumCents: 6100,
      deductibleCents: 61500,
      drugCostCents: 20000,
      commissionCents: 50000,
    },
    {
      planKey: 'B',
      name: 'B',
      premiumCents: 2310,
      deductibleCents: 61500,
      drugCostCents: 90000,
      commissionCents: 0,
    },
    {
      planKey: 'C',
      name: 'C',
      premiumCents: 0,
      deductibleCents: 0,
      drugCostCents: 150000,
      commissionCents: null,
    },
  ];
  it('ranks by total yearly cost only', () => {
    expect(rankPlans(plans).map((p) => [p.planKey, p.totalYearlyCents])).toEqual(
      [
        ['A', 154700],
        ['C', 150000],
        ['B', 179220],
      ].sort((a, b) => (a[1] as number) - (b[1] as number)),
    );
  });
  it('no commission, however large, changes the order', () => {
    const base = rankPlans(plans).map((p) => p.planKey);
    for (let i = 0; i < 50; i++) {
      const bribed = plans.map((p) => ({ ...p, commissionCents: Math.floor(Math.random() * 10_000_000) }));
      expect(rankPlans(bribed).map((p) => p.planKey)).toEqual(base);
    }
  });
});

describe('rule 2.3: approvals and the state machine', () => {
  it('money or a prescription needs the family; clinical needs the physician', () => {
    expect(SKILLS.requestPharmacyTransfer.approval).toBe('family');
    expect(SKILLS.draftRenewalForDoctor.approval).toBe('physician');
    expect(SKILLS.draftFormularyException.approval).toBe('physician');
    expect(SKILLS.checkRefillStatus.approval).toBe('none');
  });
  it('the registry is closed: nothing diagnoses, doses or chooses a drug', () => {
    expect(Object.keys(SKILLS).sort()).toEqual([
      'askFamilyToHelp',
      'bookPickup',
      'checkRefillStatus',
      'comparePartDPlans',
      'draftFormularyException',
      'draftRenewalForDoctor',
      'findStock',
      'requestPharmacyTransfer',
    ]);
    for (const s of Object.values(SKILL_FOR_WARNING)) expect(Object.keys(SKILLS)).toContain(s);
  });
  it('no path skips approval or verification', () => {
    expect(canMove('awaiting_approval', 'running')).toBe(false);
    expect(canMove('running', 'succeeded')).toBe(false);
    expect(canMove('proposed', 'succeeded')).toBe(false);
    expect(() => move('rejected', 'approved')).toThrow();
    expect(move('verifying', 'succeeded')).toBe('succeeded');
  });
  it('skill inputs are strict', () => {
    expect(
      SKILLS.requestPharmacyTransfer.input.safeParse({ rxcui: '1', toNpi: '0999000001', note: 'x' }).success,
    ).toBe(false);
    expect(SKILLS.checkRefillStatus.input.safeParse({ rxcui: 'DROP TABLE' }).success).toBe(false);
  });
});
