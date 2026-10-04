import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Build outside the synced workspace: filesystem conflict copies are not
// application outputs and must never become part of a Hosting release.
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const buildOnly = process.argv.includes('--build-only');
if (production) { process.env.SITE_URL = 'https://minimalpairs.co'; process.env.PUBLIC_SITE_INDEXABLE = 'true'; process.env.PUBLIC_MEASUREMENT_ENVIRONMENT = 'production'; }
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'minimalpairs-preview-'));
const output = path.join(staging, 'public');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: app, stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; no later release step was run.`);
}
run(process.execPath, ['--test', 'tests/us-chatterbox.test.mjs', 'tests/round-voices.test.mjs']);
run('npm', ['run', 'build', '--', '--outDir', output]);
for (const relative of ['index.html', 'account/index.html', 'practice/index.html']) {
  const html = fs.readFileSync(path.join(output, relative), 'utf8');
  const shouldIndex = production && relative === 'index.html';
  if (shouldIndex ? !/name="robots" content="index,follow/.test(html) : !/name="robots" content="[^"]*noindex/.test(html)) throw new Error('Unexpected indexing policy: ' + relative);
}
run(process.execPath, ['scripts/audit-discovery.mjs', output, production ? 'production' : 'preview']);
const { hosting } = JSON.parse(fs.readFileSync(path.join(app, 'firebase.json'), 'utf8'));
if (hosting.site !== 'minimalpairs') throw new Error('Unexpected preview Hosting site.');
const config = path.join(staging, 'firebase.json');
fs.writeFileSync(config, JSON.stringify({ hosting: { ...hosting, public: output } }, null, 2));
if (!buildOnly) run(path.join(app, 'node_modules/.bin/firebase'), ['deploy', '--config', config, '--only', 'hosting', '--project', 'minimalpairs', '--non-interactive']);
console.log(`Built artifact retained for inspection: ${output}`);
