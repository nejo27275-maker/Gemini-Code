'use strict';
// v0.49.3: a pasta do usuário vem de pastaDoUsuario() (src/config.js) em TODO lugar. Com HOME vazio, o os.homedir()
// devolve '' — que o path.resolve trata como a PASTA ATUAL. Aqui o HOME fica vazio dentro do teste e a pastaDoUsuario()
// aponta para uma pasta temporária: nada de verdade do usuário é tocado (nem quando o teste roda no código antigo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-pasta-usuario-'));
process.env.HOME = path.join(BASE, 'config-dos-testes');
process.env.USERPROFILE = process.env.HOME;
fs.mkdirSync(path.join(process.env.HOME, '.gemini-code'), { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');

const CASA = fs.realpathSync(fs.mkdtempSync(path.join(BASE, 'casa-')));
const OUTRA = fs.realpathSync(fs.mkdtempSync(path.join(BASE, 'outra-pasta-')));
// a temporária do sistema sempre conta como área liberada: durante o teste ela é outra pasta, para a CASA (que está
// dentro do /tmp de verdade) valer como pasta do usuário
const TMP_FALSO = fs.realpathSync(fs.mkdtempSync(path.join(BASE, 'tmp-')));
const original = config.pastaDoUsuario;
const homeOriginal = process.env.HOME;
const tmpOriginal = Object.prototype.hasOwnProperty.call(process.env, 'TMPDIR') ? process.env.TMPDIR : undefined;
let cwdOriginal;

test.beforeEach(() => {
  config.pastaDoUsuario = () => CASA; // a "pasta do usuário de verdade" deste teste
  process.env.HOME = ''; // o caso do problema: os.homedir() devolve ''
  process.env.TMPDIR = TMP_FALSO;
  cwdOriginal = process.cwd();
  process.chdir(OUTRA); // e a pasta atual é outra (onde o código antigo procurava a "home")
});
test.afterEach(() => {
  process.chdir(cwdOriginal);
  process.env.HOME = homeOriginal;
  if (tmpOriginal === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = tmpOriginal;
  config.pastaDoUsuario = original;
});
test.after(() => fs.rmSync(BASE, { recursive: true, force: true }));

test('HOME vazio: liberar a própria pasta do usuário para a sandbox continua proibido', () => {
  const { aplicar } = require('../src/configCommands');
  let gravado = null;
  const r = aplicar('add-pasta-gravavel', [CASA], (cfg) => { gravado = cfg; });
  assert.match(String(r), /contém a sua HOME/);
  assert.equal(gravado, null, 'nada foi gravado na configuração');
  // e "~" é a pasta do usuário de verdade, não a raiz
  const r2 = aplicar('add-pasta-gravavel', ['~'], (cfg) => { gravado = cfg; });
  assert.match(String(r2), /contém a sua HOME/);
});

test('HOME vazio: com o projeto na pasta do usuário, gravar ~/.bashrc continua pedindo confirmação', () => {
  const { foraDaAreaDeTrabalho } = require('../src/tools/protectedPaths');
  fs.writeFileSync(path.join(CASA, '.bashrc'), '');
  assert.equal(foraDaAreaDeTrabalho(path.join(CASA, '.bashrc'), { raiz: CASA }), true, '~/.bashrc conta como fora da área');
  assert.equal(foraDaAreaDeTrabalho(path.join(CASA, 'projeto', 'a.txt'), { raiz: CASA }), false, 'arquivo comum do projeto, não');
});

test('HOME vazio: checkpoint da pasta do usuário inteira continua recusado, e o do projeto atual funciona', () => {
  const { createCheckpoint, CHECKPOINTS_DIR } = require('../src/checkpoints');
  assert.ok(CHECKPOINTS_DIR.startsWith(BASE + path.sep), 'os checkpoints do teste ficam na pasta temporária do teste');
  assert.throws(() => createCheckpoint({ root: CASA, label: 'teste' }), /pasta pessoal inteira não é permitido/);
  // o código antigo comparava com realpathSync('') = a pasta atual, e recusava o checkpoint do próprio projeto
  fs.writeFileSync(path.join(OUTRA, 'a.txt'), 'oi');
  const m = createCheckpoint({ label: 'projeto' }); // raiz padrão: a pasta atual (OUTRA)
  assert.equal(m.root, OUTRA);
  assert.deepEqual(m.files.map((f) => f.path), ['a.txt']);
});
