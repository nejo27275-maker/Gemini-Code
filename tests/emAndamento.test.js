'use strict';
// v0.49.1: comandos de terminal em primeiro plano (src/emAndamento.js). O Ctrl+C do chat e o "Parar" do modo site os
// interrompem como um terminal (SIGINT no comando e em tudo que ele abriu; quem ignora leva SIGKILL em 2 s), e nada fica
// órfão quando o gemini-code sai. O run_shell e o run_checks usam.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-emandamento-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
fs.mkdirSync(path.join(HOME, '.gemini-code'), { recursive: true });
const configurar = (extra) => fs.writeFileSync(path.join(HOME, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: 99, ...extra }));

const test = require('node:test');
const assert = require('node:assert/strict');
const { exec, execFileSync } = require('child_process');
const ea = require('../src/emAndamento');

const linux = process.platform === 'linux' ? false : 'os testes olham o /proc (Linux)';
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
// duração única por execução: duas suítes rodando ao mesmo tempo não confundem os processos uma da outra
const unico = (base) => `${base}.${process.pid}${Math.floor(Math.random() * 1000)}`;
const terminou = (filho) => new Promise((r) => filho.on('exit', (codigo, sinal) => r({ codigo, sinal })));

/** pids cujo comando é exatamente esse (sem casar com a linha de comando de quem procura). */
function processos(...argv) {
  const alvo = Buffer.from(`${argv.join('\0')}\0`);
  const out = [];
  for (const n of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(n)) continue;
    try { if (fs.readFileSync(`/proc/${n}/cmdline`).equals(alvo)) out.push(Number(n)); } catch { /* já saiu */ }
  }
  return out;
}

test('interromper: SIGINT no comando, como um terminal — sai na hora e fica marcado', { skip: linux }, async () => {
  const filho = exec('sleep 30');
  const acompanhado = ea.acompanhar(filho);
  const fim = terminou(filho);
  await dormir(150);
  const inicio = Date.now();
  assert.equal(ea.interromperTodos(), 1);
  await fim;
  acompanhado.fim();
  assert.ok(Date.now() - inicio < 1500, `demorou ${Date.now() - inicio} ms`);
  assert.equal(acompanhado.interrompido(), true);
  assert.equal(ea.interromperTodos(), 0, 'nada mais a interromper');
});

test('quem ignora o SIGINT leva SIGKILL em 2 s — e os filhos do comando também', { skip: linux }, async () => {
  const [a, b] = [unico(31), unico(32)];
  const filho = exec(`trap '' INT; sleep ${a} & sleep ${b}; wait`);
  const acompanhado = ea.acompanhar(filho);
  for (let i = 0; i < 50 && processos('sleep', a).length + processos('sleep', b).length < 2; i++) await dormir(50);
  assert.equal(processos('sleep', a).length + processos('sleep', b).length, 2);
  ea.interromperTodos();
  await dormir(700);
  assert.equal(processos('sleep', b).length, 1, 'ainda vivo: ignora o SIGINT');
  await dormir(ea.PRAZO_SIGKILL_MS + 500);
  assert.deepEqual([...processos('sleep', a), ...processos('sleep', b)], [], 'o comando e o filho dele morreram');
  acompanhado.fim();
});

test('ao sair, nenhum comando em primeiro plano fica órfão (nem um que ignora sinais)', { skip: linux }, async () => {
  const d = unico(41);
  const codigo = `const ea = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'emAndamento'))});
    const { exec } = require('child_process');
    ea.acompanhar(exec("trap '' INT TERM; sleep ${d}"));
    setTimeout(() => process.exit(0), 300);`;
  execFileSync(process.execPath, ['-e', codigo]);
  await dormir(300);
  assert.deepEqual(processos('sleep', d), []);
});

test('o texto para o modelo: interrompido pelo usuário, com a saída que deu tempo de sair', () => {
  assert.match(ea.textoInterrompido('linha 1\n', 'aviso'), /^Interrompido pelo usuário \(Ctrl\+C ou "Parar"\)[\s\S]*Saída até ali:\nlinha 1\n+\[stderr\]\naviso$/);
  assert.equal(ea.textoInterrompido('', ''), 'Interrompido pelo usuário (Ctrl+C ou "Parar") antes de terminar. Não rode de novo sem ele pedir.');
});

test('run_shell: o comando aprovado é interrompido e o modelo fica sabendo (o que saiu até ali vai junto)', { skip: linux }, async (t) => {
  configurar({ confirmShell: true, shellSandbox: 'off' });
  const prompt = require('../src/ui/prompt');
  const antes = prompt.ask;
  prompt.ask = async () => 's';
  t.after(() => { prompt.ask = antes; });
  const shell = require('../src/tools/shellTools');
  const pendente = shell.execute('run_shell', { command: 'echo antes-de-parar; sleep 20' });
  await dormir(500);
  const inicio = Date.now();
  assert.equal(ea.interromperTodos(), 1);
  const r = await pendente;
  assert.ok(Date.now() - inicio < 1500);
  assert.match(r, /^Interrompido pelo usuário/);
  assert.match(r, /antes-de-parar/);
});

test('run_shell na sandbox: o "Parar" também encerra o comando isolado', { skip: linux }, async (t) => {
  const sandbox = require('../src/sandbox');
  const info = await sandbox.verificar();
  if (!info.ok) {
    if (process.env.GEMINI_CODE_EXIGIR_SANDBOX === '1') assert.fail(`a sandbox devia funcionar aqui: ${info.motivo}`);
    t.skip(`sem sandbox: ${info.motivo}`);
    return;
  }
  configurar({ confirmShell: false, shellSandbox: 'auto' });
  const shell = require('../src/tools/shellTools');
  const pendente = shell.execute('run_shell', { command: 'echo isolado; sleep 20' });
  await dormir(800);
  assert.equal(ea.interromperTodos(), 1);
  const r = await pendente;
  assert.match(r, /^Interrompido pelo usuário/);
});

test('run_checks: interrompido, não começa a próxima verificação', { skip: linux }, async (t) => {
  configurar({ confirmShell: true, shellSandbox: 'off' });
  const prompt = require('../src/ui/prompt');
  const antes = prompt.ask;
  prompt.ask = async () => 's';
  t.after(() => { prompt.ask = antes; });
  const projeto = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-checks-'));
  t.after(() => fs.rmSync(projeto, { recursive: true, force: true }));
  fs.writeFileSync(path.join(projeto, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'echo testando && sleep 20', lint: 'echo LINT-RODOU' } }));
  const checks = require('../src/tools/checkTools');
  checks.sessao.confirmado = false;
  const pendente = checks.execute('run_checks', { cwd: projeto });
  await dormir(1500);
  assert.equal(ea.interromperTodos(), 1);
  const r = await pendente;
  assert.match(r, /^Verificações interrompidas pelo usuário/);
  assert.doesNotMatch(r, /LINT-RODOU/, 'o lint não começou');
});
