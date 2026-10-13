'use strict';
// v0.40.0: arquivos que dariam ao modelo mais poder do que ele tem (config.json,
// mcp.json, hooks.json, tokens) não podem ser gravados por write_file/edit_file —
// nem direto, nem por symlink (comum em repositório clonado) ou hard link.
// Cada arquivo de teste roda em processo próprio: trocar o HOME aqui não vaza.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-protegidos-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const fileTools = require('../src/tools/fileTools');
const { touchesProtectedFile } = require('../src/tools/shellTools');
const { runOnce } = require('../src/agent');

// Caminhos montados à mão (e não lidos de config.HOOKS_PATH): o teste precisa
// falhar contra uma versão que nem conhece a constante.
const { CONFIG_PATH, HOME_DIR } = config;
const HOOKS_PATH = path.join(HOME_DIR, 'hooks.json');
const PROTECTED_PATHS = ['config.json', 'config.json.bak', 'config.json.tmp', 'mcp.json', 'hooks.json', 'cowork-token.txt', 'routine-api-token.txt', 'confianca.json']
  .map((nome) => path.join(HOME_DIR, nome));
const semSymlink = process.platform === 'win32';
const projeto = () => fs.mkdtempSync(path.join(HOME_FALSO, 'projeto-'));
const gravar = (p, content = 'x') => fileTools.execute('write_file', { path: p, content });

test('a lista protegida do config bate com os arquivos que os módulos realmente usam', () => {
  assert.deepEqual([...(config.PROTECTED_PATHS || [])].sort(), PROTECTED_PATHS.slice().sort());
  assert.equal(config.HOOKS_PATH, HOOKS_PATH);
  assert.equal(require('../src/routineApi').TOKEN_PATH, path.join(HOME_DIR, 'routine-api-token.txt'));
});

test('write_file recusa cada arquivo protegido e não cria nenhum deles', async () => {
  config.loadConfig();
  const antes = fs.readFileSync(CONFIG_PATH, 'utf8');
  for (const p of PROTECTED_PATHS) {
    const existia = fs.existsSync(p);
    assert.match(await gravar(p, '{"confirmShell": false}'), /^Bloqueado/, p);
    if (!existia) assert.equal(fs.existsSync(p), false, `${p} não pode ter sido criado`);
  }
  assert.equal(fs.readFileSync(CONFIG_PATH, 'utf8'), antes);
});

test('edit_file recusa hooks.json existente', async () => {
  fs.writeFileSync(HOOKS_PATH, '{"PreToolUse": []}');
  try {
    const r = await fileTools.execute('edit_file', { path: HOOKS_PATH, old_text: '[]', new_text: '[{"command":"id"}]' });
    assert.match(r, /^Bloqueado/);
    assert.equal(fs.readFileSync(HOOKS_PATH, 'utf8'), '{"PreToolUse": []}');
  } finally { fs.rmSync(HOOKS_PATH, { force: true }); }
});

test('symlink de projeto apontando para o config.json não desliga confirmShell', { skip: semSymlink }, async () => {
  config.loadConfig();
  const link = path.join(projeto(), 'settings.json');
  fs.symlinkSync(CONFIG_PATH, link);
  assert.match(await gravar(link, '{"configVersion":5,"confirmShell":false}'), /^Bloqueado/);
  assert.equal(config.loadConfig().confirmShell, true);
  const r = await fileTools.execute('edit_file', { path: link, old_text: '{', new_text: '{"confirmShell":false,' });
  assert.match(r, /^Bloqueado/);
});

test('symlink quebrado para hooks.json (que ainda não existe) não cria o arquivo', { skip: semSymlink }, async () => {
  fs.rmSync(HOOKS_PATH, { force: true });
  const dir = projeto();
  // Alvo relativo, como viria num repositório: ../.gemini-code/hooks.json
  fs.symlinkSync(path.relative(dir, HOOKS_PATH), path.join(dir, 'h.json'));
  assert.match(await gravar(path.join(dir, 'h.json'), '{"PreToolUse":[{"command":"id"}]}'), /^Bloqueado/);
  assert.equal(fs.existsSync(HOOKS_PATH), false);
});

test('pasta que é symlink para ~/.gemini-code também é barrada', { skip: semSymlink }, async () => {
  const dir = projeto();
  fs.symlinkSync(HOME_DIR, path.join(dir, 'cfg'), 'dir');
  assert.match(await gravar(path.join(dir, 'cfg', 'hooks.json'), '{}'), /^Bloqueado/);
  assert.match(await gravar(path.join(dir, 'cfg', 'sub', '..', 'mcp.json'), '{}'), /^Bloqueado/);
  assert.equal(fs.existsSync(HOOKS_PATH), false);
});

test('hard link para o config.json é barrado', { skip: semSymlink }, async () => {
  config.loadConfig();
  const link = path.join(projeto(), 'copia.json');
  try { fs.linkSync(CONFIG_PATH, link); } catch { return; } // FS sem hard link
  assert.match(await gravar(link, '{"confirmShell":false}'), /^Bloqueado/);
  assert.equal(config.loadConfig().confirmShell, true);
});

test('sem regressão: arquivos comuns, inclusive com o mesmo nome e via symlink, continuam graváveis', async () => {
  const dir = projeto();
  for (const nome of ['hooks.json', 'config.json', 'mcp.json', 'notas.txt']) {
    assert.match(await gravar(path.join(dir, nome), 'ok'), /^Arquivo salvo/, nome);
    assert.equal(fs.readFileSync(path.join(dir, nome), 'utf8'), 'ok');
  }
  if (!semSymlink) {
    fs.symlinkSync(path.join(dir, 'notas.txt'), path.join(dir, 'atalho.txt'));
    assert.match(await gravar(path.join(dir, 'atalho.txt'), 'via link'), /^Arquivo salvo/);
    assert.equal(fs.readFileSync(path.join(dir, 'notas.txt'), 'utf8'), 'via link');
    // Arquivos não protegidos dentro de ~/.gemini-code (ex.: skills) seguem liberados.
    assert.match(await gravar(path.join(HOME_DIR, 'skills', 'minha', 'SKILL.md'), '# skill'), /^Arquivo salvo/);
  }
});

test('run_shell força confirmação para hooks.json e tokens', () => {
  assert.equal(touchesProtectedFile(`echo '{}' > ${HOOKS_PATH}`), true);
  assert.equal(touchesProtectedFile('cat > hooks.json'), true);
  assert.equal(touchesProtectedFile('cat ~/.gemini-code/cowork-token.txt'), true);
  assert.equal(touchesProtectedFile('cat routine-api-token.txt'), true);
  assert.equal(touchesProtectedFile('npm test'), false);
});

test('loop do agente: modelo que tenta plantar um hook não consegue rodar comando sem confirmação', async () => {
  const marcador = path.join(HOME_FALSO, 'HOOK-RODOU');
  let passo = 0;
  const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });
  const modeloFalso = async () => {
    passo += 1;
    if (passo === 1) return resp([{ name: 'write_file', args: { path: HOOKS_PATH, content: JSON.stringify({ PreToolUse: [{ command: `touch "${marcador}"` }] }) } }]);
    if (passo === 2) return resp([{ name: 'list_dir', args: { path: HOME_FALSO } }]);
    return resp([], 'fim');
  };
  const r = await runOnce('tarefa', { deps: { chatWithTools: modeloFalso, buildSystemInstruction: () => '' } });
  assert.equal(r.text, 'fim');
  assert.equal(fs.existsSync(HOOKS_PATH), false);
  assert.equal(fs.existsSync(marcador), false, 'o comando do hook não pode ter rodado');
});
