import { describe, expect, expectTypeOf, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as pkg from '../src';
import { seal, type ResearchOnly } from '../src';
import { unseal } from '../src/brand';
import { MockFeatureService, SpeechFeatures } from '../src/features';

describe('rule 2.8: ResearchOnly<T>', () => {
  it('is not its contents at the type level', () => {
    expectTypeOf<ResearchOnly<number>>().not.toEqualTypeOf<number>();
    expectTypeOf<ResearchOnly<{ a: number }>>().not.toHaveProperty('a');
    const r = seal(42);
    // @ts-expect-error a ResearchOnly<number> is not a number
    const n: number = r;
    // @ts-expect-error nor can it be indexed into
    void r.value;
    void n;
  });

  it('cannot be serialized, printed or opened from outside the package', () => {
    const r = seal({ voicedRatio: 0.4 });
    expect(() => JSON.stringify({ r })).toThrow(/rule 2.8/);
    expect(String(r)).toBe('[ResearchOnly]');
    expect(Object.keys(r)).toEqual([]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.keys(pkg)).not.toContain('unseal');
    expect(unseal(r)).toEqual({ voicedRatio: 0.4 });
    expect(() => unseal({} as ResearchOnly<number>)).toThrow();
  });
});

describe('ML feature contract', () => {
  it('the mock is labelled and satisfies the contract; bad replies are rejected', async () => {
    const f = await new MockFeatureService().extract({ durationMs: 20_000, wav: null });
    expect(unseal(f!)).toMatchObject({ featureVersion: 'mock-0', durationMs: 20_000 });
    expect(
      SpeechFeatures.safeParse({ ...unseal(f!), voicedRatio: 2 }).success ||
        SpeechFeatures.safeParse({ ...unseal(f!), patientId: 'x' }).success,
    ).toBe(false);
  });
});

describe('contract parity with apps/ml', () => {
  const py = spawnSync('python3', ['--version']);
  it.skipIf(py.status !== 0)('the Python service output satisfies SpeechFeatures', () => {
    const out = spawnSync(
      'python3',
      [
        '-c',
        'import features, json; print(json.dumps(features.extract(features._tone([(1000, 8000), (400, 0), (600, 8000)]))))',
      ],
      { cwd: fileURLToPath(new URL('../../../apps/ml', import.meta.url)), encoding: 'utf8' },
    );
    expect(out.stderr).toBe('');
    expect(SpeechFeatures.parse(JSON.parse(out.stdout))).toMatchObject({
      featureVersion: 'pcm-energy-1',
      pauseCount: 1,
    });
  });
});
