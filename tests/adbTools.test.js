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

// adb falso compartilhado (tests/fixtures/adbFalso.js): junta os argumentos do `shell` como o real e roda
// num /bin/sh com comandos falsos do aparelho que registram o que receberam.
const { DIR, FAKE, WRAP, WRAP_FALHA, LOG, DEVICE_LOG, chamadas, noAparelho } = require('./fixtures/adbFalso').criarAdbFalso();
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

// ---------------------------------------------------------------------------
// v0.44.1: abrir_link, teclas dormir/acordar e comandos em texto
// ---------------------------------------------------------------------------

test('abrir_link: VIEW do Android com o endereço entre aspas; injeção chega literal; só http/https', async () => {
  const perguntas = [];
  const r = await run({ acao: 'abrir_link', link: 'https://www.youtube.com/watch?v=abc&t=10' }, async (q) => { perguntas.push(q); return 's'; });
  assert.match(r, /Link aberto no aparelho: https:\/\/www\.youtube\.com\/watch\?v=abc&t=10/);
  assert.match(perguntas[0], /abrir o link https:\/\/www\.youtube\.com\/watch\?v=abc&t=10/);
  assert.deepEqual(noAparelho(), [['am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://www.youtube.com/watch?v=abc&t=10']]);

  fs.writeFileSync(DEVICE_LOG, '');
  await run({ acao: 'abrir_link', link: "https://x.com/a';reboot;'", app: 'com.google.android.youtube.tv' });
  const [comando] = noAparelho();
  assert.equal(comando[0], 'am', 'nada além do am rodou (o reboot não)');
  assert.deepEqual(comando.slice(-2), ['-p', 'com.google.android.youtube.tv']);
  assert.ok(comando.includes("https://x.com/a';reboot;'"), JSON.stringify(comando));

  fs.writeFileSync(DEVICE_LOG, '');
  for (const link of ['file:///sdcard/x', 'javascript:alert(1)', 'intent://x#Intent;end', 'https://u:s@x.com/']) {
    assert.match(await run({ acao: 'abrir_link', link }), /^Erro:/, link);
  }
  assert.match(await run({ acao: 'abrir_link', link: 'https://x.com/', app: '-x' }), /"app" inválido/);
  assert.deepEqual(noAparelho(), []);
  assert.match(await run({ acao: 'abrir_link', link: 'https://nao-abre.example/' }), /não abriu o link/);
  assert.equal(await run({ acao: 'abrir_link', link: 'https://x.com/' }, nao), 'Ação de adb cancelada pelo usuário.');
});

test('teclas: dormir/acordar não alternam (power alterna); "liga" acorda', async () => {
  for (const [tecla, codigo] of [['dormir', 'KEYCODE_SLEEP'], ['desligar', 'KEYCODE_SLEEP'], ['acordar', 'KEYCODE_WAKEUP'], ['liga', 'KEYCODE_WAKEUP'], ['power', 'KEYCODE_POWER']]) {
    fs.writeFileSync(DEVICE_LOG, '');
    await run({ acao: 'tecla', tecla });
    assert.deepEqual(noAparelho(), [['input', 'keyevent', codigo]], tecla);
  }
  assert.equal(adb.teclaValida('dormir'), true);
  assert.equal(adb.teclaValida('KEYCODE_TV'), true);
  assert.equal(adb.teclaValida('a;reboot'), false);
});

test('argsDoComando: o terminal e as rotinas leem os comandos do mesmo jeito', () => {
  assert.deepEqual(adb.argsDoComando(['tecla', 'dormir']), { acao: 'tecla', tecla: 'dormir' });
  assert.deepEqual(adb.argsDoComando(['abrir', 'com.netflix.ninja']), { acao: 'abrir_app', app: 'com.netflix.ninja' });
  assert.deepEqual(adb.argsDoComando(['link', 'https://youtu.be/x', 'com.google.android.youtube.tv']), { acao: 'abrir_link', link: 'https://youtu.be/x', app: 'com.google.android.youtube.tv' });
  assert.deepEqual(adb.argsDoComando(['digitar', 'filme', 'de', 'ação']), { acao: 'digitar', texto: 'filme de ação' });
  assert.deepEqual(adb.argsDoComando([]), { acao: 'dispositivos' });
  assert.equal(adb.argsDoComando(['voar']), null);
});

test('regras do adb escritas como o comando: "adb(tecla *)" libera as teclas e só elas (antes nunca batia)', async () => {
  config.saveConfig({ permissoes: { permitir: ['adb(tecla *)', 'adb(abrir_app com.netflix*)'], negar: [] } });
  assert.equal(await run({ acao: 'tecla', tecla: 'ok' }, proibido), 'Tecla ok enviada.');
  assert.equal(await run({ acao: 'abrir_app', app: 'com.netflix.ninja' }, proibido), 'App com.netflix.ninja iniciado.');
  assert.equal(await run({ acao: 'digitar', texto: 'tecla x' }, nao), 'Ação de adb cancelada pelo usuário.', 'digitar não vira "tecla" pelo texto');
  assert.equal(await run({ acao: 'abrir_app', app: 'com.spotify.tv.android' }, nao), 'Ação de adb cancelada pelo usuário.');
  config.saveConfig({ permissoes: { permitir: ['adb(reiniciar*)'], negar: [] } });
  assert.equal(await run({ acao: 'reiniciar' }, nao), 'Ação de adb cancelada pelo usuário.', 'sensível pergunta mesmo com "permitir"');
});
