import '@tomoni/telemetry/start'; // first: patches http and pg before they load
import { closePools } from '@tomoni/db';
import { buildServer } from './server';
import { loadConfig } from './config';

const app = await buildServer();
const { port } = loadConfig();
await app.listen({ port, host: '127.0.0.1' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await closePools();
    process.exit(0);
  });
}
