'use strict';
// v0.41.0: imagem como entrada do agente (/imagem, /foto, run --imagem) e saída estruturada (run --json).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-imagens-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const imagens = require('../src/imagens');
const { converterHistorico } = require('../src/providers/llamacpp');
const { parseRunArgs } = require('../src/agentProfiles');
const { runOnce } = require('../src/agent');
const config = require('../src/config');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'); // cabeçalho PNG mínimo
const arquivo = (nome, conteudo = PNG) => { const p = path.join(HOME_FALSO, nome); fs.writeFileSync(p, conteudo); return p; };

test('lerImagem: tipos aceitos, erros claros e segredo recusado', () => {
  const ok = imagens.lerImagem(arquivo('tela.png'));
  assert.equal(ok.inlineData.mimeType, 'image/png');
  assert.equal(Buffer.from(ok.inlineData.data, 'base64').equals(PNG), true);
  assert.equal(imagens.lerImagem(arquivo('foto.JPG')).inlineData.mimeType, 'image/jpeg');
  assert.throws(() => imagens.lerImagem(arquivo('doc.pdf')), /Formato não suportado/);
  assert.throws(() => imagens.lerImagem(path.join(HOME_FALSO, 'nao-existe.png')), /não encontrada/);
  assert.throws(() => imagens.lerImagem(arquivo('vazia.png', Buffer.alloc(0))), /vazia/);
  const grande = arquivo('grande.png');
  fs.truncateSync(grande, imagens.MAX_BYTES + 1);
  assert.throws(() => imagens.lerImagem(grande), /grande demais/);
  config.loadConfig();
  const link = path.join(HOME_FALSO, 'config.png');
  if (process.platform !== 'win32') {
    fs.symlinkSync(config.CONFIG_PATH, link);
    assert.throws(() => imagens.lerImagem(link), /segredos/);
  }
});

test('loop do agente: a imagem vai na mensagem e depois vira marcador no histórico', async () => {
  const img = imagens.lerImagem(arquivo('erro.png'));
  let enviado = null;
  const modelo = async ({ history }) => { enviado = JSON.parse(JSON.stringify(history)); return { functionCalls: () => [], text: () => 'vi o erro', rawParts: () => [] }; };
  const r = await runOnce('o que é este erro?', { imagens: [img], deps: { chatWithTools: modelo, buildSystemInstruction: () => '', loadConfig: () => ({}) } });
  const ultima = enviado[enviado.length - 1];
  assert.deepEqual(ultima.parts[0], { inlineData: img.inlineData });
  assert.equal(ultima.parts[1].text, 'o que é este erro?');
  assert.equal(r.text, 'vi o erro');
  assert.equal(JSON.stringify(r.history).includes(img.inlineData.data), false, 'o base64 não fica no histórico');
  assert.match(r.history[0].parts[0].text, /\[imagem image\/png enviada/);
});

test('conversão OpenAI: image_url com data URL; llama.cpp local avisa em vez de sumir', () => {
  const h = [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }, { text: 'veja' }] }];
  const comImagem = converterHistorico(h, '', { imagens: true });
  assert.deepEqual(comImagem[0].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }, { type: 'text', text: 'veja' }]);
  const local = converterHistorico(h, '');
  assert.match(local[0].content, /^\[1 imagem\(ns\) omitida\(s\): o modelo local não recebe imagens\]\nveja$/);
});

test('parseRunArgs: --json e --imagem repetível', () => {
  const p = parseRunArgs(['--json', '--imagem', 'a.png', '--image', 'b.jpg', 'explique', 'isto']);
  assert.equal(p.json, true);
  assert.deepEqual(p.imagens, ['a.png', 'b.jpg']);
  assert.equal(p.instruction, 'explique isto');
  assert.throws(() => parseRunArgs(['--imagem']), /arquivo da imagem/);
});

// CLI de verdade: o stdout precisa ser SÓ o JSON (logs vão para o stderr).
function cli(args, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-cli-json-'));
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gemini-code.js'), ...args], {
    cwd: home, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home, USERPROFILE: home, GEMINI_API_KEY: '', ...env },
  });
}

test('run --json: sucesso devolve um único JSON no stdout', () => {
  const r = cli(['run', '--json', 'como ler um arquivo em node'], { GEMINI_CODE_SOLO: '1' });
  assert.equal(r.status, 0, r.stderr);
  const saida = JSON.parse(r.stdout);
  assert.equal(saida.ok, true);
  assert.equal(typeof saida.texto, 'string');
  assert.ok(saida.texto.length > 0);
  assert.equal(saida.perfil, 'coder');
  assert.match(saida.artefato, /^art_/);
  assert.equal(r.stdout.trim().split('\n').length, 1, 'nada além do JSON no stdout');
});

test('run --json: erro também sai como JSON, com código 1', () => {
  const r = cli(['run', '--json', '--imagem', 'nao-existe.png', 'descreva']);
  assert.equal(r.status, 1);
  const saida = JSON.parse(r.stdout);
  assert.equal(saida.ok, false);
  assert.match(saida.erro, /não encontrada/);
});
