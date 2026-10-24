'use strict';
// v0.43.0: ferramenta adb (src/tools/adbTools.js). Usa um `adb` FALSO (um script Node) apontado por
// adbPath: ele registra os argumentos exatos que recebeu e imprime respostas prontas, sem aparelho nem
// adb de verdade. Assim dá para checar que os comandos são montados certo (lista de argumentos, sem
// shell), que ações que mudam o aparelho pedem confirmação e que as de leitura não.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-adb-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const adb = require('../src/tools/adbTools');

// adb falso: grava cada chamada (argv) em ADB_LOG e responde conforme o conteúdo.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-fake-'));
const LOG = path.join(DIR, 'chamadas.log');
const FAKE = path.join(DIR, 'adb-fake.js');
fs.writeFileSync(FAKE, `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.ADB_LOG, JSON.stringify(a) + '\\n');
if (process.env.ADB_MODE === 'fail') { process.stderr.write('device offline\\n'); process.exit(1); }
const tem = (x) => a.includes(x);
if (tem('devices')) { process.stdout.write('List of devices attached\\nABC123\\tdevice\\n'); process.exit(0); }
if (tem('getprop')) { process.stdout.write('[ro.product.brand]: [Sony]\\n[ro.product.model]: [BRAVIA]\\n[ro.build.version.release]: [11]\\n[ro.build.version.sdk]: [30]\\n[ro.build.characteristics]: [tv]\\n'); process.exit(0); }
if (tem('packages')) { process.stdout.write('package:com.netflix.ninja\\npackage:com.spotify.tv.android\\n'); process.exit(0); }
if (tem('exec-out') && tem('screencap')) { process.stdout.write(Buffer.from([0x89,0x50,0x4e,0x47,13,10,26,10])); process.exit(0); }
if (tem('connect')) { process.stdout.write('connected to ' + a[a.length-1] + '\\n'); process.exit(0); }
process.stdout.write('ok\\n'); process.exit(0);
`);
fs.chmodSync(FAKE, 0o755);
process.env.ADB_LOG = LOG;

function reset(extra = {}) {
  fs.writeFileSync(LOG, '');
  config.saveConfig({ adbPath: `${process.execPath} ${FAKE}`, adbSerial: '', adbPorta: 5555, adbConfirm: true, permissoes: { permitir: [], negar: [] }, ...extra });
}
// adbPath com espaço (node + script) não funciona com execFile; então apontamos adbPath para um wrapper executável.
const WRAP = path.join(DIR, 'adb');
fs.writeFileSync(WRAP, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
fs.chmodSync(WRAP, 0o755);

function chamadas() {
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const sim = async () => 's';
const nao = async () => 'n';
function run(args, ask = sim) { return adb.execute('adb', args, { ask }); }

test.beforeEach(() => { reset(); config.saveConfig({ adbPath: WRAP }); });

// ---------------------------------------------------------------------------
// Leitura: não pede confirmação
// ---------------------------------------------------------------------------

test('dispositivos: roda "adb devices -l" sem pedir confirmação', async () => {
  const out = await run({ acao: 'dispositivos' }, async () => { throw new Error('não devia perguntar'); });
  assert.match(out, /device/);
  assert.deepEqual(chamadas(), [['devices', '-l']]);
});

test('info: lê getprop e resume marca/modelo/Android', async () => {
  const out = await run({ acao: 'info' });
  assert.match(out, /marca: Sony/);
  assert.match(out, /modelo: BRAVIA/);
  assert.match(out, /Android: 11 \(API 30\)/);
  assert.match(out, /tipo: tv/);
});

test('apps: lista só os de usuário (pm list packages -3), ordenados', async () => {
  const out = await run({ acao: 'apps' });
  assert.match(out, /com\.netflix\.ninja/);
  assert.match(out, /com\.spotify\.tv\.android/);
  assert.deepEqual(chamadas()[0], ['shell', 'pm', 'list', 'packages', '-3']);
});

test('tela: salva o PNG que o aparelho devolveu', async () => {
  const destino = path.join(DIR, 'print.png');
  const out = await run({ acao: 'tela', arquivo: destino });
  assert.match(out, /Print salvo/);
  assert.ok(fs.existsSync(destino));
  assert.deepEqual([...fs.readFileSync(destino).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(chamadas()[0], ['exec-out', 'screencap', '-p']);
});

// ---------------------------------------------------------------------------
// Alvo (-s) e validação
// ---------------------------------------------------------------------------

test('o aparelho padrão (adbSerial) entra como -s; alvo da chamada tem prioridade', async () => {
  config.saveConfig({ adbSerial: 'ABC123' });
  await run({ acao: 'apps' });
  assert.deepEqual(chamadas()[0].slice(0, 2), ['-s', 'ABC123']);
  fs.writeFileSync(LOG, '');
  await run({ acao: 'apps', alvo: '192.168.0.9:5555' });
  assert.deepEqual(chamadas()[0].slice(0, 2), ['-s', '192.168.0.9:5555']);
});

test('alvo que parece uma flag (começa com "-") é recusado', async () => {
  const out = await run({ acao: 'apps', alvo: '-rf' });
  assert.match(out, /alvo inválido/);
  assert.equal(chamadas().length, 0, 'o adb nem foi chamado');
});

// ---------------------------------------------------------------------------
// Ações que mudam o aparelho: confirmação
// ---------------------------------------------------------------------------

test('conectar: monta "connect ip:porta" e pede confirmação; "n" cancela e não chama o adb', async () => {
  const cancelado = await run({ acao: 'conectar', alvo: '192.168.0.50' }, nao);
  assert.match(cancelado, /cancelada/);
  assert.equal(chamadas().length, 0);
  const ok = await run({ acao: 'conectar', alvo: '192.168.0.50' }, sim);
  assert.match(ok, /connected to 192\.168\.0\.50:5555/);
  assert.deepEqual(chamadas()[0], ['connect', '192.168.0.50:5555']);
});

test('conectar aceita ip:porta já com porta', async () => {
  await run({ acao: 'conectar', alvo: '10.0.0.4:5600' });
  assert.deepEqual(chamadas()[0], ['connect', '10.0.0.4:5600']);
});

test('tecla: nome amigável vira keyevent KEYCODE_*; desconhecida é recusada', async () => {
  await run({ acao: 'tecla', tecla: 'ok' });
  assert.deepEqual(chamadas()[0], ['shell', 'input', 'keyevent', 'KEYCODE_DPAD_CENTER']);
  const ruim = await run({ acao: 'tecla', tecla: 'xy' });
  assert.match(ruim, /tecla "xy" desconhecida/);
});

test('digitar: espaços viram %s (input text) e o texto vai como UM argumento', async () => {
  await run({ acao: 'digitar', texto: 'oi mundo' });
  assert.deepEqual(chamadas()[0], ['shell', 'input', 'text', 'oi%smundo']);
});

test('abrir_app exige um pacote válido', async () => {
  assert.match(await run({ acao: 'abrir_app', app: 'nao e pacote' }), /informe "app"|com\.exemplo/);
  await run({ acao: 'abrir_app', app: 'com.netflix.ninja' });
  assert.deepEqual(chamadas()[0], ['shell', 'monkey', '-p', 'com.netflix.ninja', '-c', 'android.intent.category.LAUNCHER', '1']);
});

test('config: sem valor lê; com valor grava (settings put) e confirma', async () => {
  await run({ acao: 'config', espaco: 'system', chave: 'screen_brightness' });
  assert.deepEqual(chamadas()[0], ['shell', 'settings', 'get', 'system', 'screen_brightness']);
  fs.writeFileSync(LOG, '');
  const out = await run({ acao: 'config', espaco: 'system', chave: 'screen_brightness', valor: '200' });
  assert.match(out, /screen_brightness = 200/);
  assert.deepEqual(chamadas()[0], ['shell', 'settings', 'put', 'system', 'screen_brightness', '200']);
  assert.match(await run({ acao: 'config', espaco: 'xpto', chave: 'a' }), /system, secure ou global/);
});

test('instalar: .apk inexistente dá erro claro antes de chamar o adb', async () => {
  assert.match(await run({ acao: 'instalar', arquivo: path.join(DIR, 'nao-existe.apk') }), /apk não encontrado/);
  const apk = path.join(DIR, 'app.apk'); fs.writeFileSync(apk, 'PK');
  await run({ acao: 'instalar', arquivo: apk });
  assert.deepEqual(chamadas()[0], ['install', '-r', apk]);
});

// ---------------------------------------------------------------------------
// Confirmação: adbConfirm e regras; ações irreversíveis sempre confirmam
// ---------------------------------------------------------------------------

test('adbConfirm:false dispensa a confirmação de ação comum, mas NÃO de ação irreversível', async () => {
  config.saveConfig({ adbConfirm: false });
  await run({ acao: 'tecla', tecla: 'home' }, async () => { throw new Error('não devia perguntar'); });
  assert.deepEqual(chamadas()[0], ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  // reiniciar é sensível: confirma mesmo com adbConfirm:false
  const cancelado = await run({ acao: 'reiniciar' }, nao);
  assert.match(cancelado, /cancelada/);
  await run({ acao: 'reiniciar' }, sim);
  assert.deepEqual(chamadas().at(-1), ['reboot']);
});

test('regra "permitir" dispensa a confirmação da ação que ela cobre', async () => {
  config.saveConfig({ permissoes: { permitir: ['adb'], negar: [] } });
  await run({ acao: 'fechar_app', app: 'com.netflix.ninja' }, async () => { throw new Error('não devia perguntar'); });
  assert.deepEqual(chamadas()[0], ['shell', 'am', 'force-stop', 'com.netflix.ninja']);
});

test('shell: comando comum confirma e vai como UM argumento para "adb shell"', async () => {
  await run({ acao: 'shell', comando: 'getprop ro.product.model' }, sim);
  assert.deepEqual(chamadas()[0], ['shell', 'getprop ro.product.model']);
});

test('shell destrutivo confirma mesmo com adbConfirm:false', async () => {
  config.saveConfig({ adbConfirm: false });
  const cancelado = await run({ acao: 'shell', comando: 'rm -rf /sdcard/DCIM' }, nao);
  assert.match(cancelado, /cancelada/);
  assert.equal(chamadas().length, 0);
});

// ---------------------------------------------------------------------------
// adb ausente / erro do aparelho
// ---------------------------------------------------------------------------

test('adb não instalado: mensagem clara em vez de stack trace', async () => {
  config.saveConfig({ adbPath: path.join(DIR, 'nao-existe-adb') });
  assert.match(await run({ acao: 'dispositivos' }), /adb não encontrado/);
});

test('erro do adb (aparelho offline) vira mensagem, não exceção', async () => {
  const wrapFail = path.join(DIR, 'adb-fail');
  fs.writeFileSync(wrapFail, `#!/bin/sh\nADB_MODE=fail exec "${process.execPath}" "${FAKE}" "$@"\n`);
  fs.chmodSync(wrapFail, 0o755);
  config.saveConfig({ adbPath: wrapFail });
  assert.match(await run({ acao: 'apps' }), /adb falhou.*device offline/s);
});

// ---------------------------------------------------------------------------
// Está registrada como ferramenta nativa
// ---------------------------------------------------------------------------

test('a ferramenta adb está nas declarações e em nomesNativos', async () => {
  const tools = require('../src/tools');
  const nomes = (await tools.getAllDeclarations()).map((d) => d.name);
  assert.ok(nomes.includes('adb'));
  assert.ok(tools.nomesNativos().includes('adb'));
});
