'use strict';
// v0.46.0: melhorador de TV — diagnóstico (só lê), otimizar (pergunta a cada passo), desfazer, e a ação na ferramenta adb.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-tv-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const tv = require('../src/tvOtimizar');
const adbTools = require('../src/tools/adbTools');
const adbFalso = require('./fixtures/adbFalso').criarAdbFalso();

const executar = () => tv.executorAdb({ adbPath: adbFalso.WRAP, alvo: '' });
const mudancas = () => adbFalso.noAparelho().filter((x) => (x[0] === 'settings' && x[1] === 'put') || (x[0] === 'pm' && x[1] === 'trim-caches') || (x[0] === 'am' && x[1] === 'kill-all'));

test.beforeEach(() => {
  adbFalso.limpar();
  config.saveConfig({ adbPath: adbFalso.WRAP, adbSerial: '', adbConfirm: false, permissoes: { permitir: ['adb(*)'], negar: [] } });
});
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

test('leitura das saídas do aparelho (df, dumpsys meminfo, diskstats)', () => {
  assert.deepEqual(tv.lerDf('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/x 1000 900 100 90% /data'), { totalKb: 1000, usadoKb: 900, livreKb: 100, pct: 90 });
  assert.equal(tv.lerDf('lixo'), null);
  assert.deepEqual(tv.lerMemoriaPorApp('x\nTotal PSS by process:\n  1,024K: com.a (pid 1)\n  2,048K: com.b\n\noutra coisa'), [{ app: 'com.a', mb: 1 }, { app: 'com.b', mb: 2 }]);
  assert.deepEqual(tv.lerDiskstats('Package Names: ["a","b"]\nApp Sizes: [1048576,0]\nApp Data Sizes: [1048576,0]\nCache Sizes: [0,0]'), [{ app: 'a', totalMb: 2, cacheMb: 0 }]);
});

test('diagnóstico só LÊ: memória, disco, animações, apps; sugere o que vale a pena', async () => {
  const d = await tv.diagnostico(executar());
  assert.equal(d.aparelho, 'Sony BRAVIA');
  assert.equal(d.disco.pct, 90);
  assert.deepEqual(Object.values(d.animacoes), [1, 1, 1]);
  assert.equal(d.maisMemoria[0].app, 'com.netflix.ninja');
  assert.deepEqual(tv.recomendar(d), ['animacoes', 'cache', 'fechar']);
  assert.match(tv.relatorio(d), /Armazenamento: 90% usado .*quase cheio/);
  assert.deepEqual(mudancas(), [], 'nada foi mudado');
});

test('otimizar: cada passo pergunta; só o "sim" roda; comandos fixos e entre aspas', async () => {
  const perguntas = [];
  const respostas = ['s', 'n', 's'];
  const r = await tv.otimizar(executar(), async (q) => { perguntas.push(q); return respostas.shift(); });
  assert.equal(perguntas.length, 3);
  assert.deepEqual(r.feitos.map((f) => [f.passo, f.feito]), [['animacoes', true], ['cache', false], ['fechar', true]]);
  assert.deepEqual(mudancas().map((x) => x.join(' ')), [
    'settings put global window_animation_scale 0.5', 'settings put global transition_animation_scale 0.5',
    'settings put global animator_duration_scale 0.5', 'am kill-all',
  ]);
  adbFalso.limpar();
  assert.equal(await tv.desfazer(executar()), null);
  assert.deepEqual(mudancas().map((x) => x[4]), ['1', '1', '1']);
});

test('ferramenta adb: diagnostico sem perguntar; otimizar pergunta CADA passo mesmo com adbConfirm:false e "permitir"', async () => {
  const perguntas = [];
  assert.match(await adbTools.execute('adb', { acao: 'diagnostico' }, { ask: async (q) => { perguntas.push(q); return 's'; } }), /Sony BRAVIA/);
  assert.equal(perguntas.length, 0);
  const r = await adbTools.execute('adb', { acao: 'otimizar' }, { ask: async (q) => { perguntas.push(q); return 'n'; } });
  assert.equal(perguntas.length, 3);
  assert.match(r, /^Otimização:\n.*pulado/);
  assert.deepEqual(mudancas(), [], 'nada mudou sem o sim');
  // numa rotina (ninguém responde: '') também não muda nada
  await adbTools.execute('adb', { acao: 'otimizar' }, { ask: async () => '' });
  assert.deepEqual(mudancas(), []);
});

test('rotina de TV não aceita otimizar (só ações que não mudam configuração)', () => {
  const { createRoutineStore } = require('../src/routines');
  const store = createRoutineStore({ dataPath: path.join(HOME, 'r.json'), executionsPath: path.join(HOME, 'e.json') });
  assert.throws(() => store.create({ name: 'x', trigger: { type: 'interval', intervalMs: 60000, timezone: 'UTC' }, action: { type: 'adb', passos: [{ acao: 'otimizar' }] } }), /não pode rodar sozinho/);
});
