'use strict';
// v0.45.0: write_file/edit_file/edit_files perguntam antes de gravar FORA da pasta do projeto e nunca gravam
// .git/hooks nem .git/config (rodariam comandos fora da sandbox, no próximo git do usuário ou no autoGit).
const fs = require('fs');
const os = require('os');
const path = require('path');

// Fora da pasta temporária do sistema (ela conta como área de trabalho): /var/tmp no Linux e no macOS.
const BASE = fs.mkdtempSync(path.join(fs.existsSync('/var/tmp') ? '/var/tmp' : os.tmpdir(), 'gemini-code-area-'));
const semFora = fs.realpathSync(BASE).startsWith(fs.realpathSync(os.tmpdir()));
const HOME_FALSO = path.join(BASE, 'home');
const PROJETO = path.join(HOME_FALSO, 'projeto');
fs.mkdirSync(PROJETO, { recursive: true });
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;
process.chdir(PROJETO);

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const prompt = require('../src/ui/prompt');
const { arquivoQueRodaNoGit, foraDaAreaDeTrabalho } = require('../src/tools/protectedPaths');
const fileTools = require('../src/tools/fileTools');
const multiEdit = require('../src/tools/multiEditTools');
const askReal = prompt.ask;

// "fora" de verdade: nem no projeto nem na pasta temporária do sistema
const FORA = path.join(HOME_FALSO, 'documentos');
fs.mkdirSync(FORA, { recursive: true });

test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(BASE, { recursive: true, force: true }); });

function respondendo(...respostas) {
  const perguntas = [];
  prompt.ask = async (q) => { perguntas.push(q); return respostas.shift() ?? ''; };
  return perguntas;
}

test('nada dentro do .git (nem o próprio ".git", que pode ser um arquivo "gitdir:")', () => {
  for (const p of ['.git', '.git/config', '.git/hooks/pre-commit', '.git/commondir', '.git/HEAD', 'sub/.git/modules/lib/config', '.git/worktrees/x/config', '.GIT/HOOKS/post-merge']) {
    assert.equal(arquivoQueRodaNoGit(path.join(PROJETO, p)), true, p);
  }
  for (const p of ['.gitignore', '.gitmodules', '.github/workflows/ci.yml', 'config', 'src/config.js', 'repo.git/x', 'hooks/x.js']) {
    assert.equal(arquivoQueRodaNoGit(path.join(PROJETO, p)), false, p);
  }
});

test('área de trabalho: projeto, temporária e pastas liberadas; HOME "ponto" fica fora quando o projeto é a HOME', { skip: semFora && 'sem pasta fora da temporária do sistema' }, () => {
  assert.equal(foraDaAreaDeTrabalho(path.join(PROJETO, 'a/b.js')), false);
  assert.equal(foraDaAreaDeTrabalho(path.join(os.tmpdir(), 'x.txt')), false);
  assert.equal(foraDaAreaDeTrabalho(path.join(FORA, 'x.txt')), true);
  assert.equal(foraDaAreaDeTrabalho(path.join(FORA, 'x.txt'), { extras: [FORA] }), false);
  assert.equal(foraDaAreaDeTrabalho(path.join(FORA, 'x.txt'), { extras: ['~/documentos'] }), false);
  assert.equal(foraDaAreaDeTrabalho(path.join(FORA, 'x.txt'), { extras: ['relativo'] }), true);
  assert.equal(foraDaAreaDeTrabalho('/etc/hosts'), true);
  // aberto na HOME: arquivos comuns contam como projeto; ~/.bashrc e ~/.config não
  const naHome = { raiz: HOME_FALSO, home: HOME_FALSO };
  assert.equal(foraDaAreaDeTrabalho(path.join(HOME_FALSO, 'notas.txt'), naHome), false);
  assert.equal(foraDaAreaDeTrabalho(path.join(HOME_FALSO, '.bashrc'), naHome), true);
  assert.equal(foraDaAreaDeTrabalho(path.join(HOME_FALSO, '.config/autostart/x.desktop'), naHome), true);
  // uma pasta liberada que contém a HOME não vale
  assert.equal(foraDaAreaDeTrabalho('/etc/hosts', { extras: ['/'] }), true);
  // link de dentro do projeto para fora conta pelo destino
  fs.symlinkSync(FORA, path.join(PROJETO, 'atalho'));
  assert.equal(foraDaAreaDeTrabalho(path.join(PROJETO, 'atalho', 'y.txt')), true);
});

test('write_file fora do projeto pergunta; "n" não grava, "s" grava; dentro não pergunta', { skip: semFora && 'sem pasta fora da temporária do sistema' }, async () => {
  config.saveConfig({ confirmarForaDoProjeto: true, pastasGravaveis: [] });
  const alvo = path.join(FORA, 'nota.txt');
  let perguntas = respondendo('n');
  assert.match(await fileTools.execute('write_file', { path: alvo, content: 'x' }), /^Gravação cancelada: esse arquivo fica fora da pasta do projeto/);
  assert.equal(fs.existsSync(alvo), false);
  assert.match(perguntas[0], /gravar FORA da pasta do projeto/);
  perguntas = respondendo('s');
  assert.match(await fileTools.execute('write_file', { path: alvo, content: 'x' }), /^Arquivo salvo/);
  assert.equal(fs.readFileSync(alvo, 'utf8'), 'x');
  assert.equal(perguntas.length, 1);
  perguntas = respondendo();
  assert.match(await fileTools.execute('write_file', { path: path.join(PROJETO, 'dentro.txt'), content: 'y' }), /^Arquivo salvo/);
  assert.equal(perguntas.length, 0);
});

test('edit_file fora do projeto pergunta (só depois de achar o trecho); pastas liberadas e o config desligado não perguntam', { skip: semFora && 'sem pasta fora da temporária do sistema' }, async () => {
  const alvo = path.join(FORA, 'editar.txt');
  fs.writeFileSync(alvo, 'antes');
  config.saveConfig({ confirmarForaDoProjeto: true, pastasGravaveis: [] });
  let perguntas = respondendo('n');
  assert.match(await fileTools.execute('edit_file', { path: alvo, old_text: 'nao-tem', new_text: 'x' }), /não encontrado/);
  assert.equal(perguntas.length, 0, 'edição que ia falhar não pergunta');
  assert.match(await fileTools.execute('edit_file', { path: alvo, old_text: 'antes', new_text: 'depois' }), /^Gravação cancelada/);
  assert.equal(fs.readFileSync(alvo, 'utf8'), 'antes');
  config.saveConfig({ pastasGravaveis: [FORA] });
  perguntas = respondendo();
  assert.match(await fileTools.execute('edit_file', { path: alvo, old_text: 'antes', new_text: 'depois' }), /^Editado/);
  assert.equal(perguntas.length, 0);
  config.saveConfig({ pastasGravaveis: [], confirmarForaDoProjeto: false });
  assert.match(await fileTools.execute('edit_file', { path: alvo, old_text: 'depois', new_text: 'de novo' }), /^Editado/);
  assert.equal(perguntas.length, 0);
  config.saveConfig({ confirmarForaDoProjeto: true });
});

test('edit_files: UMA pergunta para todos os arquivos de fora; recusada, nada é gravado', { skip: semFora && 'sem pasta fora da temporária do sistema' }, async () => {
  config.saveConfig({ confirmarForaDoProjeto: true, pastasGravaveis: [] });
  const a = path.join(FORA, 'a.txt');
  const b = path.join(FORA, 'b.txt');
  const c = path.join(PROJETO, 'c.txt');
  for (const f of [a, b, c]) fs.writeFileSync(f, 'v1');
  const perguntas = respondendo('n');
  const edits = [a, b, c].map((p) => ({ path: p, old_text: 'v1', new_text: 'v2' }));
  assert.match(await multiEdit.execute('edit_files', { edits }), /^Gravação cancelada: esses arquivos ficam fora .* Nada foi gravado\.$/);
  assert.equal(perguntas.length, 1);
  assert.match(perguntas[0], /a\.txt[\s\S]*b\.txt/);
  assert.doesNotMatch(perguntas[0], /c\.txt/);
  for (const f of [a, b, c]) assert.equal(fs.readFileSync(f, 'utf8'), 'v1');
});

test('numa rotina (ninguém para responder) gravar fora do projeto é recusado', { skip: semFora && 'sem pasta fora da temporária do sistema' }, async () => {
  config.saveConfig({ confirmarForaDoProjeto: true, pastasGravaveis: [] });
  prompt.ask = askReal; // o de verdade: com as perguntas suspensas, responde "não" sem ler o terminal
  const liberar = prompt.suspenderPerguntas();
  const escrever = process.stdout.write;
  process.stdout.write = () => true;
  try {
    const r = await fileTools.execute('write_file', { path: path.join(FORA, 'rotina.txt'), content: 'x' });
    assert.match(r, /^Gravação cancelada/);
  } finally { liberar(); process.stdout.write = escrever; }
  assert.equal(fs.existsSync(path.join(FORA, 'rotina.txt')), false);
});

test('.git: write_file, edit_file e edit_files recusam (mesmo dentro do projeto)', async () => {
  config.saveConfig({ confirmarForaDoProjeto: true });
  const git = path.join(PROJETO, '.git');
  fs.mkdirSync(path.join(git, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[core]\n');
  const perguntas = respondendo('s', 's', 's');
  assert.match(await fileTools.execute('write_file', { path: path.join(git, 'hooks', 'pre-commit'), content: '#!/bin/sh\n' }), /^Bloqueado: o que está no \.git/);
  assert.match(await fileTools.execute('edit_file', { path: path.join(git, 'config'), old_text: '[core]', new_text: '[core]\n\tfsmonitor = x' }), /^Bloqueado: o que está no \.git/);
  assert.match(await multiEdit.execute('edit_files', { edits: [{ path: path.join(git, 'config'), old_text: '[core]', new_text: '[x]' }] }), /^Bloqueado: o que está no \.git.*nada foi gravado/s);
  assert.match(await fileTools.execute('write_file', { path: path.join(git, 'commondir'), content: '/tmp/outro' }), /^Bloqueado: o que está no \.git/);
  assert.equal(fs.existsSync(path.join(git, 'hooks', 'pre-commit')), false);
  assert.equal(fs.readFileSync(path.join(git, 'config'), 'utf8'), '[core]\n');
  assert.equal(perguntas.length, 0);
  // um link de dentro do projeto para o hook também é pego (compara o caminho real)
  fs.symlinkSync(path.join(git, 'hooks'), path.join(PROJETO, 'ganchos'));
  assert.match(await fileTools.execute('write_file', { path: path.join(PROJETO, 'ganchos', 'post-merge'), content: 'x' }), /^Bloqueado: o que está no \.git/);
});
