import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const deploymentRoot = path.resolve(process.cwd(), 'deploy', 'scripts');
const deployScript = fs.readFileSync(path.join(deploymentRoot, 'deploy.sh'), 'utf8');
const coturnScript = fs.readFileSync(path.join(deploymentRoot, 'configure-coturn.sh'), 'utf8');

test('deployment reconciles coturn before replacing the application process', () => {
  const coturnIndex = deployScript.indexOf('configure-coturn.sh');
  const pm2Index = deployScript.indexOf('pm2 delete eaudit');

  assert.ok(coturnIndex >= 0);
  assert.ok(pm2Index > coturnIndex);
  assert.match(deployScript, /sudo -n bash .*configure-coturn\.sh/);
  assert.match(deployScript, /application process was left unchanged/);
});

test('coturn deployment uses protected credentials and rejects unsafe relay state', () => {
  assert.match(coturnScript, /ENV_FILE="\$\{1:-\/opt\/eaudit\/\.env\}"/);
  assert.match(coturnScript, /LIVE_TURN_URLS and LIVE_TURN_SHARED_SECRET must be set together/);
  assert.match(coturnScript, /LIVE_TURN_HOST is required/);
  assert.match(coturnScript, /static-auth-secret=\$TURN_SECRET/);
  assert.match(coturnScript, /no-cli/);
  assert.match(coturnScript, /min-port=49152/);
  assert.match(coturnScript, /max-port=49200/);
  assert.match(coturnScript, /turns: is configured but its TLS certificate\/key are not readable/);
  assert.match(coturnScript, /chmod 600 "\$TURN_CONFIG"/);
  assert.match(coturnScript, /systemctl is-active --quiet coturn/);
  assert.doesNotMatch(coturnScript, /echo .*TURN_SECRET/);
});
