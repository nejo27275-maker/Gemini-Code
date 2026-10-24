'use strict';
// v0.43.x: ferramenta adb (src/tools/adbTools.js), sem aparelho nem adb de verdade.
//
// O `adb` FALSO imita o real onde importa para a segurança: em `adb shell a b c` ele JUNTA os argumentos
// com espaço, sem escapar (como o adb real e o ssh), e roda o resultado num /bin/sh cujo PATH só tem
// comandos falsos do "aparelho" (input, reboot, settings, pm...). Cada comando falso registra o que
// recebeu em DEVICE_LOG. Assim os testes veem exatamente o que a TV executaria — inclusive uma injeção.
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

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adb-fake-'));
const LOG = path.join(DIR, 'chamadas.log'); // argv que o adb recebeu nesta máquina
const DEVICE_LOG = path.join(DIR, 'aparelho.log'); // comandos que o "aparelho" executou
const STUBS = path.join(DIR, 'aparelho-bin');
fs.mkdirSync(STUBS);

const FAKE = path.join(DIR, 'adb-fake.js');
fs.writeFileSync(FAKE, `
const fs = require('fs');
const cp = require('child_process');
let a = process.argv.slice(2);
fs.appendFileSync(process.env.ADB_LOG, JSON.stringify(a) + '\\n');
if (process.env.ADB_MODE === 'fail') { process.stderr.write('device offline\\n'); process.exit(1); }
if (a[0] === '-s') a = a.slice(2);
if (a[0] === 'devices') { process.stdout.write('List of devices attached\\nABC123\\tdevice\\n'); process.exit(0); }
if (a[0] === 'connect') { process.stdout.write('connected to ' + a[1] + '\\n'); process.exit(0); }
if (a[0] === 'pair') { process.stdout.write(a[2] === '123456' ? 'Successfully paired to ' + a[1] + ' [guid=adb-X]\\n' : 'Failed: Wrong password or connection was dropped.\\n'); process.exit(0); }
if (a[0] === 'mdns') { process.stdout.write('List of discovered mdns services\\nadb-SALA-abc\\t_adb-tls-pairing._tcp\\t192.168.0.50:37099\\nadb-SALA-abc\\t_adb-tls-connect._tcp\\t192.168.0.50:41235\\n'); process.exit(0); }
if (a[0] === 'exec-out') { process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])); process.exit(0); }
if (a[0] === 'shell') {
  const comando = a.slice(1).join(' '); // como o adb real: junta SEM escapar
  const r = cp.spawnSync('/bin/sh', ['-c', comando], { env: { PATH: process.env.ADB_STUBS, LOG: process.env.ADB_DEVICE_LOG }, encoding: 'utf8' });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  process.exit(r.status === null ? 1 : r.status);
}
process.stdout.write('ok\\n');
`);
const WRAP = path.join(DIR, 'adb');
fs.writeFileSync(WRAP, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
fs.chmodSync(WRAP, 0o755);
const WRAP_FALHA = path.join(DIR, 'adb-falha');
fs.writeFileSync(WRAP_FALHA, `#!/bin/sh\nADB_MODE=fail exec "${process.execPath}" "${FAKE}" "$@"\n`);
fs.chmodSync(WRAP_FALHA, 0o755);

// Comandos falsos do aparelho: registram nome + argumentos (separados por TAB) e respondem o básico.
const REGISTRA = 'printf \'%s\' "${0##*/}" >> "$LOG"; for x in "$@"; do printf \'\\t%s\' "$x" >> "$LOG"; done; printf \'\\n\' >> "$LOG"';
const stubs = {
  input: '', reboot: '', settings: '', am: '', rm: '',
  getprop: 'printf \'[ro.product.brand]: [Sony]\\n[ro.product.model]: [BRAVIA]\\n[ro.build.version.release]: [11]\\n[ro.build.version.sdk]: [30]\\n[ro.build.characteristics]: [tv]\\n\'',
  pm: 'if [ "$1" = list ]; then printf \'package:com.spotify.tv.android\\npackage:com.netflix.ninja\\n\'; fi',
  monkey: 'if [ "$2" = com.nao.existe ]; then printf \'** No activities found to run, monkey aborted.\\n\'; else printf \'Events injected: 1\\n\'; fi',
  dumpsys: 'printf \'  mResumedActivity: ActivityRecord{1a2b u0 com.netflix.ninja/.MainActivity t12}\\n\'',
};
for (const [nome, resposta] of Object.entries(stubs)) {
  fs.writeFileSync(path.join(STUBS, nome), `#!/bin/sh\n${REGISTRA}\n${resposta}\n`);
  fs.chmodSync(path.join(STUBS, nome), 0o755);
}
process.env.ADB_LOG = LOG;
process.env.ADB_DEVICE_LOG = DEVICE_LOG;
process.env.ADB_STUBS = STUBS;

const ler = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').split('\n').filter(Boolean) : []);
const chamadas = () => ler(LOG).map((l) => JSON.parse(l));
const noAparelho = () => ler(DEVICE_LOG).map((l) => l.split('\t'));
const sim = async () => 's';
const nao = async () => 'n';
const proibido = async () => { throw new Error('não devia perguntar'); };
const run = (args, ask = sim) => adb.execute('adb', args, { ask });

test.beforeEach(() => {
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(DEVICE_LOG, '');
  config.saveConfig({ adbPath: WRAP, adbSerial: '', adbPorta: 5555, adbConfirm: true, permissoes: { permitir: [], negar: [] } });
});

// ---------------------------------------------------------------------------
// Injeção no shell do aparelho (o adb junta os argumentos sem escapar)
// ---------------------------------------------------------------------------

test('digitar: ; $() crases e aspas chegam LITERAIS no "input text" — nada roda no aparelho', async () => {
  for (const texto of ['a;reboot', 'x$(reboot)y', 'x`reboot`y', "it's && reboot", 'a|rm -rf /sdcard']) {
    fs.writeFileSync(DEVICE_LOG, '');
    await run({ acao: 'digitar', texto });
    assert.deepEqual(noAparelho(), [['input', 'text', texto.replace(/ /g, '%s')]], `texto: ${texto}`);
  }
});

test('config: o valor também chega literal (antes "1; reboot" reiniciava a TV)', async () => {
  await run({ acao: 'config', espaco: 'system', chave: 'screen_brightness', valor: '1; reboot' });
  assert.deepEqual(noAparelho(), [['settings', 'put', 'system', 'screen_brightness', '1; reboot']]);
});

test('o shell LIVRE continua interpretando (é a função dele), mas sempre pede confirmação', async () => {
  config.saveConfig({ adbConfirm: false, permissoes: { permitir: ['adb'], negar: [] } });
  assert.match(await run({ acao: 'shell', comando: 'reboot' }, nao), /cancelada/);
  assert.deepEqual(noAparelho(), [], 'cancelado: nada rodou');
  await run({ acao: 'shell', comando: 'reboot' }, sim);
  assert.deepEqual(noAparelho(), [['reboot']]);
});

// ---------------------------------------------------------------------------
// Leitura: não pede confirmação
// ---------------------------------------------------------------------------

test('dispositivos, info, apps e estado leem sem pedir confirmação', async () => {
  assert.match(await run({ acao: 'dispositivos' }, proibido), /ABC123\tdevice/);
  assert.deepEqual(chamadas()[0], ['devices', '-l']);
  const info = await run({ acao: 'info' }, proibido);
  assert.match(info, /marca: Sony/);
  assert.match(info, /modelo: BRAVIA/);
  assert.match(info, /Android: 11 \(API 30\)/);
  assert.match(info, /tipo: tv/);
  const apps = await run({ acao: 'apps' }, proibido);
  assert.match(apps, /Apps instalados pelo usuário \(2\):\ncom\.netflix\.ninja\ncom\.spotify\.tv\.android/, 'ordenados');
  assert.match(await run({ acao: 'estado' }, proibido), /App em foco agora: com\.netflix\.ninja\/\.MainActivity/);
});

test('tela: salva só um .png NOVO, fora das áreas protegidas', async () => {
  const destino = path.join(DIR, 'print.png');
  assert.match(await run({ acao: 'tela', arquivo: destino }, proibido), /Print salvo/);
  assert.deepEqual([...fs.readFileSync(destino).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.match(await run({ acao: 'tela', arquivo: destino }), /já existe/, 'não sobrescreve');
  const fonte = path.join(DIR, 'codigo.js');
  fs.writeFileSync(fonte, 'importante');
  assert.match(await run({ acao: 'tela', arquivo: fonte }), /arquivo \.png/);
  assert.equal(fs.readFileSync(fonte, 'utf8'), 'importante');
  assert.match(await run({ acao: 'tela', arquivo: path.join(config.ALIADOS_DIR, 'x', 'tela.png') }), /protegido/);
});

// ---------------------------------------------------------------------------
// Alvo (-s), porta e validação
// ---------------------------------------------------------------------------

test('aparelho padrão (adbSerial) vira -s; o alvo da chamada tem prioridade; alvo com cara de flag é recusado', async () => {
  config.saveConfig({ adbSerial: 'ABC123' });
  await run({ acao: 'apps' });
  assert.deepEqual(chamadas()[0].slice(0, 2), ['-s', 'ABC123']);
  fs.writeFileSync(LOG, '');
  await run({ acao: 'apps', alvo: '192.168.0.9:5555' });
  assert.deepEqual(chamadas()[0].slice(0, 2), ['-s', '192.168.0.9:5555']);
  fs.writeFileSync(LOG, '');
  assert.match(await run({ acao: 'apps', alvo: '-rf' }), /alvo inválido/);
  assert.equal(chamadas().length, 0, 'o adb nem foi chamado');
});

test('conectar: "ip" ganha a porta padrão; porta inválida é recusada; "n" cancela sem chamar o adb', async () => {
  assert.match(await run({ acao: 'conectar', alvo: '192.168.0.50' }, nao), /cancelada/);
  assert.equal(chamadas().length, 0);
  assert.match(await run({ acao: 'conectar', alvo: '192.168.0.50' }), /connected to 192\.168\.0\.50:5555/);
  await run({ acao: 'conectar', alvo: '10.0.0.4:5600' });
  assert.deepEqual(chamadas().at(-1), ['connect', '10.0.0.4:5600']);
  assert.match(await run({ acao: 'conectar', alvo: '10.0.0.4:99999' }), /porta inválida/);
  assert.match(await run({ acao: 'tcpip', porta: 'abc' }), /porta inválida/);
  assert.match(await run({ acao: 'voar' }), /ação de adb desconhecida/);
});

test('descobrir (leitura) lista aparelhos anunciando depuração por Wi-Fi e diz o próximo passo', async () => {
  const out = await run({ acao: 'descobrir' }, proibido);
  assert.match(out, /192\.168\.0\.50:37099 {2}adb-SALA-abc {2}\(pareamento: use acao:"parear"/);
  assert.match(out, /192\.168\.0\.50:41235 {2}adb-SALA-abc {2}\(pronto para acao:"conectar"\)/);
  assert.deepEqual(chamadas()[0], ['mdns', 'services']);
});

test('parear (Android 11+): exige ip:porta de pareamento e código de 6 dígitos; confirma; código errado aparece', async () => {
  assert.match(await run({ acao: 'parear', alvo: '192.168.0.50:37099', codigo: '12345' }), /6 dígitos/);
  assert.match(await run({ acao: 'parear', alvo: '192.168.0.50', codigo: '123456' }), /ip:porta DE PAREAMENTO/);
  assert.equal(chamadas().length, 0);
  assert.match(await run({ acao: 'parear', alvo: '192.168.0.50:37099', codigo: '123456' }, nao), /cancelada/);
  const ok = await run({ acao: 'parear', alvo: '192.168.0.50:37099', codigo: '123456' });
  assert.match(ok, /Successfully paired[\s\S]*Agora conecte/);
  assert.deepEqual(chamadas().at(-1), ['pair', '192.168.0.50:37099', '123456']);
  assert.match(await run({ acao: 'parear', alvo: '192.168.0.50:37099', codigo: '654321' }), /Wrong password/);
});

// ---------------------------------------------------------------------------
// Ações comuns
// ---------------------------------------------------------------------------

test('tecla: nome amigável vira KEYCODE_*; desconhecida é recusada', async () => {
  await run({ acao: 'tecla', tecla: 'ok' });
  await run({ acao: 'tecla', tecla: 'KEYCODE_HOME' });
  assert.deepEqual(noAparelho(), [['input', 'keyevent', 'KEYCODE_DPAD_CENTER'], ['input', 'keyevent', 'KEYCODE_HOME']]);
  assert.match(await run({ acao: 'tecla', tecla: 'xy;reboot' }), /desconhecida/);
});

test('abrir_app: valida o pacote e avisa quando o app não existe (o monkey sai com 0 mesmo assim)', async () => {
  assert.match(await run({ acao: 'abrir_app', app: 'nao e pacote' }), /informe "app"/);
  assert.match(await run({ acao: 'abrir_app', app: 'com.netflix.ninja' }), /iniciado/);
  assert.deepEqual(noAparelho()[0], ['monkey', '-p', 'com.netflix.ninja', '-c', 'android.intent.category.LAUNCHER', '1']);
  assert.match(await run({ acao: 'abrir_app', app: 'com.nao.existe' }), /não consegui abrir/);
});

test('config: sem valor lê; com valor grava; espaço e chave são validados', async () => {
  await run({ acao: 'config', espaco: 'system', chave: 'screen_brightness' });
  assert.match(await run({ acao: 'config', espaco: 'system', chave: 'screen_brightness', valor: '200' }), /= 200/);
  assert.deepEqual(noAparelho(), [['settings', 'get', 'system', 'screen_brightness'], ['settings', 'put', 'system', 'screen_brightness', '200']]);
  assert.match(await run({ acao: 'config', espaco: 'xpto', chave: 'a' }), /system, secure ou global/);
  assert.match(await run({ acao: 'config', espaco: 'system', chave: 'a b' }), /chave/);
});

test('instalar: exige um .apk que exista', async () => {
  assert.match(await run({ acao: 'instalar', arquivo: path.join(DIR, 'nao-existe.apk') }), /não encontrado/);
  assert.match(await run({ acao: 'instalar', arquivo: FAKE }), /\.apk/);
  const apk = path.join(DIR, 'app.apk');
  fs.writeFileSync(apk, 'PK');
  await run({ acao: 'instalar', arquivo: apk });
  assert.deepEqual(chamadas().at(-1), ['install', '-r', apk]);
});

// ---------------------------------------------------------------------------
// Confirmação
// ---------------------------------------------------------------------------

test('adbConfirm:false e "permitir" dispensam a confirmação de ação comum', async () => {
  config.saveConfig({ adbConfirm: false });
  await run({ acao: 'tecla', tecla: 'home' }, proibido);
  config.saveConfig({ adbConfirm: true, permissoes: { permitir: ['adb'], negar: [] } });
  await run({ acao: 'fechar_app', app: 'com.netflix.ninja' }, proibido);
  assert.deepEqual(noAparelho(), [['input', 'keyevent', 'KEYCODE_HOME'], ['am', 'force-stop', 'com.netflix.ninja']]);
});

test('reiniciar, desinstalar, limpar e gravar em secure/global confirmam SEMPRE', async () => {
  config.saveConfig({ adbConfirm: false, permissoes: { permitir: ['adb'], negar: [] } });
  for (const args of [
    { acao: 'reiniciar' },
    { acao: 'desinstalar', app: 'com.netflix.ninja' },
    { acao: 'limpar', app: 'com.netflix.ninja' },
    { acao: 'config', espaco: 'global', chave: 'package_verifier_enable', valor: '0' },
  ]) {
    assert.match(await run(args, nao), /cancelada/, JSON.stringify(args));
  }
  assert.equal(chamadas().length, 0, 'nada chegou ao adb');
  // Ler secure/global e gravar em system seguem a regra comum.
  await run({ acao: 'config', espaco: 'global', chave: 'adb_enabled' }, proibido);
  await run({ acao: 'config', espaco: 'system', chave: 'screen_brightness', valor: '9' }, proibido);
});

test('a pergunta mostra o texto sem o terminal interpretar \\r, ESC ou caracteres que invertem o texto', async () => {
  let pergunta = '';
  await run({ acao: 'digitar', texto: 'oi\r\u001b[2Ktudo certo\u202Egnp' }, async (q) => { pergunta = q; return 'n'; });
  // eslint-disable-next-line no-control-regex -- procurar ESC na pergunta \u00e9 o objetivo do teste
  assert.ok(!/[\r\u001b\u202e]/.test(pergunta), JSON.stringify(pergunta));
  assert.match(pergunta, /\\x0D\\x1B\[2Ktudo certo<U\+202E>gnp/);
});

// ---------------------------------------------------------------------------
// Erros e registro
// ---------------------------------------------------------------------------

test('adb ausente e aparelho offline viram mensagens claras', async () => {
  config.saveConfig({ adbPath: path.join(DIR, 'nao-existe-adb') });
  assert.match(await run({ acao: 'dispositivos' }), /adb não encontrado/);
  config.saveConfig({ adbPath: WRAP_FALHA });
  assert.match(await run({ acao: 'apps' }), /adb falhou.*device offline/s);
});

test('a ferramenta adb está nas declarações e em nomesNativos', async () => {
  const tools = require('../src/tools');
  assert.ok((await tools.getAllDeclarations([])).length === 0);
  assert.ok((await tools.getAllDeclarations(['adb'])).some((d) => d.name === 'adb'));
  assert.ok(tools.nomesNativos().includes('adb'));
});

test('doctor mostra se o adb foi encontrado (pelo adbPath do config) e se o cowork tem o pacote ws', () => {
  const { spawnSync } = require('child_process');
  const doctor = () => JSON.parse(spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gemini-code.js'), 'doctor'], {
    encoding: 'utf8', env: { ...process.env, HOME: HOME_FALSO, USERPROFILE: HOME_FALSO }, timeout: 20000,
  }).stdout);
  config.saveConfig({ adbSerial: '192.168.0.50:5555' });
  const r = doctor();
  assert.deepEqual(r.adb, { encontrado: true, caminho: WRAP, aparelhoPadrao: '192.168.0.50:5555', confirmar: true });
  assert.equal(typeof r.cowork.ws, 'boolean');
  config.saveConfig({ adbPath: path.join(DIR, 'nao-existe-adb') });
  assert.equal(doctor().adb.encontrado, false);
});
