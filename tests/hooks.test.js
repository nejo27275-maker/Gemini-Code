'use strict';
// v0.13.0: hooks PreToolUse/PostToolUse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hooks = require('../src/hooks');
const { runOnce } = require('../src/agent');

function config(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-hooks-')), 'hooks.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  hooks.definirArquivo(f);
  return f;
}

test('sem arquivo de hooks não faz nada', () => {
  hooks.definirArquivo(path.join(os.tmpdir(), 'nao-existe-hooks.json'));
  assert.deepEqual(hooks.executar('PreToolUse', { tool: 'run_shell', args: {} }), { bloqueado: false, mensagem: '', avisos: [], saidas: [] });
  assert.deepEqual(hooks.resumo(), []);
});

test('código 2 em PreToolUse bloqueia e a saída vira o motivo; matcher é o nome inteiro', () => {
  config({ PreToolUse: [{ matcher: 'run_shell', command: 'echo "rm -rf proibido" >&2; exit 2' }] });
  const r = hooks.executar('PreToolUse', { tool: 'run_shell', args: { command: 'rm -rf /' } });
  assert.equal(r.bloqueado, true);
  assert.match(r.mensagem, /proibido/);
  assert.equal(hooks.executar('PreToolUse', { tool: 'run_shell_extra', args: {} }).bloqueado, false, 'matcher não casa por prefixo');
  assert.equal(hooks.executar('PreToolUse', { tool: 'read_file', args: {} }).bloqueado, false);
});

test('o hook recebe JSON no stdin e as variáveis de ambiente', () => {
  const saida = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-hooks-out-')), 'o.txt');
  config({ PostToolUse: [{ command: `cat > "${saida}"; echo "$GEMINI_CODE_EVENT:$GEMINI_CODE_TOOL" >> "${saida}"` }] });
  hooks.executar('PostToolUse', { tool: 'edit_file', args: { path: 'a.js' }, resultado: 'ok' });
  const txt = fs.readFileSync(saida, 'utf8');
  assert.match(txt, /"tool":"edit_file"/);
  assert.match(txt, /"resultado":"ok"/);
  assert.match(txt, /PostToolUse:edit_file/);
});

test('hook com erro, código estranho ou estourando o tempo nunca derruba nem bloqueia', () => {
  config({ PreToolUse: [{ command: 'exit 1' }, { command: 'sleep 5', timeout: 1 }, { command: 'comando-que-nao-existe-xyz' }, { matcher: '(', command: 'exit 2' }] });
  const r = hooks.executar('PreToolUse', { tool: 'x', args: {} });
  assert.equal(r.bloqueado, false);
  assert.ok(r.avisos.length >= 2);
});

test('arquivo de hooks inválido é ignorado', () => {
  const f = config({});
  fs.writeFileSync(f, '{ quebrado');
  hooks.definirArquivo(f);
  assert.equal(hooks.executar('PreToolUse', { tool: 'x', args: {} }).bloqueado, false);
});

test('no loop do agente: Pre bloqueia sem executar a ferramenta; Post anexa a saída ao resultado', async () => {
  config({
    PreToolUse: [{ matcher: 'run_shell', command: 'echo sem shell hoje; exit 2' }],
    PostToolUse: [{ matcher: 'edit_file', command: 'echo "lint: falta ponto e vírgula"; exit 2' }],
  });
  let executadas = [];
  const respostas = [
    { fc: [{ name: 'run_shell', args: { command: 'ls' } }, ] },
    { fc: [{ name: 'edit_file', args: { path: 'a.js' } }] },
    { texto: 'fim' },
  ];
  let i = 0;
  const chatWithTools = async () => {
    const r = respostas[i++];
    return { functionCalls: () => r.fc || [], rawParts: () => (r.fc ? r.fc.map((c) => ({ functionCall: c })) : [{ text: r.texto }]), text: () => r.texto || '' };
  };
  const { history } = await runOnce('oi', {
    deps: { loadConfig: () => ({}), chatWithTools, getAllDeclarations: async () => [], buildSystemInstruction: () => '', execute: async (n) => { executadas.push(n); return 'feito'; } },
  });
  assert.deepEqual(executadas, ['edit_file'], 'run_shell foi bloqueado antes de executar');
  const respostasFerramenta = history.flatMap((m) => m.parts).filter((p) => p.functionResponse).map((p) => p.functionResponse.response.result);
  assert.match(respostasFerramenta[0], /Bloqueado por hook do usuário: sem shell hoje/);
  assert.match(respostasFerramenta[1], /feito\n\[hook\] lint: falta ponto e vírgula/);
  hooks.definirArquivo(path.join(os.tmpdir(), 'nao-existe-hooks.json'));
});

test('hook que sai sem ler o stdin (EPIPE) ainda bloqueia com o código de saída', () => {
  config({ PreToolUse: [{ command: 'exit 2' }] });
  const r = hooks.executar('PreToolUse', { tool: 'x', args: { grande: 'y'.repeat(200000) } });
  assert.equal(r.bloqueado, true);
  assert.deepEqual(r.avisos, []);
  hooks.definirArquivo(path.join(os.tmpdir(), 'nao-existe-hooks.json'));
});
