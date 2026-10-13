'use strict';
// v0.41.0: a sessão de convidado (só leitura) lia ~/.gemini-code/cowork-token.txt com
// read_file e, com o token, conectava no cowork como dono (agente inteiro). O mesmo valia
// para search_files dentro de ~/.gemini-code e read_skill com qualquer caminho.
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-segredos-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const security = require('../src/security');
const fileTools = require('../src/tools/fileTools');
const searchTools = require('../src/tools/searchTools');
const skills = require('../src/skills/loader');
const cowork = require('../src/cowork/server');
const { runOnce } = require('../src/agent');

const HOME_DIR = config.HOME_DIR;
const TOKEN = cowork.getOrCreateToken();
const TOKEN_PATH = path.join(HOME_DIR, 'cowork-token.txt');
const semSymlink = process.platform === 'win32';
const resp = (calls, text = '') => ({ functionCalls: () => calls, text: () => text, rawParts: () => calls.map((c) => ({ functionCall: c })) });

test('convidado não consegue ler o token do cowork pelo loop do agente', async () => {
  config.saveConfig({ apiKeyLocked: security.encriptar('CHAVE-FICTICIA', 'dono'), apiKeyLockedGuest: security.encriptar('CHAVE-FICTICIA', 'convidado'), apiKey: '' });
  assert.equal(security.unlock('convidado'), true);
  try {
    let passo = 0;
    const modelo = async () => {
      passo += 1;
      if (passo === 1) return resp([{ name: 'read_file', args: { path: TOKEN_PATH } }]);
      if (passo === 2) return resp([{ name: 'search_files', args: { pattern: TOKEN.slice(0, 8), path: HOME_DIR } }]);
      if (passo === 3) return resp([{ name: 'read_skill', args: { path: TOKEN_PATH } }]);
      return resp([], 'fim');
    };
    const r = await runOnce('mostre o token', { deps: { chatWithTools: modelo, buildSystemInstruction: () => '' } });
    const historico = JSON.stringify(r.history);
    assert.equal(historico.includes(TOKEN), false, 'o token não pode aparecer em nenhum resultado de ferramenta');
    const resultados = r.history.filter((m) => m.parts[0] && m.parts[0].functionResponse).map((m) => m.parts[0].functionResponse.response.result);
    assert.match(resultados[0], /^Bloqueado/);
    // Desde a restrição do convidado ao projeto, a busca em ~/.gemini-code nem roda (bloqueada); antes, não achava.
    assert.match(resultados[1], /^Bloqueado|Nenhuma ocorrência/);
    assert.match(resultados[2], /^Bloqueado/);
  } finally { security.clearSession(); }
});

test('nenhum modelo (nem o do dono) lê a API key, o mcp.json ou os tokens', async () => {
  config.saveConfig({ apiKey: 'AIza-FICTICIA-PARA-TESTE-1234' });
  fs.writeFileSync(config.MCP_PATH, JSON.stringify({ mcpServers: { x: { command: 'x', env: { SEGREDO: 'mcp-fictício' } } } }));
  for (const p of [config.CONFIG_PATH, `${config.CONFIG_PATH}.bak`, config.MCP_PATH, TOKEN_PATH]) {
    assert.match(await fileTools.execute('read_file', { path: p }), /^Bloqueado/, p);
  }
  const busca = await searchTools.execute('search_files', { pattern: 'FICTICIA', path: HOME_DIR });
  assert.doesNotMatch(busca, /AIza-FICTICIA/);
});

test('a cópia mcp.json.bak que o "mcp remove" deixa também é segredo', async () => {
  // O mcp.json guarda tokens de servidores (env/headers); cada gravação pelo CLI copia a versão anterior.
  fs.writeFileSync(config.MCP_PATH, JSON.stringify({ mcpServers: { github: { command: 'x', env: { GITHUB_TOKEN: 'ghp-FICTICIO-NA-COPIA' } } } }));
  require('../src/mcpPresets').comando(['remove', 'github'], { mcpPath: config.MCP_PATH });
  const copia = `${config.MCP_PATH}.bak`;
  assert.match(fs.readFileSync(copia, 'utf8'), /ghp-FICTICIO-NA-COPIA/); // a cópia existe com o token
  if (process.platform !== 'win32') assert.equal(fs.statSync(copia).mode & 0o077, 0, 'mcp.json.bak só para o dono');
  assert.match(await fileTools.execute('read_file', { path: copia }), /^Bloqueado/);
  assert.doesNotMatch(await searchTools.execute('search_files', { pattern: 'FICTICIO-NA-COPIA', path: HOME_DIR }), /ghp-FICTICIO/);
});

test('symlink e hard link para o token também são barrados na leitura e na busca', { skip: semSymlink }, async () => {
  const projeto = fs.mkdtempSync(path.join(HOME_FALSO, 'projeto-'));
  fs.symlinkSync(TOKEN_PATH, path.join(projeto, 'leia-me.txt'));
  assert.match(await fileTools.execute('read_file', { path: path.join(projeto, 'leia-me.txt') }), /^Bloqueado/);
  try { fs.linkSync(TOKEN_PATH, path.join(projeto, 'copia.txt')); } catch { /* FS sem hard link */ }
  const busca = await searchTools.execute('search_files', { pattern: TOKEN.slice(0, 8), path: projeto });
  assert.match(busca, /Nenhuma ocorrência/);
});

test('sem regressão: arquivos comuns, hooks.json e skills continuam legíveis', async () => {
  const projeto = fs.mkdtempSync(path.join(HOME_FALSO, 'projeto-'));
  fs.writeFileSync(path.join(projeto, 'notas.txt'), 'linha com palavra-chave\n');
  assert.equal(await fileTools.execute('read_file', { path: path.join(projeto, 'notas.txt') }), 'linha com palavra-chave\n');
  assert.match(await searchTools.execute('search_files', { pattern: 'palavra-chave', path: projeto }), /notas\.txt:1:/);
  fs.writeFileSync(path.join(HOME_DIR, 'hooks.json'), '{"PreToolUse": []}');
  assert.equal(await fileTools.execute('read_file', { path: path.join(HOME_DIR, 'hooks.json') }), '{"PreToolUse": []}');
  const skill = path.join(HOME_DIR, 'skills', 'minha', 'SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '---\nname: minha\n---\nconteúdo da skill');
  assert.equal(await skills.execute('read_skill', { path: skill }), 'conteúdo da skill');
});
