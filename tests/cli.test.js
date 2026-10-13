// tests/cli.test.js
// bin/gemini-code.js é o ponto de entrada da CLI: interpreta argv e chama
// main() já na carga do arquivo, então testá-lo por require() direto
// rodaria a CLI de verdade dentro do processo de teste. Em vez disso,
// rodamos como um processo filho de verdade (é exatamente como o usuário
// usa) com HOME isolado numa pasta temporária, pra não tocar
// ~/.gemini-code do dono da máquina nem depender do que já está configurado
// lá. Só exercitamos os caminhos que não fazem chamada de rede real
// (help/version/config/skills/usos incompletos) e o tratamento de erro
// quando falta API key ou o arquivo pedido não existe.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'gemini-code.js');
const PACKAGE_JSON = require('../package.json');

function runCli(args, { home, envOverrides = {} } = {}) {
  const homeDir = home || fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cli-test-'));
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir, // caso algum dia rode em Windows
    GEMINI_API_KEY: '',
    // Bug real encontrado (set/2026): os testes "voice listen" e "live"
    // abaixo assumiam que a máquina não teria o Termux:API instalado — falso
    // num Termux real com termux-api de verdade (justamente o ambiente
    // principal deste projeto). Força a mesma condição aqui, igual em
    // voice.test.js, pra esses testes não dependerem de estado do ambiente.
    GEMINI_CODE_FORCE_NO_TERMUX_API: '1',
    ...envOverrides,
  };
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env,
    timeout: 10000,
  });
  return { ...result, homeDir };
}

test('sem argumentos na primeira vez abre o chat sem fingir que a code-ia pequena é um LLM geral', () => {
  const { stdout, status } = runCli([]);
  assert.equal(status, 0);
  assert.doesNotMatch(stdout, /instalando o modelo próprio \(code-ia\)/);
  assert.match(stdout, /modo conversa/);
});

test('sem argumentos com modelo já instalado e API key configurada: mostra a ajuda', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cli-test-'));
  fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: 99, apiKey: 'K' }));
  runCli(['code-ia', 'status'], { home }); // instala
  const { stdout, status } = runCli([], { home });
  assert.equal(status, 0);
  assert.match(stdout, /Uso:/);
  assert.match(stdout, /gemini-code chat/);
  assert.match(stdout, /gemini-code code-ia learn/);
  assert.match(stdout, /gemini-code cowork server/);
});

test('help e --help mostram a mesma ajuda', () => {
  const a = runCli(['help']);
  const b = runCli(['--help']);
  assert.match(a.stdout, /Uso:/);
  assert.match(b.stdout, /Uso:/);
});

test('version, --version e -v mostram a versão do package.json', () => {
  for (const flag of ['version', '--version', '-v']) {
    const { stdout, status } = runCli([flag]);
    assert.equal(status, 0);
    assert.match(stdout, new RegExp(`gemini-code v${PACKAGE_JSON.version.replace(/\./g, '\\.')}`));
  }
});

test('comando desconhecido avisa e mostra a ajuda, sem travar', () => {
  const { stdout, status } = runCli(['isso-nao-existe']);
  assert.equal(status, 0);
  assert.match(stdout, /Comando desconhecido: isso-nao-existe/);
  assert.match(stdout, /Uso:/);
});

test('config show lista a configuração padrão (sem API key ainda)', () => {
  const { stdout, status } = runCli(['config', 'show']);
  assert.equal(status, 0);
  const cfg = JSON.parse(stdout);
  assert.equal(cfg.apiKey, '');
  assert.ok(cfg.model);
});

test('config set-key grava a chave e config show reflete a mudança (mascarada)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cli-test-'));
  const set = runCli(['config', 'set-key', 'MINHA_CHAVE_FALSA'], { home });
  assert.equal(set.status, 0);
  assert.match(set.stdout, /API key salva/);

  // "config show" nunca imprime a chave em texto puro, mesmo a que acabou de
  // ser salva (ver src/security.js:mascarar) — só os últimos 4 caracteres
  // ficam visíveis, o resto vira "*". Isso é intencional (evita vazar a
  // chave num print/screenshot de terminal), então o teste confere o valor
  // mascarado esperado, não a chave original.
  const { stdout } = runCli(['config', 'show'], { home });
  assert.equal(JSON.parse(stdout).apiKey, '*'.repeat('MINHA_CHAVE_FALSA'.length - 4) + 'ALSA');
});

test('config sem subcomando mostra o uso correto', () => {
  const { stdout, status } = runCli(['config']);
  assert.equal(status, 0);
  assert.match(stdout, /Uso: gemini-code config/);
});

test('skills list avisa quando não há nenhuma skill instalada', () => {
  const { stdout, status } = runCli(['skills', 'list']);
  assert.equal(status, 0);
  assert.match(stdout, /Nenhuma skill em/);
});

test('design, media, voice e agent sem subcomando mostram o uso, sem quebrar', () => {
  for (const [args, esperado] of [
    [['design'], /Uso: gemini-code design/],
    [['media'], /Uso: gemini-code media/],
    [['voice'], /Uso: gemini-code voice/],
    [['agent'], /Uso: gemini-code agent run/],
    [['agent', 'run'], /Uso: gemini-code agent run/],
    [['cowork'], /Uso: gemini-code cowork/],
  ]) {
    const { stdout, status } = runCli(args);
    assert.equal(status, 0, `comando "${args.join(' ')}" deveria sair com código 0`);
    assert.match(stdout, esperado, `comando "${args.join(' ')}"`);
  }
});

test('run sem API key usa o LLM local e explica como configurar llama.cpp', () => {
  const { stderr, status } = runCli(['run', 'como ler um arquivo em node'], {
    envOverrides: { LLAMACPP_URL: 'http://127.0.0.1:1' },
  });
  assert.equal(status, 1);
  assert.match(stderr, /\[llama\.cpp\] Não consegui conectar/);
  assert.match(stderr, /start-llama-server\.sh/);
});

test('run sem API key e com codeIaAuto=false falha com uma mensagem clara', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-cli-test-'));
  fs.mkdirSync(path.join(home, '.gemini-code'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini-code', 'config.json'), JSON.stringify({ configVersion: 99, provider: 'gemini', codeIaAuto: false }));
  const { stderr, status } = runCli(['run', 'oi'], { home });
  assert.equal(status, 1);
  assert.match(stderr, /Nenhuma API key configurada/);
});

test('agent run com arquivo inexistente falha com erro claro em vez de travar', () => {
  const { stderr, status } = runCli(['agent', 'run', '/caminho/que/nao/existe.json']);
  assert.equal(status, 1);
  assert.match(stderr, /Erro fatal/);
});

test('voice listen sem Termux:API falha com uma mensagem clara', () => {
  const { stderr, status } = runCli(['voice', 'listen']);
  assert.equal(status, 1);
  assert.match(stderr, /Termux:API/);
});

test('live sem Termux:API falha com uma mensagem clara', () => {
  const { stderr, status } = runCli(['live']);
  assert.equal(status, 1);
  assert.match(stderr, /Termux:API/);
});
