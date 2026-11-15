import { describe, expect, it } from 'vitest';
import { BILLABLE, canAdvance, matches, type Candidate, type Criterion } from '../src';

const raj: Candidate = {
  patientId: 'p',
  age: 73,
  language: 'gu',
  conditions: ['coronary_artery_disease', 'diabetes'],
  rxcuis: ['309362'],
  lastInpatientDaysAgo: null,
};

describe('matching', () => {
  it('every criterion must hold', () => {
    const hf: Criterion[] = [
      { field: 'age_band_min', value: 65 },
      { field: 'condition_any', value: ['coronary_artery_disease', 'heart_failure'] },
      { field: 'language_any', value: ['gu', 'hi'] },
    ];
    expect(matches(raj, [...hf])).toBe(true);
    expect(matches({ ...raj, language: 'en' }, [...hf])).toBe(false);
    expect(matches(raj, [...hf, { field: 'inpatient_within_days', value: 365 }])).toBe(false);
    expect(matches(raj, [{ field: 'drug_any', value: ['309362'] }])).toBe(true);
  });
});

describe('funnel (D-010)', () => {
  it('moves one stage at a time; anyone can decline before randomization', () => {
    expect(canAdvance('matched', 'prescreened')).toBe(true);
    expect(canAdvance('matched', 'referred')).toBe(false);
    expect(canAdvance('matched', 'introduced')).toBe(true); // pre-screen is optional, never faked
    expect(canAdvance('introduced', 'declined')).toBe(true);
    expect(canAdvance('randomized', 'declined')).toBe(false);
  });
  it('randomization is never billable', () => {
    expect(BILLABLE.randomized).toBeUndefined();
    expect(Object.values(BILLABLE)).not.toContain('randomized_participant');
  });
});
