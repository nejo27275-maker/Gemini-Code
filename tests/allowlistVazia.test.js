'use strict';
// v0.41.0: na camada de ferramentas, `[]` liberava TODAS as ferramentas. Um passo de
// workflow com `tools: []` rodado por `gemini-code agent run` (runner.js, sem a tradução
// para NENHUMA que só o run_workflow fazia) recebia write_file e run_shell.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-allowlist-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/tools');
const security = require('../src/security');
const { runOnce } = require('../src/agent');
const { runWorkflowData } = require('../src/agents/runner');

const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });

test('[] = nenhuma ferramenta; sem lista = todas', async () => {
  assert.deepEqual(await tools.getAllDeclarations([]), []);
  const todas = await tools.getAllDeclarations();
  assert.ok(todas.some((d) => d.name === 'write_file') && todas.some((d) => d.name === 'run_shell'));
  await assert.rejects(tools.execute('write_file', { path: path.join(HOME_FALSO, 'x'), content: 'x' }, []), /não está liberada/);
  assert.equal(fs.existsSync(path.join(HOME_FALSO, 'x')), false);
});

test('agent run: passo com tools: [] não recebe nem executa ferramentas', async () => {
  const alvo = path.join(HOME_FALSO, 'gravado-pelo-passo.txt');
  const vistas = [];
  const modelo = async ({ tools: decl }) => {
    vistas.push(decl.map((d) => d.name));
    // O modelo tenta gravar mesmo sem a ferramenta declarada.
    return vistas.length === 1 ? resp([{ name: 'write_file', args: { path: alvo, content: 'não podia' } }]) : resp([], 'fim');
  };
  const workflow = { name: 'teste', steps: [{ id: 'resumo', prompt: 'resuma', tools: [] }] };
  const r = await runWorkflowData(workflow, {
    runOnce: (prompt, opcoes) => runOnce(prompt, { ...opcoes, deps: { chatWithTools: modelo, buildSystemInstruction: () => '' } }),
  });
  assert.deepEqual(vistas[0], [], 'o modelo não pode ver nenhuma ferramenta');
  assert.equal(fs.existsSync(alvo), false, 'write_file não pode ter rodado');
  assert.equal(r.results[0].output, 'fim');
});

test('sessão de convidado: [] continua nenhuma; sem lista vira a lista do convidado', () => {
  const blob = security.encriptar('CHAVE-FICTICIA', 'convidado');
  const config = require('../src/config');
  config.saveConfig({ apiKeyLocked: security.encriptar('CHAVE-FICTICIA', 'dono'), apiKeyLockedGuest: blob, apiKey: '' });
  try {
    assert.equal(security.unlock('convidado'), true);
    assert.equal(security.getSessionRole(), 'guest');
    assert.deepEqual(security.restringirParaSessao([]), []);
    assert.deepEqual(security.restringirParaSessao(undefined), security.GUEST_ALLOWED_TOOLS);
    assert.deepEqual(security.restringirParaSessao(['read_file', 'run_shell']), ['read_file']);
  } finally { security.clearSession(); }
});
