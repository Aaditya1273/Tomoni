/**
 * The typed contract to the ML feature service (apps/ml, BUILD_PROMPT §4 "ML service"). Both
 * adapters return ResearchOnly values: features never reach a care or family surface (rule 2.8).
 */
import { z } from 'zod';
import { seal, type ResearchOnly } from './brand';

export const SpeechFeatures = z.strictObject({
  featureVersion: z.string().regex(/^[a-z0-9.-]{1,32}$/),
  durationMs: z.int().min(0).max(120_000),
  voicedRatio: z.number().min(0).max(1),
  pauseCount: z.int().min(0).max(10_000),
  meanPauseMs: z.number().min(0).max(120_000),
  rmsDbfs: z.number().min(-120).max(0),
});
export type SpeechFeatures = z.infer<typeof SpeechFeatures>;

export interface FeatureInput {
  durationMs: number;
  /** 16-bit PCM WAV. Null when the channel captured no audio (the simulator). */
  wav: Uint8Array | null;
}

export interface FeatureService {
  readonly mode: 'mock' | 'real';
  /** Null when there is nothing to extract from. */
  extract(input: FeatureInput): Promise<ResearchOnly<SpeechFeatures> | null>;
}

/** POSTs the WAV to the ML service and validates the reply against the contract. */
export class HttpFeatureService implements FeatureService {
  readonly mode = 'real';
  constructor(private base = process.env.TOMONI_ML_URL ?? 'http://localhost:8090') {}
  async extract({ wav }: FeatureInput) {
    if (!wav) return null;
    const res = await fetch(`${this.base}/v1/features`, {
      method: 'POST',
      headers: { 'content-type': 'audio/wav' },
      body: wav,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`feature service: HTTP ${res.status}`);
    return seal(SpeechFeatures.parse(await res.json()));
  }
}

/** Sandbox only. Labelled by its feature version, so mock rows can never pass for real ones. */
export class MockFeatureService implements FeatureService {
  readonly mode = 'mock';
  async extract({ durationMs }: FeatureInput) {
    return seal(
      SpeechFeatures.parse({
        featureVersion: 'mock-0',
        durationMs,
        voicedRatio: 0.6,
        pauseCount: Math.floor(durationMs / 4000),
        meanPauseMs: 450,
        rmsDbfs: -24,
      }),
    );
  }
}

export const featureServiceFromEnv = (env = process.env): FeatureService =>
  env.TOMONI_ADAPTER_FEATURES === 'real' ? new HttpFeatureService() : new MockFeatureService();
