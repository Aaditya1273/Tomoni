import { MockBlueButton, RealBlueButton, type BlueButton } from './adapter';
import { scriptedScenarios } from './scenarios';
import { sampleDrugs, samplePharmacyNpis } from '../reference';

export * from './adapter';
export * from './map';
export * from './scenarios';
export * from './synth';

/** TOMONI_ADAPTER_BLUEBUTTON=real uses the CMS sandbox (or production, behind the real-data flag). */
export function blueButtonFromEnv(env: NodeJS.ProcessEnv = process.env): BlueButton {
  if (env.TOMONI_ADAPTER_BLUEBUTTON === 'real') {
    const clientId = env.TOMONI_BB_CLIENT_ID;
    const clientSecret = env.TOMONI_BB_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error('TOMONI_BB_CLIENT_ID and TOMONI_BB_CLIENT_SECRET are required');
    return new RealBlueButton({ clientId, clientSecret, production: env.TOMONI_BB_PRODUCTION === 'true' });
  }
  return new MockBlueButton({
    drugs: sampleDrugs(),
    pharmacyNpis: samplePharmacyNpis(),
    scenarios: scriptedScenarios(),
  });
}
