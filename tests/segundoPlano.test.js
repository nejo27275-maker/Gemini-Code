'use strict';
// v0.41.0: run_shell em_segundo_plano + shell_status (servidor de dev, watch).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-bg-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const shell = require('../src/tools/shellTools');

const semPosix = process.platform === 'win32';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const no = (codigo) => `"${process.execPath}" -e "${codigo}"`;
const idDe = (texto) => (texto.match(/id=(bg\d+)/) || [])[1];

async function ate(condicao, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await condicao()) return true; await esperar(50); }
  return false;
}

test.before(() => { config.saveConfig({ confirmShell: false }); });

test('roda em segundo plano, mostra a saída e encerra', { skip: semPosix }, async () => {
  const r = await shell.execute('run_shell', { command: no("let i=0;setInterval(()=>console.log('tick'+(i++)),30)"), em_segundo_plano: true });
  const id = idDe(r);
  assert.ok(id, r);
  assert.ok(await ate(async () => /tick3/.test(await shell.execute('shell_status', { id }))), 'a saída aparece enquanto roda');
  assert.match(await shell.execute('shell_status', { id }), /: rodando/);
  assert.match(await shell.execute('shell_status', {}), new RegExp(`${id}: rodando`));
  await shell.execute('shell_status', { id, encerrar: true });
  assert.ok(await ate(async () => /terminou/.test(await shell.execute('shell_status', { id }))), 'encerrado');
});

test('comando que termina sozinho mostra o código de saída e a saída', { skip: semPosix }, async () => {
  const id = idDe(await shell.execute('run_shell', { command: no("console.log('pronto');process.exit(3)"), em_segundo_plano: true }));
  assert.ok(await ate(async () => /terminou \(exit 3\)/.test(await shell.execute('shell_status', { id }))));
  assert.match(await shell.execute('shell_status', { id, linhas: 5 }), /pronto/);
});

test('limite de comandos simultâneos e erros claros', { skip: semPosix }, async () => {
  const ids = [];
  for (let i = 0; i < shell.MAX_SEGUNDO_PLANO; i++) ids.push(idDe(await shell.execute('run_shell', { command: no('setInterval(()=>{},1000)'), em_segundo_plano: true })));
  assert.match(await shell.execute('run_shell', { command: no('1'), em_segundo_plano: true }), /máximo/);
  for (const id of ids) await shell.execute('shell_status', { id, encerrar: true });
  assert.match(await shell.execute('shell_status', { id: 'bg999' }), /^Erro: não há/);
  assert.match(await shell.execute('run_shell', {}), /^Erro: run_shell precisa de "command"/);
});

test('quando o gemini-code sai, nenhum comando em segundo plano fica órfão', { skip: semPosix }, () => {
  const pidArq = path.join(HOME_FALSO, 'pid.txt');
  // O comando de fundo grava o próprio pid e fica vivo; o "gemini-code" (processo pai) sai em seguida.
  const fundo = path.join(HOME_FALSO, 'fundo.js');
  fs.writeFileSync(fundo, `require('fs').writeFileSync(${JSON.stringify(pidArq)}, String(process.pid)); setInterval(() => {}, 1000);`);
  const pai = path.join(HOME_FALSO, 'pai.js');
  fs.writeFileSync(pai, `const s = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'tools', 'shellTools'))});
s.execute('run_shell', { command: ${JSON.stringify(`"${process.execPath}" "${fundo}"`)}, em_segundo_plano: true })
  .then((r) => { console.log(r); setTimeout(() => process.exit(0), 1500); });`);
  const r = spawnSync(process.execPath, [pai], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Iniciado em segundo plano/);
  assert.ok(fs.existsSync(pidArq), `o comando de fundo não chegou a rodar: ${r.stdout}`);
  const pid = Number(fs.readFileSync(pidArq, 'utf8'));
  let vivo = true;
  for (let i = 0; i < 40 && vivo; i++) { try { process.kill(pid, 0); spawnSync('sleep', ['0.05']); } catch { vivo = false; } }
  assert.equal(vivo, false, `o processo ${pid} ficou órfão`);
});

// Revisão adversarial da v0.41.0: com "&" no comando o sh sai na hora (código 0) e o processo continua
// no grupo. Antes isso escapava do limite de 5 e do encerramento na saída (só olhavam o código do sh).
test('processo que sobrevive ao shell ("cmd &") conta no limite e é encerrado', { skip: semPosix }, async () => {
  const ids = [];
  for (let i = 0; i < shell.MAX_SEGUNDO_PLANO; i++) ids.push(idDe(await shell.execute('run_shell', { command: `${no('setInterval(()=>{},1000)')} &`, em_segundo_plano: true })));
  for (const id of ids) assert.ok(await ate(async () => /terminou \(exit 0\), mas deixou processos rodando/.test(await shell.execute('shell_status', { id }))), id);
  assert.match(await shell.execute('run_shell', { command: no('1'), em_segundo_plano: true }), /máximo/, 'o limite vê os processos que ficaram');
  for (const id of ids) await shell.execute('shell_status', { id, encerrar: true });
  for (const id of ids) assert.ok(await ate(async () => /terminou \(exit 0\) —/.test(await shell.execute('shell_status', { id }))), `${id} encerrado`);
});

test('na saída do gemini-code, o processo deixado por "cmd &" também morre', { skip: semPosix }, () => {
  const pidArq = path.join(HOME_FALSO, 'pid-amp.txt');
  const fundo = path.join(HOME_FALSO, 'fundo-amp.js');
  fs.writeFileSync(fundo, `require('fs').writeFileSync(${JSON.stringify(pidArq)}, String(process.pid)); setInterval(() => {}, 1000);`);
  const pai = path.join(HOME_FALSO, 'pai-amp.js');
  fs.writeFileSync(pai, `const s = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'tools', 'shellTools'))});
s.execute('run_shell', { command: ${JSON.stringify(`"${process.execPath}" "${fundo}" &`)}, em_segundo_plano: true })
  .then((r) => { console.log(r); setTimeout(() => process.exit(0), 1500); });`);
  const r = spawnSync(process.execPath, [pai], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(pidArq), `o comando de fundo não chegou a rodar: ${r.stdout}`);
  const pid = Number(fs.readFileSync(pidArq, 'utf8'));
  let vivo = true;
  for (let i = 0; i < 40 && vivo; i++) { try { process.kill(pid, 0); spawnSync('sleep', ['0.05']); } catch { vivo = false; } }
  if (vivo) { try { process.kill(pid, 'SIGKILL'); } catch { /* já saiu */ } }
  assert.equal(vivo, false, `o processo ${pid} ficou órfão`);
});

test('terminal fechado (SIGHUP) passa pela limpeza do CLI em vez de matar o processo direto', { skip: semPosix }, async () => {
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'hup-'));
  const filho = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'gemini-code.js'), 'chat'], {
    cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO, GEMINI_CODE_SOLO: '1', GEMINI_API_KEY: '' },
  });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  assert.ok(await ate(() => /modo conversa/.test(saida), 15000), `o chat não abriu: ${saida}`);
  const fim = new Promise((resolve) => filho.on('exit', (codigo, sinal) => resolve({ codigo, sinal })));
  filho.kill('SIGHUP');
  const r = await Promise.race([fim, esperar(10000).then(() => ({ codigo: 'timeout' }))]);
  if (r.codigo === 'timeout') filho.kill('SIGKILL');
  assert.deepEqual(r, { codigo: 0, sinal: null }, 'saiu por process.exit (que dispara o encerramento dos comandos de fundo)');
});

test('com confirmShell ligado e sem terminal, segundo plano também é recusado', { skip: semPosix }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-bg-conf-'));
  fs.mkdirSync(path.join(home, '.gemini-code'));
  fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: config.CONFIG_VERSION, confirmShell: true }));
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'tools', 'shellTools'))}).execute('run_shell', { command: 'sleep 5', em_segundo_plano: true }).then((s) => console.log('SAIDA=' + s))`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.match(r.stdout, /SAIDA=Comando cancelado/);
});
