'use strict';
// v0.45.0: sandbox do run_shell (src/sandbox.js). Três partes:
//   1) peças puras (filtro seccomp conferido por um emulador de BPF, ambiente, pastas, montagem);
//   2) a decisão do run_shell (quando vai para a sandbox, quando pergunta) com um bwrap FALSO, que roda em
//      qualquer máquina;
//   3) fugas de verdade com o bwrap real — só onde ele funciona (o CI instala o bubblewrap).
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

// HOME falsa fora do /tmp (a sandbox troca o /tmp por um vazio): assim dá para ver o que ela esconde.
function baseFora() {
  for (const b of ['/var/tmp', os.tmpdir()]) {
    try { const d = fs.mkdtempSync(path.join(b, 'gemini-code-sbx-')); return d; } catch { /* tenta a próxima */ }
  }
  throw new Error('sem pasta temporária');
}
const BASE = baseFora();
const HOME_FALSO = path.join(BASE, 'home');
const PROJETO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-sbx-proj-'));
fs.mkdirSync(HOME_FALSO, { recursive: true });
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const sandbox = require('../src/sandbox');
const prompt = require('../src/ui/prompt');
const shell = require('../src/tools/shellTools');

const linux = process.platform === 'linux';
const verificarReal = sandbox.verificar;

test.after(() => {
  for (const d of [BASE, PROJETO]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ok */ } }
});

// ---------------------------------------------------------------------------
// 1) Peças puras
// ---------------------------------------------------------------------------

/** Emulador mínimo de BPF clássico (só as instruções que o filtro usa). */
function rodarBpf(buf, { nr, arch, arg0 = 0 }) {
  const dados = Buffer.alloc(64);
  dados.writeUInt32LE(nr >>> 0, 0);
  dados.writeUInt32LE(arch >>> 0, 4);
  dados.writeUInt32LE(arg0 >>> 0, 16);
  let pc = 0;
  let acc = 0;
  for (let passos = 0; passos < 100; passos++) {
    const code = buf.readUInt16LE(pc * 8);
    const jt = buf.readUInt8(pc * 8 + 2);
    const jf = buf.readUInt8(pc * 8 + 3);
    const k = buf.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) { acc = dados.readUInt32LE(k); pc++; continue; }
    if (code === 0x06) return k;
    const cond = code === 0x15 ? acc === k : code === 0x35 ? acc >= k : code === 0x25 ? acc > k : null;
    if (cond === null) throw new Error(`instrução desconhecida ${code}`);
    pc += 1 + (cond ? jt : jf);
  }
  throw new Error('laço no filtro');
}
const LIBERA = 0x7FFF0000;
const NEGA = 0x00050001;

test('seccomp (x86_64): nega socket AF_UNIX, io_uring, ABI x32 e 32 bits; libera o resto', () => {
  const f = sandbox.filtroSeccomp('x64');
  const X64 = 0xC000003E;
  assert.equal(rodarBpf(f, { arch: X64, nr: 41, arg0: 1 }), NEGA, 'socket(AF_UNIX)');
  assert.equal(rodarBpf(f, { arch: X64, nr: 41, arg0: 2 }), LIBERA, 'socket(AF_INET)');
  assert.equal(rodarBpf(f, { arch: X64, nr: 41, arg0: 10 }), LIBERA, 'socket(AF_INET6)');
  for (const nr of [425, 426, 427]) assert.equal(rodarBpf(f, { arch: X64, nr }), NEGA, `io_uring ${nr}`);
  for (const nr of [248, 249, 250]) assert.equal(rodarBpf(f, { arch: X64, nr }), NEGA, `chaveiro ${nr}`);
  for (const nr of [0, 1, 53, 59, 247, 251, 424, 428, 435]) assert.equal(rodarBpf(f, { arch: X64, nr }), LIBERA, `syscall ${nr}`);
  assert.equal(rodarBpf(f, { arch: X64, nr: 0x40000000 + 41, arg0: 1 }), NEGA, 'x32');
  assert.equal(rodarBpf(f, { arch: 0x40000003, nr: 102 }), NEGA, 'i386 (socketcall)');
});

test('seccomp (arm64): mesmo comportamento com os números do arm64', () => {
  const f = sandbox.filtroSeccomp('arm64');
  const A64 = 0xC00000B7;
  assert.equal(rodarBpf(f, { arch: A64, nr: 198, arg0: 1 }), NEGA);
  assert.equal(rodarBpf(f, { arch: A64, nr: 198, arg0: 2 }), LIBERA);
  assert.equal(rodarBpf(f, { arch: A64, nr: 425 }), NEGA);
  assert.equal(rodarBpf(f, { arch: A64, nr: 219 }), NEGA, 'keyctl');
  assert.equal(rodarBpf(f, { arch: A64, nr: 250 }), LIBERA, '250 não é keyctl no arm64');
  assert.equal(rodarBpf(f, { arch: A64, nr: 41, arg0: 1 }), LIBERA, '41 não é socket no arm64');
  assert.equal(rodarBpf(f, { arch: 0x40000028, nr: 281 }), NEGA, 'arm 32 bits');
  assert.equal(sandbox.filtroSeccomp('riscv64'), null);
});

test('ambiente: sem segredos nem sockets de sessão; GIT_CONFIG_* sai inteiro; TMPDIR=/tmp', () => {
  const env = sandbox.ambiente({
    PATH: '/usr/bin', LANG: 'pt_BR.UTF-8', GEMINI_API_KEY: 'x', GEMINI_CODE_OPENAI_KEY: 'x', GITHUB_TOKEN: 'x',
    AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'x', NPM_CONFIG__AUTH: 'x', DB_PASSWORD: 'x', SSH_AUTH_SOCK: '/tmp/s',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus', DISPLAY: ':0', XDG_RUNTIME_DIR: '/run/user/1',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: 'Authorization: x', TMPDIR: '/data/tmp',
    MONKEY: 'fica',
  });
  assert.deepEqual(Object.keys(env).sort(), ['GEMINI_CODE_SANDBOX', 'LANG', 'MONKEY', 'PATH', 'TMPDIR']);
  assert.equal(env.TMPDIR, '/tmp');
});

test('pastas graváveis: projeto sim; raiz, HOME, quem contém a HOME e caminho relativo não', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-proj-'));
  const extra = path.join(home, 'extra');
  fs.mkdirSync(extra);
  try {
    let r = sandbox.areasGravaveis({ projeto: proj, home, extras: ['~/extra', 'relativa', '/', path.dirname(home), '/nao/existe/mesmo', proj] });
    assert.deepEqual(r.gravaveis, [fs.realpathSync(proj), fs.realpathSync(extra)]);
    assert.equal(r.avisos.length, 4, r.avisos.join('\n'));
    r = sandbox.areasGravaveis({ projeto: home, home });
    assert.deepEqual(r.gravaveis, []);
    assert.match(r.avisos[0], /contém a HOME: na sandbox ela fica só leitura/);
    r = sandbox.areasGravaveis({ projeto: '/', home });
    assert.deepEqual(r.gravaveis, []);
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }); }
});

test('escondidos: ~/.gemini-code, credenciais que existem (pasta ou arquivo) e config que é link para fora', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-fora-'));
  try {
    const homeDir = path.join(home, '.gemini-code');
    fs.mkdirSync(homeDir);
    fs.mkdirSync(path.join(home, '.ssh'));
    fs.writeFileSync(path.join(home, '.netrc'), 'machine x');
    fs.writeFileSync(path.join(fora, 'config.json'), '{}');
    const lista = sandbox.caminhosEscondidos({ home, homeDir, protegidos: [path.join(fora, 'config.json'), path.join(homeDir, 'mcp.json')] });
    const por = Object.fromEntries(lista.map((e) => [e.caminho, e.pasta]));
    assert.equal(por[fs.realpathSync(homeDir)], true);
    assert.equal(por[fs.realpathSync(path.join(home, '.ssh'))], true);
    assert.equal(por[fs.realpathSync(path.join(home, '.netrc'))], false);
    assert.equal(por[fs.realpathSync(path.join(fora, 'config.json'))], false, 'o destino do link também some');
    assert.equal(lista.length, 4, 'o que não existe não entra; o que está dentro de ~/.gemini-code não repete');
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(fora, { recursive: true, force: true }); }
});

test('montagem: disco só leitura, projeto gravável, .git só leitura, sem rede, sem capabilities', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-proj-'));
  fs.mkdirSync(path.join(proj, '.git'));
  fs.writeFileSync(path.join(proj, '.git', 'config'), '[core]\n');
  try {
    const m = sandbox.montar('echo "oi"; ls', { info: { arquivo: '/usr/bin/bwrap', disableUserns: true }, cfg: {}, projeto: proj, cwd: proj });
    const a = m.args.join(' ');
    const p = fs.realpathSync(proj);
    assert.equal(m.arquivo, '/usr/bin/bwrap');
    assert.ok(a.startsWith('--ro-bind / / --dev /dev --proc /proc --tmpfs /tmp'), a);
    assert.ok(a.includes(`--bind ${p} ${p}`));
    assert.ok(a.includes(`--ro-bind ${p}/.git ${p}/.git`));
    assert.ok(a.indexOf('--bind ') < a.indexOf(`--ro-bind ${p}/.git`), 'trava depois de liberar');
    assert.equal(fs.existsSync(path.join(proj, '.git', 'hooks')), false, 'não cria nada no repositório');
    for (const f of ['--unshare-all', '--unshare-user', '--disable-userns', '--die-with-parent', '--new-session', '--cap-drop ALL', '--seccomp 3']) assert.ok(a.includes(f), f);
    assert.ok(!a.includes('--share-net'));
    assert.deepEqual(m.args.slice(-4), ['--', '/bin/sh', '-c', 'echo "oi"; ls'], 'o comando vai inteiro, como um argumento');
    if (fs.existsSync(config.HOME_DIR)) assert.ok(a.includes(`--tmpfs ${fs.realpathSync(config.HOME_DIR)} --remount-ro`));
    assert.ok(Buffer.isBuffer(m.bpf) || m.bpf === null);
    const comRede = sandbox.montar('true', { info: { arquivo: 'bwrap', disableUserns: false }, cfg: { shellSandboxRede: true }, projeto: proj });
    assert.ok(comRede.args.includes('--share-net'));
    assert.ok(!comRede.args.includes('--disable-userns'), 'bwrap antigo: sem a flag');
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
});

test('achar o bwrap: nunca um plantado onde o modelo grava, gravável por outros ou de PATH relativo', () => {
  const dirs = ['plantado', 'gravavel', 'bom'].map((n) => { const d = path.join(BASE, `bin-${n}`); fs.mkdirSync(d, { recursive: true }); return d; });
  for (const d of dirs) fs.writeFileSync(path.join(d, 'bwrap'), '#!/bin/sh\n', { mode: 0o755 });
  fs.chmodSync(path.join(dirs[1], 'bwrap'), 0o775);
  const env = { PATH: ['relativo/bin', ...dirs].join(path.delimiter) };
  const achado = sandbox.acharBwrap(env, { proibidas: [dirs[0]] });
  const doSistema = sandbox.LOCAIS_BWRAP.some((p) => fs.existsSync(p));
  assert.notEqual(achado, path.join(dirs[0], 'bwrap'));
  assert.notEqual(achado, path.join(dirs[1], 'bwrap'));
  if (!doSistema) assert.equal(achado, fs.realpathSync(path.join(dirs[2], 'bwrap')));
  // a área do modelo: temporária, projeto (ou a HOME inteira, se o projeto a contém) e as pastas liberadas
  const areas = sandbox.areasDoModelo({ cwd: '/', home: HOME_FALSO, extras: ['~/x'] });
  assert.ok(areas.includes(fs.realpathSync(HOME_FALSO)), 'aberto na raiz: a HOME conta');
  assert.ok(areas.includes(path.join(fs.realpathSync(HOME_FALSO), 'x')));
});

test('verificar: explica por que não há sandbox fora do Linux e sem bwrap', async () => {
  assert.match((await sandbox.verificar({ plataforma: 'android' })).motivo, /Android/);
  assert.match((await sandbox.verificar({ plataforma: 'darwin' })).motivo, /macOS/);
  assert.match((await sandbox.verificar({ plataforma: 'win32' })).motivo, /só existe no Linux/);
  assert.match((await sandbox.verificar({ plataforma: 'linux', arch: 'mips' })).motivo, /arquitetura/);
  const r = await sandbox.verificar({ plataforma: 'linux', arch: 'x64', arquivo: path.join(BASE, 'nao-existe', 'bwrap') });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /não conseguiu isolar/);
});

// ---------------------------------------------------------------------------
// 2) Decisão do run_shell com um bwrap FALSO (grava os argumentos e roda o comando sem isolar)
// ---------------------------------------------------------------------------
const FALSO = path.join(BASE, 'bwrap-falso.js');
const LOG = path.join(BASE, 'bwrap-falso.log');
fs.writeFileSync(FALSO, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
let filtro = 0;
try { filtro = fs.readFileSync(3).length; } catch { /* sem fd 3 */ }
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ args, filtro, segredo: process.env.SEGREDO_TOKEN || null }) + '\\n');
const i = args.indexOf('--');
const dir = args[args.indexOf('--chdir') + 1];
const r = require('child_process').spawnSync(args[i + 1], args.slice(i + 2), { cwd: dir, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`, { mode: 0o755 });
const chamadasFalso = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

function cenario({ cfg = {}, respostas = [], disponivel = true } = {}) {
  config.saveConfig({ confirmShell: true, shellSandbox: 'auto', permissoes: { permitir: [], negar: [] }, ...cfg });
  try { fs.unlinkSync(LOG); } catch { /* primeira vez */ }
  const perguntas = [];
  prompt.ask = async (q) => { perguntas.push(q); return respostas.shift() ?? ''; };
  sandbox.verificar = async () => (disponivel ? { ok: true, arquivo: FALSO, disableUserns: true } : { ok: false, motivo: 'sem bwrap (teste)' });
  return perguntas;
}

test.afterEach(() => { sandbox.verificar = verificarReal; });

test('auto + confirmShell desligado: roda na sandbox sem perguntar, filtro e ambiente limpos', { skip: !linux }, async () => {
  const perguntas = cenario({ cfg: { confirmShell: false } });
  process.env.SEGREDO_TOKEN = 'nao-pode-passar';
  try {
    const r = await shell.execute('run_shell', { command: 'echo dentro' });
    assert.match(r, /^dentro\n\[exit code 0\]\n\[sandbox: sem rede; \/tmp descartável\]$/);
  } finally { delete process.env.SEGREDO_TOKEN; }
  assert.equal(perguntas.length, 0);
  const [c] = chamadasFalso();
  assert.ok(c.filtro > 0, 'o filtro seccomp chega pelo fd 3');
  assert.equal(c.segredo, null, 'variável com cara de segredo não entra');
});

test('auto + confirmShell ligado: pergunta e, aprovado, roda FORA da sandbox (você viu o comando)', { skip: !linux }, async () => {
  const perguntas = cenario({ respostas: ['s'] });
  const r = await shell.execute('run_shell', { command: 'echo fora' });
  assert.match(r, /^fora\n\[exit code 0\]$/);
  assert.equal(perguntas.length, 1);
  assert.doesNotMatch(perguntas[0], /sandbox/);
  assert.equal(chamadasFalso().length, 0);
});

test('auto + regra "permitir": não pergunta, então vai para a sandbox', { skip: !linux }, async () => {
  const perguntas = cenario({ cfg: { permissoes: { permitir: ['run_shell(echo *)'], negar: [] } } });
  assert.match(await shell.execute('run_shell', { command: 'echo regra' }), /\[sandbox:/);
  assert.equal(perguntas.length, 0);
  assert.equal(chamadasFalso().length, 1);
});

test('rotina (ninguém para responder): em vez de recusar, roda na sandbox; destrutivo continua recusado', { skip: !linux }, async () => {
  cenario();
  const liberar = prompt.suspenderPerguntas();
  try {
    assert.match(await shell.execute('run_shell', { command: 'echo rotina' }), /^rotina\n\[exit code 0\]\n\[sandbox/);
    const destrutivo = await shell.execute('run_shell', { command: 'rm -rf ./build' });
    assert.equal(destrutivo, 'Comando cancelado pelo usuário.');
  } finally { liberar(); }
  assert.equal(chamadasFalso().length, 1);
});

test('sempre: até o comando aprovado roda na sandbox, e a pergunta diz isso', { skip: !linux }, async () => {
  const perguntas = cenario({ cfg: { shellSandbox: 'sempre' }, respostas: ['s'] });
  assert.match(await shell.execute('run_shell', { command: 'echo isolado' }), /\[sandbox:/);
  assert.match(perguntas[0], /na sandbox: sem rede; grava só em/);
  assert.equal(chamadasFalso().length, 1);
});

test('sempre sem sandbox disponível: recusa sem rodar e explica', { skip: !linux }, async () => {
  const perguntas = cenario({ cfg: { shellSandbox: 'sempre', confirmShell: false }, disponivel: false });
  const marca = path.join(PROJETO, 'nao-rodou.txt');
  const r = await shell.execute('run_shell', { command: `echo x > ${JSON.stringify(marca)}` });
  assert.match(r, /^Erro: a sandbox está no modo "sempre", mas não funciona aqui \(sem bwrap \(teste\)\)/);
  assert.equal(fs.existsSync(marca), false);
  assert.equal(perguntas.length, 0);
});

test('fora_da_sandbox: sempre pergunta (mesmo com confirmShell desligado); "n" cancela, "s" roda sem isolar', { skip: !linux }, async () => {
  let perguntas = cenario({ cfg: { confirmShell: false }, respostas: ['n'] });
  assert.equal(await shell.execute('run_shell', { command: 'echo x', fora_da_sandbox: true }), 'Comando cancelado pelo usuário.');
  assert.match(perguntas[0], /FORA da sandbox/);
  perguntas = cenario({ cfg: { confirmShell: false }, respostas: ['s'] });
  assert.match(await shell.execute('run_shell', { command: 'echo livre', fora_da_sandbox: true }), /^livre\n\[exit code 0\]$/);
  assert.equal(perguntas.length, 1);
  assert.equal(chamadasFalso().length, 0);
  // numa rotina não há quem confirme a saída: recusado
  cenario({ cfg: { confirmShell: false } });
  const liberar = prompt.suspenderPerguntas();
  try { assert.equal(await shell.execute('run_shell', { command: 'echo x', fora_da_sandbox: true }), 'Comando cancelado pelo usuário.'); } finally { liberar(); }
});

test('off: nunca usa a sandbox; sem sandbox disponível, auto se comporta como antes', { skip: !linux }, async () => {
  cenario({ cfg: { shellSandbox: 'off', confirmShell: false } });
  assert.match(await shell.execute('run_shell', { command: 'echo a' }), /^a\n\[exit code 0\]$/);
  cenario({ cfg: { confirmShell: false }, disponivel: false });
  assert.match(await shell.execute('run_shell', { command: 'echo b' }), /^b\n\[exit code 0\]$/);
  assert.equal(chamadasFalso().length, 0);
});

test('falha dentro da sandbox: a saída explica o isolamento e como sair dele', { skip: !linux }, async () => {
  cenario({ cfg: { confirmShell: false } });
  const r = await shell.execute('run_shell', { command: 'echo ops >&2; exit 3' });
  assert.match(r, /^Erro ao executar \(exit code 3\):/);
  assert.match(r, /\[sandbox: sem rede; grava só em .*Se o erro veio disso, repita com fora_da_sandbox: true/);
});

test('segundo plano também vai para a sandbox', { skip: !linux }, async () => {
  cenario({ cfg: { confirmShell: false } });
  const r = await shell.execute('run_shell', { command: 'echo fundo', em_segundo_plano: true });
  assert.match(r, /^Iniciado em segundo plano na sandbox: id=(bg\d+)/);
  const id = r.match(/id=(bg\d+)/)[1];
  const fim = Date.now() + 5000;
  while (Date.now() < fim && !/terminou/.test(await shell.execute('shell_status', { id }))) await new Promise((ok) => setTimeout(ok, 50));
  assert.match(await shell.execute('shell_status', { id }), /terminou \(exit 0\)[\s\S]*fundo/);
  assert.equal(chamadasFalso().length, 1);
});

// ---------------------------------------------------------------------------
// 3) bwrap de verdade: tentativas de fuga
// ---------------------------------------------------------------------------
let real = null;
test.before(async () => { real = await verificarReal(); });
const semReal = () => !real || !real.ok;
// No CI o bubblewrap é instalado: lá, sem sandbox de verdade é falha, não "pulado" (senão o teste nunca roda).
function pular(t) {
  const motivo = `sem sandbox real: ${real && real.motivo}`;
  if (process.env.GEMINI_CODE_EXIGIR_SANDBOX === '1') assert.fail(motivo);
  return t.skip(motivo);
}

async function naSandboxReal(comando, cfg = {}) {
  config.saveConfig({ confirmShell: false, shellSandbox: 'auto', shellSandboxRede: false, shellTimeoutMs: 120000, ...cfg });
  sandbox.verificar = verificarReal;
  const antes = process.cwd();
  process.chdir(PROJETO);
  try { return await shell.execute('run_shell', { command: comando }); } finally { process.chdir(antes); }
}

test('real: grava no projeto, não grava fora; /tmp é descartável', async (t) => {
  if (semReal()) return pular(t);
  const r = await naSandboxReal(`echo ok > dentro.txt && echo x > ${JSON.stringify(path.join(BASE, 'fora.txt'))}; echo t > /tmp/t.txt; cat /tmp/t.txt`);
  assert.ok(fs.existsSync(path.join(PROJETO, 'dentro.txt')), r);
  assert.equal(fs.existsSync(path.join(BASE, 'fora.txt')), false, r);
  if (!BASE.startsWith(os.tmpdir())) assert.match(r, /Read-only file system/);
  assert.match(r, /(^|\n)t\n/, 'o /tmp funciona dentro do comando');
});

test('real: ~/.gemini-code, ~/.ssh e variáveis de segredo ficam invisíveis', async (t) => {
  if (semReal()) return pular(t);
  fs.mkdirSync(config.HOME_DIR, { recursive: true });
  fs.writeFileSync(path.join(config.HOME_DIR, 'cofre.txt'), 'SEGREDO-GEMINI');
  fs.mkdirSync(path.join(HOME_FALSO, '.ssh'), { recursive: true });
  fs.writeFileSync(path.join(HOME_FALSO, '.ssh', 'id_teste'), 'SEGREDO-SSH');
  process.env.MINHA_API_KEY = 'SEGREDO-ENV';
  let r;
  try {
    r = await naSandboxReal(`cat ${JSON.stringify(path.join(config.HOME_DIR, 'cofre.txt'))} ~/.ssh/id_teste; env; touch ~/.ssh/novo`);
  } finally { delete process.env.MINHA_API_KEY; }
  assert.doesNotMatch(r, /SEGREDO-/, r);
  assert.match(r, /No such file/);
  assert.equal(fs.existsSync(path.join(HOME_FALSO, '.ssh', 'novo')), false);
});

test('real: sem rede (nem a máquina local) e sem conectar em socket do sistema (seccomp)', async (t) => {
  if (semReal()) return pular(t);
  const tcp = net.createServer((s) => s.end('TCP-ABERTO')).listen(0, '127.0.0.1');
  await new Promise((ok) => tcp.once('listening', ok));
  const caminhoSock = path.join(PROJETO, 'servico.sock'); // visível lá dentro: só o seccomp segura
  const unix = net.createServer((s) => s.end('UNIX-ABERTO')).listen(caminhoSock);
  await new Promise((ok) => unix.once('listening', ok));
  try {
    const js = `const net=require('net');` +
      `net.connect(${tcp.address().port},'127.0.0.1').on('data',d=>console.log(String(d))).on('error',e=>console.log('tcp:'+e.code));` +
      `net.connect(${JSON.stringify(caminhoSock)}).on('data',d=>console.log(String(d))).on('error',e=>console.log('unix:'+e.code));`;
    const r = await naSandboxReal(`${JSON.stringify(process.execPath)} -e ${JSON.stringify(js)}`);
    assert.doesNotMatch(r, /ABERTO/, r);
    assert.match(r, /tcp:ECONNREFUSED/);
    assert.match(r, /unix:EPERM/);
  } finally { tcp.close(); unix.close(); }
});

test('real: o .git inteiro é só leitura e não dá para trocá-lo (hooks, config, commondir, renomear)', async (t) => {
  if (semReal()) return pular(t);
  const git = path.join(PROJETO, '.git');
  fs.mkdirSync(path.join(git, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[core]\n');
  const r = await naSandboxReal('echo "#!/bin/sh" > .git/hooks/pre-commit; echo "[core] fsmonitor = x" >> .git/config; ' +
    'echo /tmp/outro > .git/commondir; mv .git .git-velho; rmdir .git; echo fim');
  assert.equal(fs.existsSync(path.join(git, 'hooks', 'pre-commit')), false, r);
  assert.equal(fs.readFileSync(path.join(git, 'config'), 'utf8'), '[core]\n');
  assert.equal(fs.existsSync(path.join(git, 'commondir')), false);
  assert.equal(fs.existsSync(path.join(PROJETO, '.git-velho')), false);
  assert.match(r, /fim/);
});

test('real: timeout mata o comando inteiro (nada fica rodando)', async (t) => {
  if (semReal()) return pular(t);
  const marca = `gc-sbx-${process.pid}-dorme`;
  const r = await naSandboxReal(`${JSON.stringify(process.execPath)} -e "setInterval(()=>{},1000)" ${marca}`, { shellTimeoutMs: 400 });
  assert.match(r, /timeout/);
  await new Promise((ok) => setTimeout(ok, 300));
  const vivos = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).filter((n) => {
    try { return fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').includes(marca); } catch { return false; }
  });
  assert.deepEqual(vivos, []);
});

test('real: shell_status encerrar derruba o comando de fundo da sandbox', async (t) => {
  if (semReal()) return pular(t);
  config.saveConfig({ confirmShell: false, shellSandbox: 'auto', shellTimeoutMs: 120000 });
  sandbox.verificar = verificarReal;
  const marca = `gc-sbx-${process.pid}-fundo`;
  const r = await shell.execute('run_shell', { command: `${JSON.stringify(process.execPath)} -e "setInterval(()=>{},1000)" ${marca}`, em_segundo_plano: true });
  const id = r.match(/id=(bg\d+)/)[1];
  t.after(() => shell.execute('shell_status', { id, encerrar: true }));
  // o próprio bwrap também leva a marca nos argumentos: basta haver algum processo com ela
  const vivos = () => fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).filter((n) => {
    try { return fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').includes(marca); } catch { return false; }
  });
  let fim = Date.now() + 3000;
  while (Date.now() < fim && !vivos().length) await new Promise((ok) => setTimeout(ok, 50));
  assert.ok(vivos().length >= 1, 'começou');
  await shell.execute('shell_status', { id, encerrar: true });
  fim = Date.now() + 3000;
  while (Date.now() < fim && vivos().length) await new Promise((ok) => setTimeout(ok, 50));
  assert.deepEqual(vivos().map((n) => `${n} ${fs.readFileSync(`/proc/${n}/stat`, 'utf8').slice(0, 80)}`), []);
});
