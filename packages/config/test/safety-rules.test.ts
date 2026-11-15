import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, 'packages/config/eslint.config.js'),
});

async function lint(code: string, filePath: string) {
  const [res] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return res!.messages.map((m) => m.ruleId);
}

describe('rule 2.8: research-only code is fenced off', () => {
  const bad = "import { x } from '@tomoni/research';\nexport const y = x;\n";

  it.each([
    'apps/web/src/app/family/page.tsx',
    'apps/web/src/lib/deep/nested.ts',
    'apps/sponsor/src/app/page.tsx',
    'apps/api/src/routes/desk/queue.ts',
    'apps/api/src/routes/family/card.ts',
  ])('blocks @tomoni/research in %s', async (file) => {
    expect(await lint(bad, file)).toContain('no-restricted-imports');
  });

  it('blocks subpath imports too', async () => {
    const code = "import { x } from '@tomoni/research/voice';\nexport const y = x;\n";
    expect(await lint(code, 'apps/web/src/a.ts')).toContain('no-restricted-imports');
  });

  it('allows it in research API routes', async () => {
    expect(await lint(bad, 'apps/api/src/routes/research/registry.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('SECURITY S10: no raw HTML', () => {
  it('blocks dangerouslySetInnerHTML', async () => {
    const code = 'export const A = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />;\n';
    expect(await lint(code, 'apps/web/src/a.tsx')).toContain('no-restricted-syntax');
  });
});
