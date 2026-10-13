'use strict';
// v0.40.0: sem terminal (cron, CI, `< /dev/null`), ask() nunca respondia e o processo
// saía no meio da tarefa com código 0. Cada caso roda num processo filho com stdin real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

function rodar(codigo, { entrada, env = {} } = {}) {
  return spawnSync(process.execPath, ['-e', codigo], {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, ...env },
    ...(entrada === undefined ? { stdio: ['ignore', 'pipe', 'pipe'] } : { input: entrada }),
  });
}

const PERGUNTAS = `
  const { ask } = require('./src/ui/prompt');
  (async () => {
    const a = await ask('primeira? ');
    const b = await ask('segunda? ');
    console.log('RESULTADO=' + JSON.stringify([a, b]));
  })();`;

test('stdin em /dev/null: ask() responde "" em vez de o processo sumir', () => {
  const r = rodar(PERGUNTAS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESULTADO=\["",""\]/);
  assert.match(r.stdout, /tratado como "não"/);
});

test('pipe com uma resposta: a 1ª pergunta recebe a resposta, a 2ª (stdin já acabou) recebe ""', () => {
  const r = rodar(PERGUNTAS, { entrada: 's\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESULTADO=\["s",""\]/);
});

// Limite conhecido (já existia): a readline descarta linhas que chegam sem pergunta pendente,
// então de um pipe finito só a 1ª resposta é usada. Enfileirar não é seguro: no chat, um
// trecho colado chega do mesmo jeito e uma linha "s" viraria confirmação de run_shell.
test('pipe finito com várias linhas: resposta que não chegou a tempo nunca vira "sim"', () => {
  const r = rodar(PERGUNTAS, { entrada: 's\ns\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESULTADO=\["s",""\]/);
});

test('agente sem terminal: run_shell pedindo confirmação é recusado e a tarefa termina com resposta', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-headless-'));
  const r = rodar(`
    const { runOnce } = require('./src/agent');
    let passo = 0;
    const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });
    const modelo = async () => (++passo === 1 ? resp([{ name: 'run_shell', args: { command: 'echo nao-deveria-rodar' } }]) : resp([], 'tarefa concluída'));
    runOnce('x', { deps: { chatWithTools: modelo, buildSystemInstruction: () => '' } }).then((r) => {
      console.log('FINAL=' + r.text);
      console.log('FERRAMENTA=' + r.history[2].parts[0].functionResponse.response.result);
    });`, { env: { HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /FINAL=tarefa concluída/);
  assert.match(r.stdout, /FERRAMENTA=Comando cancelado/);
  assert.doesNotMatch(r.stdout, /^nao-deveria-rodar$/m);
});
