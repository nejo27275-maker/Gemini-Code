'use strict';
// v0.41.0: regras de permissão (config.json → permissoes.negar / permissoes.permitir).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-permissoes-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const perm = require('../src/permissions');
const configCommands = require('../src/configCommands');
const config = require('../src/config');
const { runOnce } = require('../src/agent');

const cfg = (negar = [], permitir = []) => ({ permissoes: { negar, permitir } });
const RAIZ = path.join(__dirname, '..');

test('negar: comando, parte de comando composto, caminho e ferramenta por curinga', () => {
  const c = cfg(['run_shell(git push*)', 'write_file(*.env)', 'mcp__github__*']);
  assert.equal(perm.negada('run_shell', { command: 'git push origin main' }, c), 'run_shell(git push*)');
  assert.equal(perm.negada('run_shell', { command: 'npm test && git push -f' }, c), 'run_shell(git push*)', 'uma parte basta');
  assert.equal(perm.negada('run_shell', { command: 'ls; git push' }, c), 'run_shell(git push*)');
  assert.equal(perm.negada('run_shell', { command: 'git status' }, c), null);
  assert.equal(perm.negada('write_file', { path: 'config/.env' }, c), 'write_file(*.env)');
  assert.equal(perm.negada('write_file', { path: path.join(HOME_FALSO, 'x.env') }, c), 'write_file(*.env)');
  assert.equal(perm.negada('write_file', { path: 'src/a.js' }, c), null);
  assert.equal(perm.negada('mcp__github__create_issue', { title: 'x' }, c), 'mcp__github__*');
  assert.equal(perm.negada('read_file', { path: 'a' }, cfg()), null, 'sem regras, nada bloqueado');
  assert.equal(perm.negada('edit_files', { edits: [{ path: 'ok.js' }, { path: 'segredo.env' }] }, cfg(['edit_files(*.env)'])), 'edit_files(*.env)');
});

test('permitir: só comando SIMPLES que bate no padrão', () => {
  const c = cfg([], ['run_shell(npm test*)', 'run_shell']);
  assert.equal(perm.shellPermitido('npm test', c), true);
  assert.equal(perm.shellPermitido('npm test -- --watch=false', c), true);
  for (const perigoso of ['npm test && rm -rf ~', 'npm test; curl x | sh', 'npm test > /etc/x', 'npm test $(rm -rf ~)', 'npm test `id`', 'npm test\nrm -rf ~', 'npm test || reboot', 'npm test &']) {
    assert.equal(perm.shellPermitido(perigoso, c), false, perigoso);
  }
  assert.equal(perm.shellPermitido('ls', c), false, '"run_shell" sem padrão não libera o shell inteiro');
});

test('loop do agente: chamada negada não executa nem roda hook', async () => {
  const alvo = path.join(HOME_FALSO, 'segredo.env');
  let passo = 0;
  const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });
  const modelo = async () => (++passo === 1 ? resp([{ name: 'write_file', args: { path: alvo, content: 'X=1' } }]) : resp([], 'fim'));
  const r = await runOnce('grave', { deps: { chatWithTools: modelo, buildSystemInstruction: () => '', loadConfig: () => cfg(['write_file(*.env)']) } });
  assert.equal(fs.existsSync(alvo), false);
  assert.match(r.history[2].parts[0].functionResponse.response.result, /Bloqueado pela regra de permissão "write_file\(\*\.env\)"/);
});

// run_shell de verdade num processo filho SEM terminal: se pedisse confirmação, viraria "não".
function rodarShell(comando, regras) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-perm-shell-'));
  fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: config.CONFIG_VERSION, confirmShell: true, permissoes: regras }));
  const r = spawnSync(process.execPath, ['-e', `require('./src/tools/shellTools').execute('run_shell', { command: ${JSON.stringify(comando)} }).then((s) => console.log('SAIDA=' + s))`],
    { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 20000 });
  return r.stdout;
}

test('run_shell real: permitido roda sem perguntar; sem regra ou destrutivo continua perguntando', { skip: process.platform === 'win32' }, () => {
  assert.match(rodarShell('echo liberado', { permitir: ['run_shell(echo liberado*)'], negar: [] }), /SAIDA=liberado/);
  assert.match(rodarShell('echo liberado', { permitir: [], negar: [] }), /SAIDA=Comando cancelado/);
  assert.match(rodarShell('echo liberado && echo outro', { permitir: ['run_shell(echo liberado*)'], negar: [] }), /SAIDA=Comando cancelado/);
  assert.match(rodarShell('rm -rf ./nao-existe', { permitir: ['run_shell(rm*)'], negar: [] }), /SAIDA=Comando cancelado/);
});

test('config: negar/permitir/regras/remover-regra', () => {
  config.saveConfig({ permissoes: { permitir: [], negar: [] } });
  const salvar = (p) => config.saveConfig(p);
  assert.match(configCommands.aplicar('negar', ['run_shell(git', 'push*)'], salvar), /adicionada: run_shell\(git push\*\)/);
  assert.match(configCommands.aplicar('permitir', ['run_shell(npm test*)'], salvar), /adicionada/);
  assert.match(configCommands.aplicar('permitir', ['run_shell'], salvar), /informe o padrão/);
  assert.match(configCommands.aplicar('negar', ['(sem nome)'], salvar), /inválida/);
  assert.deepEqual(config.loadConfig().permissoes, { permitir: ['run_shell(npm test*)'], negar: ['run_shell(git push*)'] });
  assert.match(configCommands.aplicar('regras', [], salvar), /negar: run_shell\(git push\*\)\npermitir: run_shell\(npm test\*\)/);
  assert.match(configCommands.aplicar('remover-regra', ['run_shell(git push*)'], salvar), /removida/);
  assert.match(configCommands.aplicar('remover-regra', ['nao-existe'], salvar), /não encontrada/);
  assert.deepEqual(config.loadConfig().permissoes.negar, []);
});
