'use strict';
// v0.44.1: rotina "adb" — comandos para a TV/celular no horário marcado, sem IA. Só ações que não destroem
// nada, passos aprovados por quem criou a rotina (rodam sem perguntar), sem repetição (um "power" repetido
// desfaria o primeiro), reconexão antes quando a TV está na rede e as regras "negar" valendo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-rotina-tv-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { createRoutineStore, ACOES_ROTINA_ADB } = require('../src/routines');
const { createRoutineRunner } = require('../src/routineRunner');
const adbFalso = require('./fixtures/adbFalso').criarAdbFalso();

const BIN = path.join(__dirname, '..', 'bin', 'gemini-code.js');
const gatilho = { type: 'interval', intervalMs: 60000, timezone: 'UTC' };

function loja() {
  const dir = fs.mkdtempSync(path.join(HOME_FALSO, 'rotinas-'));
  return createRoutineStore({ dataPath: path.join(dir, 'routines.json'), executionsPath: path.join(dir, 'executions.json') });
}
const criar = (store, action) => store.create({ name: 'TV da sala', trigger: gatilho, action: { type: 'adb', ...action } });

test.beforeEach(() => {
  adbFalso.limpar();
  config.saveConfig({ adbPath: adbFalso.WRAP, adbSerial: '', adbPorta: 5555, adbConfirm: true, permissoes: { permitir: [], negar: [] } });
});

test('validação: só ações que não destroem nada; esperar e limites conferidos', () => {
  const store = loja();
  const r = criar(store, { alvo: '192.168.0.50', passos: [{ acao: 'tecla', tecla: 'acordar' }, { acao: 'esperar', segundos: 3 }, { acao: 'abrir_link', link: 'https://youtu.be/x' }] });
  assert.equal(r.category, 'aparelho');
  assert.deepEqual(r.action.passos[2], { acao: 'abrir_link', link: 'https://youtu.be/x' });
  for (const acao of ['reiniciar', 'desinstalar', 'limpar', 'shell', 'instalar', 'config', 'parear', 'tcpip']) {
    assert.throws(() => criar(store, { passos: [{ acao, app: 'com.x.y', comando: 'reboot' }] }), /não pode rodar sozinho numa rotina/, acao);
  }
  assert.throws(() => criar(store, { passos: [{ acao: 'tecla', tecla: 'a;reboot' }] }), /tecla desconhecida/);
  assert.throws(() => criar(store, { passos: [{ acao: 'abrir_link', link: 'file:///sdcard' }] }), /http/);
  assert.throws(() => criar(store, { passos: [{ acao: 'esperar', segundos: 61 }] }), /1 a 60/);
  assert.throws(() => criar(store, { passos: [{ acao: 'esperar', segundos: 5 }] }), /além de esperar/);
  assert.throws(() => criar(store, { passos: [] }), /1 a 20 passos/);
  assert.throws(() => criar(store, { alvo: '-s x', passos: [{ acao: 'info' }] }), /alvo inválido/);
  assert.ok(!ACOES_ROTINA_ADB.includes('shell') && !ACOES_ROTINA_ADB.includes('reiniciar'));
});

test('execução: reconecta a TV por rede antes, roda os passos sem perguntar e espera entre eles', async () => {
  const store = loja();
  const r = criar(store, { alvo: '192.168.0.50', passos: [{ acao: 'tecla', tecla: 'acordar' }, { acao: 'esperar', segundos: 2 }, { acao: 'abrir_app', app: 'com.netflix.ninja' }] });
  const esperas = [];
  const runner = createRoutineRunner({ store, adb: { dormir: async (ms) => { esperas.push(ms); } } });
  const exec = await runner.execute(r.id, { source: 'teste' });
  assert.equal(exec.status, 'concluida', JSON.stringify(exec.result));
  assert.deepEqual(adbFalso.chamadas()[0], ['connect', '192.168.0.50:5555'], 'reconecta primeiro, com a porta padrão');
  assert.ok(adbFalso.chamadas().slice(1).every((c) => c[0] === '-s' && c[1] === '192.168.0.50:5555'), 'cada passo vai para a TV certa');
  assert.deepEqual(adbFalso.noAparelho(), [['input', 'keyevent', 'KEYCODE_WAKEUP'], ['monkey', '-p', 'com.netflix.ninja', '-c', 'android.intent.category.LAUNCHER', '1']]);
  assert.deepEqual(esperas, [2000]);
  assert.equal(exec.result.passos.length, 4);
  assert.match(exec.result.message, /3 passo\(s\)/);
});

test('falha: para no passo que falhou e NÃO repete (um "power" repetido desfaria o primeiro)', async () => {
  config.saveConfig({ adbPath: adbFalso.WRAP_FALHA });
  const store = loja();
  const r = criar(store, { passos: [{ acao: 'tecla', tecla: 'power' }, { acao: 'abrir_app', app: 'com.netflix.ninja' }] });
  const runner = createRoutineRunner({ store, baseRetryMs: 1 });
  const exec = await runner.execute(r.id);
  assert.equal(exec.status, 'falhou');
  assert.match(exec.error, /Passo 1 \(tecla\) falhou: adb falhou/);
  assert.equal(adbFalso.chamadas().length, 1, 'uma tentativa só, e o passo 2 não rodou');
});

test('regras "negar" do usuário valem na rotina; arquivo editado à mão com ação perigosa é recusado na hora de rodar', async () => {
  config.saveConfig({ permissoes: { permitir: [], negar: ['adb(*netflix*)'] } });
  const store = loja();
  const r = criar(store, { passos: [{ acao: 'tecla', tecla: 'home' }, { acao: 'abrir_app', app: 'com.netflix.ninja' }] });
  const exec = await createRoutineRunner({ store }).execute(r.id);
  assert.equal(exec.status, 'falhou');
  assert.match(exec.error, /Passo 2 \(abrir_app\) bloqueado pela regra de permissão "adb\(\*netflix\*\)"/);
  assert.deepEqual(adbFalso.noAparelho(), [['input', 'keyevent', 'KEYCODE_HOME']]);

  adbFalso.limpar();
  const editada = criar(store, { passos: [{ acao: 'tecla', tecla: 'home' }] });
  store.update(editada.id, { action: { type: 'adb', passos: [{ acao: 'shell', comando: 'reboot' }] } });
  const exec2 = await createRoutineRunner({ store }).execute(editada.id);
  assert.equal(exec2.status, 'falhou');
  assert.match(exec2.error, /não pode rodar sozinho/);
  assert.deepEqual(adbFalso.chamadas(), [], 'nada chegou ao adb');
});

test('CLI de ponta a ponta: routines create --tv, run e logs com o adb falso', () => {
  const env = { ...process.env, ...adbFalso.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO };
  const cli = (...args) => spawnSync(process.execPath, [BIN, 'routines', ...args], { env, encoding: 'utf8' });
  const criado = cli('create', '--name', 'Dormir', '--tv', 'tecla dormir', '--tv', 'esperar 1', '--tv', 'link https://youtu.be/x com.google.android.youtube.tv', '--cron', '0 23 * * *');
  assert.equal(criado.status, 0, criado.stderr);
  assert.match(criado.stdout, /Passos no aparelho .*tecla dormir → esperar 1 → abrir_link https:\/\/youtu\.be\/x com\.google\.android\.youtube\.tv/);
  const id = criado.stdout.match(/^([0-9a-f-]{36}) \| rascunho \| Dormir \| adb/m)[1];

  const rodou = cli('run', id);
  assert.equal(rodou.status, 0, rodou.stdout + rodou.stderr);
  assert.deepEqual(adbFalso.noAparelho(), [
    ['input', 'keyevent', 'KEYCODE_SLEEP'],
    ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://youtu.be/x', '-p', 'com.google.android.youtube.tv'],
  ]);
  assert.match(cli('logs').stdout, /concluida .*3 passo\(s\) enviados ao aparelho\. tecla: Tecla dormir enviada/);

  const perigoso = cli('create', '--name', 'X', '--tv', 'reiniciar', '--every', '5m');
  assert.notEqual(perigoso.status, 0);
  assert.match(perigoso.stderr, /não pode rodar sozinho numa rotina/);
  assert.match(cli('create', '--name', 'X', '--tv', 'voar', '--every', '5m').stderr, /comando de aparelho desconhecido/);
});
