'use strict';
// v0.47.0: correções que apareceram no caminho — o bwrap de dentro que ficava órfão no encerrar, e o "--at" das rotinas
// que lia "04/11/2026" como 11 de abril.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-v047-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const sandbox = require('../src/sandbox');

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const vivo = (pid) => {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch { return false; }
};
const esperar = async (cond, ms = 3000) => { const fim = Date.now() + ms; while (Date.now() < fim && !cond()) await new Promise((r) => setTimeout(r, 25)); return cond(); };

test('sandbox: encerrar acha o bwrap de dentro que nasceu órfão (mesma marca) — e não mexe no vizinho', { skip: process.platform !== 'linux' && 'só Linux (/proc)' }, async () => {
  const id = 'a1b2c3d4e5f60718';
  const outro = 'ffffffffffffffff';
  const programa = 'setInterval(() => {}, 1000)';
  // "órfão": carrega a marca desta execução nos argumentos, como o bwrap de dentro (fork do de fora); tem um filho
  const orfao = spawn(process.execPath, ['-e', `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(programa)}], { stdio: 'ignore' }); ${programa}`, '--', '--setenv', 'GEMINI_CODE_SANDBOX', id], { detached: true, stdio: 'ignore' });
  const vizinho = spawn(process.execPath, ['-e', programa, '--', '--setenv', 'GEMINI_CODE_SANDBOX', outro], { detached: true, stdio: 'ignore' });
  const deFora = spawn(process.execPath, ['-e', programa], { detached: true, stdio: 'ignore' });
  try {
    assert.ok(await esperar(() => vivo(orfao.pid) && vivo(vizinho.pid) && vivo(deFora.pid)));
    // o neto do órfão
    let neto = null;
    await esperar(() => {
      for (const n of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(n)) continue;
        try { const st = fs.readFileSync(`/proc/${n}/stat`, 'utf8'); if (Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]) === orfao.pid) neto = Number(n); } catch { /* sumiu */ }
      }
      return neto !== null;
    });
    assert.ok(neto, 'o órfão tem um filho');
    sandbox.matarSandbox(deFora.pid, id);
    assert.ok(await esperar(() => !vivo(orfao.pid) && !vivo(neto) && !vivo(deFora.pid)), 'órfão, filho dele e o de fora morrem');
    assert.ok(vivo(vizinho.pid), 'outra execução (outra marca) continua');
  } finally {
    for (const p of [orfao, vizinho, deFora]) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* já saiu */ } }
  }
});

test('sandbox: cada execução leva uma marca única nos argumentos', () => {
  const info = { arquivo: '/usr/bin/bwrap', disableUserns: true };
  const a = sandbox.montar('echo oi', { cwd: HOME, info, env: {} });
  const b = sandbox.montar('echo oi', { cwd: HOME, info, env: {} });
  assert.match(a.id, /^[0-9a-f]{16}$/);
  assert.notEqual(a.id, b.id);
  const i = a.args.indexOf('GEMINI_CODE_SANDBOX');
  assert.equal(a.args[i - 1], '--setenv');
  assert.equal(a.args[i + 1], a.id);
  assert.ok(i < a.args.indexOf('--'), 'a marca vai nas opções do bwrap, antes do comando');
});

test('routines create --at: "04/11/2030 09:00" é 4 de NOVEMBRO; data impossível é recusada', () => {
  const cli = (args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gemini-code.js'), ...args], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME, USERPROFILE: HOME, NO_COLOR: '1', GEMINI_API_KEY: '' },
  });
  let r = cli(['routines', 'create', '--name', 'Teste', '--lembrete', 'Oi', '--at', '04/11/2030 09:00']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rotinas = JSON.parse(fs.readFileSync(path.join(HOME, '.gemini-code', 'routines.json'), 'utf8'));
  const lista = Array.isArray(rotinas) ? rotinas : rotinas.routines;
  const criada = lista.find((x) => x.name === 'Teste');
  assert.equal(criada.trigger.runAt, new Date(2030, 10, 4, 9, 0).toISOString(), 'antes: 11 de abril');
  r = cli(['routines', 'create', '--name', 'Teste2', '--lembrete', 'Oi', '--at', '31/02/2030']);
  assert.match(r.stdout + r.stderr, /Data inválida/);
});
