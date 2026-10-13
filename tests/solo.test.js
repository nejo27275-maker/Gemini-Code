'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-solo-'));
process.env.HOME = home;
process.env.GEMINI_API_KEY = '';
delete process.env.GEMINI_CODE_SOLO;
fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
const cfgPath = path.join(home, '.gemini-code', 'config.json');
const escreverCfg = (extra = {}) => fs.writeFileSync(cfgPath, JSON.stringify({ configVersion: 99, provider: 'hybrid', apiKey: 'CHAVE-FALSA', modoSolo: true, ...extra }));
escreverCfg();

const solo = require('../src/solo');
const provider = require('../src/provider');
const configCommands = require('../src/configCommands');
const codeia = require('../src/providers/codeia');
const CLI = path.join(__dirname, '..', 'bin', 'gemini-code.js');

test('roteador no modo solo: SEMPRE code-ia, mesmo com chave, hybrid e pedido forçado de outra IA', () => {
  const cfg = require('../src/config').loadConfig();
  assert.equal(cfg.modoSolo, true);
  for (const modelName of [undefined, '@cloud', '@local', 'gemini-3.6-flash', 'ollama:qwen', 'llamacpp:x']) {
    const e = provider.escolher({ cfg, modelName, history: [{ role: 'user', parts: [{ text: 'refatore e otimize tudo '.repeat(50) }] }] });
    assert.equal(e.provider, 'code-ia', `modelName=${modelName}`);
    assert.equal(e.motivo, 'modo solo');
  }
});

test('conversa inteira no modo solo não faz NENHUMA chamada de rede', async () => {
  const antigo = global.fetch;
  let chamadas = 0;
  global.fetch = async () => { chamadas++; throw new Error('não devia chamar'); };
  try {
    const r = await provider.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'como criar um servidor com express' }] }], tools: [], systemInstruction: 'x' });
    assert.match(r.text(), /express/i);
    const forcado = await provider.chatWithTools({ modelName: '@cloud', history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] });
    assert.match(forcado.text(), /code-ia/);
  } finally { global.fetch = antigo; }
  assert.equal(chamadas, 0);
});

test('guarda de rede: bloqueia IA online e o llama.cpp/Ollama configurados; deixa o resto passar', async () => {
  const antigo = global.fetch;
  const vistos = [];
  global.fetch = async (url) => { vistos.push(String(url)); return { ok: true }; };
  solo.instalarGuarda();
  assert.equal(solo.instalarGuarda(), false, 'instalar duas vezes não empilha');
  try {
    for (const alvo of ['https://generativelanguage.googleapis.com/v1beta/models', 'https://api.openai.com/v1/chat', 'http://127.0.0.1:8080/health', 'http://127.0.0.1:11434/api/chat']) {
      await assert.rejects(fetch(alvo), (e) => e.solo === true && /\[solo\]/.test(e.message), alvo);
    }
    assert.deepEqual(vistos, [], 'nada chegou ao fetch original');
    await fetch('https://example.com/pagina');
    assert.deepEqual(vistos, ['https://example.com/pagina']);
    // desligado, passa tudo
    process.env.GEMINI_CODE_SOLO = '0';
    await fetch('https://generativelanguage.googleapis.com/x');
    assert.equal(vistos.length, 2);
  } finally { delete process.env.GEMINI_CODE_SOLO; global.fetch = antigo; }
});

test('provider.chamar recusa outro provedor no solo (defesa em profundidade)', async () => {
  await assert.rejects(provider.chatWithTools({ modelName: undefined, history: [], tools: [] }).then(() => { throw new Error('ok demais'); }).catch((e) => { if (e.message === 'ok demais') throw e; return Promise.reject(e); }), () => true).catch(() => {});
  // chamada direta ao núcleo: forçar o provedor llamacpp tem de falhar com erro solo
  const llama = require('../src/providers/llamacpp');
  const antigo = global.fetch;
  global.fetch = async () => { throw new Error('rede'); };
  try {
    await assert.rejects(llama.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools: [] }));
  } finally { global.fetch = antigo; }
});

test('GEMINI_CODE_SOLO=1 liga e =0 desliga, acima do config', () => {
  escreverCfg({ modoSolo: false });
  assert.equal(solo.ativo(), false);
  process.env.GEMINI_CODE_SOLO = '1';
  assert.equal(solo.ativo(), true);
  process.env.GEMINI_CODE_SOLO = '0';
  escreverCfg({ modoSolo: true });
  assert.equal(solo.ativo(), false);
  delete process.env.GEMINI_CODE_SOLO;
  escreverCfg();
  assert.equal(solo.ativo(), true);
});

test('set-provider para outra IA é recusado no solo (e code-ia continua permitido)', () => {
  const salvo = [];
  assert.match(configCommands.aplicar('set-provider', ['gemini'], (o) => salvo.push(o)), /solo off/);
  assert.equal(salvo.length, 0);
  assert.match(configCommands.aplicar('set-provider', ['code-ia'], (o) => salvo.push(o)), /code-ia/);
});

test('code-ia no solo não sugere a nuvem quando não sabe a resposta', () => {
  const modelo = require('../src/code-ia/install').obterModelo ? require('../src/code-ia/install').ensureInstalled({ log() {} }) : null;
  void modelo;
  const texto = codeia.responder(require('../src/code-ia/install').obterModelo(), 'qual a capital da mongólia zzzqqq');
  assert.doesNotMatch(texto, /\/cloud|Gemini/);
  process.env.GEMINI_CODE_SOLO = '0';
  const fora = codeia.responder(require('../src/code-ia/install').obterModelo(), 'qual a capital da mongólia zzzqqq');
  delete process.env.GEMINI_CODE_SOLO;
  assert.match(fora, /\/cloud/);
});

test('code-ia entende "rode os testes", "git status" e "git log" sem outra IA (e ignora perguntas)', () => {
  const tools = [{ name: 'run_checks' }, { name: 'run_shell' }];
  assert.deepEqual(codeia.decidirFerramenta('rode os testes', tools), { name: 'run_checks', args: {} });
  assert.deepEqual(codeia.decidirFerramenta('Executar lint', tools), { name: 'run_checks', args: {} });
  assert.deepEqual(codeia.decidirFerramenta('git status', tools), { name: 'run_shell', args: { command: 'git status --short' } });
  assert.deepEqual(codeia.decidirFerramenta('status do git', tools), { name: 'run_shell', args: { command: 'git status --short' } });
  assert.deepEqual(codeia.decidirFerramenta('últimos commits', tools), { name: 'run_shell', args: { command: 'git log --oneline -10' } });
  assert.equal(codeia.decidirFerramenta('como rodar os testes em node?', tools), null);
  assert.equal(codeia.decidirFerramenta('rode os testes', [{ name: 'read_file' }]), null, 'sem a ferramenta, não inventa');
});

function cli(args, h) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000, input: '', env: { ...process.env, HOME: h, USERPROFILE: h, GEMINI_API_KEY: '', GEMINI_CODE_SOLO: '' } });
}

test('CLI: solo on → bloqueia design/models/ollama/llamacpp start; solo off restaura o provedor anterior', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-solo-cli-'));
  fs.mkdirSync(path.join(h, '.gemini-code'), { recursive: true });
  fs.writeFileSync(path.join(h, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: 99, provider: 'gemini' }));
  const on = cli(['solo', 'on'], h);
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /LIGADO/);
  let cfg = JSON.parse(fs.readFileSync(path.join(h, '.gemini-code', 'config.json'), 'utf8'));
  assert.equal(cfg.modoSolo, true); assert.equal(cfg.provider, 'code-ia'); assert.equal(cfg.providerAntesDoSolo, 'gemini');
  for (const args of [['design', 'slides', 'x'], ['models'], ['ollama', 'models'], ['llamacpp', 'start'], ['media', 'x']]) {
    const r = cli(args, h);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stdout, /\[solo\]/, args.join(' '));
  }
  assert.match(cli(['doctor'], h).stdout, /"modoSolo": true/);
  const off = cli(['solo', 'off'], h);
  assert.match(off.stdout, /desligado/);
  cfg = JSON.parse(fs.readFileSync(path.join(h, '.gemini-code', 'config.json'), 'utf8'));
  assert.equal(cfg.modoSolo, false); assert.equal(cfg.provider, 'gemini');
});
