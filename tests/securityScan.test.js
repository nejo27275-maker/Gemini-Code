'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanSecrets } = require('../src/securityScan');

test('secret scan detects common patterns without revealing values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-secret-scan-'));
  const apiToken = ['sk-proj-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'].join('');
  fs.writeFileSync(path.join(root, 'config.env'), `OPENAI_API_KEY="${apiToken}"\n`);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'API_KEY="YOUR_API_KEY_HERE"\n');
  const result = scanSecrets(root);
  assert.ok(result.findings.some((f) => f.file === 'config.env' && f.type === 'chave OpenAI'));
  assert.ok(!JSON.stringify(result).includes(apiToken));
  assert.equal(result.findings.some((f) => f.file === 'ok.txt'), false);
});

test('secret scan skips binary content and dependency trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-secret-scan-skip-'));
  fs.mkdirSync(path.join(root, 'node_modules', 'package'), { recursive: true });
  const apiToken = ['AIza', '012345678901234567890123456789012345'].join('');
  fs.writeFileSync(path.join(root, 'node_modules', 'package', 'secret.js'), apiToken);
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 1, 2, 3]));
  const result = scanSecrets(root);
  assert.equal(result.findings.length, 0);
});
