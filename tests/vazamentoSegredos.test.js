'use strict';
// v0.41.0: três vazamentos apontados pela auditoria — chaves do gemini-code herdadas por servidores
// MCP, segredos gravados em texto puro no actions.log e a chave do Veo na query string da URL.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-vazamento-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const mcpClient = require('../src/tools/mcpClient');
const { logAcao, LOG_PATH } = require('../src/decisionLog');
const { mascararSegredos } = require('../src/securityScan');

const CHAVE_GOOGLE = 'AIza' + 'Sy'.repeat(17) + 'X'; // fictícia, formato de chave Google
const CHAVE_OPENAI = 'sk-' + 'a1B2'.repeat(10);

test('servidor MCP real não recebe as chaves do gemini-code; outras variáveis continuam', async () => {
  const antes = { ...process.env };
  Object.assign(process.env, { GEMINI_API_KEY: CHAVE_GOOGLE, GEMINI_CODE_OPENAI_KEY: CHAVE_OPENAI, ROUTINE_API_TOKEN: 'x'.repeat(30), GITHUB_TOKEN_DE_TESTE: 'mantido' });
  const c = new mcpClient.McpConnection('env', { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-env-mcp.js')], env: { EXPLICITA: 'do-mcp-json' } });
  try {
    c.start();
    await c.initialize();
    const r = await c.callTool('ler_env', { nomes: ['GEMINI_API_KEY', 'GEMINI_CODE_OPENAI_KEY', 'ROUTINE_API_TOKEN', 'GITHUB_TOKEN_DE_TESTE', 'EXPLICITA', 'PATH'] });
    const env = JSON.parse(r.content[0].text);
    assert.equal(env.GEMINI_API_KEY, null);
    assert.equal(env.GEMINI_CODE_OPENAI_KEY, null);
    assert.equal(env.ROUTINE_API_TOKEN, null);
    assert.equal(env.GITHUB_TOKEN_DE_TESTE, 'mantido');
    assert.equal(env.EXPLICITA, 'do-mcp-json', 'o env do mcp.json continua valendo');
    assert.ok(env.PATH);
  } finally {
    c.stop();
    for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
    Object.assign(process.env, antes);
  }
});

test('mascararSegredos: chaves conhecidas, Bearer e atribuição; texto comum intacto', () => {
  const t = mascararSegredos(`curl -H "Authorization: Bearer ${'t0k3n'.repeat(6)}" -d key=${CHAVE_GOOGLE} ${CHAVE_OPENAI}`);
  assert.doesNotMatch(t, new RegExp(CHAVE_GOOGLE));
  assert.doesNotMatch(t, new RegExp(CHAVE_OPENAI));
  assert.doesNotMatch(t, /t0k3nt0k3nt0k3nt0k3n/);
  assert.match(t, /AIza…\[segredo omitido\]/);
  assert.equal(mascararSegredos('npm test && git status'), 'npm test && git status');
  assert.equal(mascararSegredos(''), '');
});

test('actions.log não guarda chave em texto puro', () => {
  logAcao({ tool: 'run_shell', args: { command: `curl -H "x-goog-api-key: ${CHAVE_GOOGLE}" https://exemplo` }, resultado: `resposta com ${CHAVE_OPENAI}` });
  const log = fs.readFileSync(LOG_PATH, 'utf8');
  assert.doesNotMatch(log, new RegExp(CHAVE_GOOGLE));
  assert.doesNotMatch(log, new RegExp(CHAVE_OPENAI));
  assert.match(log, /segredo omitido/);
});

test('actions.log: segredo em atribuição dentro dos args (aspas escapadas pelo JSON) também é mascarado', () => {
  // Revisão adversarial da v0.41.0: a máscara rodava depois do JSON.stringify, e password = "..." virava password = \"...\".
  const SENHA = 'SenhaFicticiaDeTeste1234567890abc';
  logAcao({ tool: 'write_file', args: { path: '.env.local', content: `password = "${SENHA}"\napi_key: '${SENHA}x'` }, resultado: 'ok' });
  const log = fs.readFileSync(LOG_PATH, 'utf8');
  assert.doesNotMatch(log, new RegExp(SENHA));
  assert.match(log, /Senh…\[segredo omitido\]/);
});

test('mídia (Veo): a chave vai no cabeçalho, nunca na URL', async () => {
  const config = require('../src/config');
  config.saveConfig({ apiKey: CHAVE_GOOGLE });
  const chamadas = [];
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts = {}) => {
    chamadas.push({ url: String(url), headers: opts.headers || {} });
    return { ok: true, status: 200, json: async () => ({ name: 'operations/x', done: true, response: {} }) };
  };
  try {
    await require('../src/tools/mediaTools').makeVideo('um gato', HOME_FALSO).catch(() => {});
  } finally { global.fetch = fetchOriginal; }
  assert.ok(chamadas.length >= 1, 'deveria ter chamado a API');
  for (const c of chamadas) {
    assert.doesNotMatch(c.url, /key=/);
    assert.equal(c.headers['x-goog-api-key'], CHAVE_GOOGLE);
  }
});
