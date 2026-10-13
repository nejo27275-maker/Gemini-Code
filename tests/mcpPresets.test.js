'use strict';
// v0.34.0: presets MCP (Spotify, Blender, Roblox) e confirmação antes de ferramentas que rodam código.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { comando, PRESETS, lerFlags, mascarar } = require('../src/mcpPresets');
const mcpClient = require('../src/tools/mcpClient');

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')); return { d, p: path.join(d, 'mcp.json') }; }
const ler = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const opts = (p, env = {}) => ({ mcpPath: p, env, pathEnv: '/nada' });

test('presets lista os três; add sem nome ou nome errado explica', () => {
  const { p } = tmp();
  const t = comando(['presets'], opts(p));
  for (const n of ['spotify', 'blender', 'roblox']) assert.match(t, new RegExp(n));
  assert.match(comando(['add', 'foo'], opts(p)), /desconhecido/);
  assert.ok(!fs.existsSync(p));
});

test('add blender: comando uvx, host/porta, telemetria desligada e confirmação do código', () => {
  const { p } = tmp();
  const out = comando(['add', 'blender', '--host', '192.168.0.5', '--port', '9999'], opts(p));
  const e = ler(p).mcpServers.blender;
  assert.equal(e.command, 'uvx');
  assert.deepEqual(e.args, ['blender-mcp']);
  assert.deepEqual(e.env, { BLENDER_HOST: '192.168.0.5', BLENDER_PORT: '9999', DISABLE_TELEMETRY: 'true' });
  assert.deepEqual(e.confirmar, ['execute']);
  assert.match(out, /Blender não roda no Android/);
});

test('add spotify: placeholders sem credenciais; usa variáveis do ambiente; flag vence', () => {
  const a = tmp();
  const out = comando(['add', 'spotify'], opts(a.p));
  assert.equal(ler(a.p).mcpServers.spotify.env.SPOTIFY_CLIENT_ID, 'COLE_AQUI');
  assert.match(out, /falta preencher SPOTIFY_CLIENT_ID/);
  const b = tmp();
  comando(['add', 'spotify', '--client-id', 'FLAG'], opts(b.p, { SPOTIFY_CLIENT_ID: 'ENV', SPOTIFY_CLIENT_SECRET: 'SEG' }));
  const env = ler(b.p).mcpServers.spotify.env;
  assert.equal(env.SPOTIFY_CLIENT_ID, 'FLAG');
  assert.equal(env.SPOTIFY_CLIENT_SECRET, 'SEG');
  assert.equal(env.SPOTIFY_REDIRECT_URI, 'http://127.0.0.1:8080/callback');
  assert.deepEqual(ler(b.p).mcpServers.spotify.args.slice(0, 2), ['--python', '3.12']);
});

test('add roblox: local (cmd) e via ssh; launcher customizado', () => {
  const a = tmp(); comando(['add', 'roblox'], opts(a.p));
  assert.deepEqual(ler(a.p).mcpServers.roblox.args, ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat']);
  const b = tmp(); comando(['add', 'roblox', '--ssh', 'neto@192.168.0.9'], opts(b.p));
  const e = ler(b.p).mcpServers.roblox;
  assert.equal(e.command, 'ssh');
  assert.deepEqual(e.args.slice(0, 4), ['-T', '-o', 'BatchMode=yes', 'neto@192.168.0.9']);
  assert.match(e.args[4], /mcp\.bat$/);
  const c = tmp(); comando(['add', 'roblox', '--launcher', '/x/mcp.sh'], opts(c.p));
  assert.deepEqual(ler(c.p).mcpServers.roblox.args, ['/c', '/x/mcp.sh']);
});

test('não sobrescreve sem --forcar, preserva outros servidores e chaves, e faz .bak', () => {
  const { p } = tmp();
  fs.writeFileSync(p, JSON.stringify({ extra: 1, mcpServers: { outro: { command: 'x' }, blender: { command: 'antigo' } } }));
  assert.match(comando(['add', 'blender'], opts(p)), /Já existe/);
  assert.equal(ler(p).mcpServers.blender.command, 'antigo');
  comando(['add', 'blender', '--forcar'], opts(p));
  const d = ler(p);
  assert.equal(d.mcpServers.blender.command, 'uvx');
  assert.equal(d.mcpServers.outro.command, 'x');
  assert.equal(d.extra, 1);
  assert.equal(ler(`${p}.bak`).mcpServers.blender.command, 'antigo');
});

test('JSON quebrado: lança e NÃO sobrescreve o arquivo', () => {
  const { p } = tmp();
  fs.writeFileSync(p, '{ quebrado');
  assert.throws(() => comando(['add', 'blender'], opts(p)));
  assert.equal(fs.readFileSync(p, 'utf8'), '{ quebrado');
});

test('validações: opção inexistente, valor faltando, porta inválida', () => {
  const { p } = tmp();
  assert.match(comando(['add', 'blender', '--foo', '1'], opts(p)), /não existe/);
  assert.match(comando(['add', 'blender', '--host'], opts(p)), /precisa de um valor/);
  assert.match(comando(['add', 'blender', '--port', '99999'], opts(p)), /Porta inválida/);
  assert.ok(!fs.existsSync(p));
});

test('list mascara segredos; remove e check', () => {
  const { p } = tmp();
  comando(['add', 'spotify', '--client-id', 'meuid', '--client-secret', 'SEGREDO123'], opts(p));
  const l = comando(['list'], opts(p));
  assert.ok(!l.includes('SEGREDO123'));
  assert.match(l, /SPOTIFY_CLIENT_SECRET=\*{8}/);
  assert.match(l, /SPOTIFY_CLIENT_ID=meuid/);
  assert.match(comando(['check'], opts(p)), /comando "uvx" não encontrado/);
  assert.match(comando(['remove', 'spotify'], opts(p)), /removido/);
  assert.match(comando(['remove', 'spotify'], opts(p)), /Não existe/);
  assert.match(comando(['list'], opts(p)), /Nenhum servidor/);
});

test('mascarar e lerFlags', () => {
  assert.equal(mascarar({ A_TOKEN: 'x', HOST: 'h' }), 'A_TOKEN=********, HOST=h');
  assert.deepEqual(lerFlags(['spotify', '--forcar', '--port', '1']), { flags: { forcar: true, port: '1' }, posicionais: ['spotify'] });
  assert.ok(PRESETS.spotify && PRESETS.blender && PRESETS.roblox);
});

// ---- confirmação no cliente MCP ----
const fakeConn = (cfg, chamadas) => ({ cfg, tools: [], callTool: async (n, a) => { chamadas.push([n, a]); return { content: [{ type: 'text', text: 'feito' }] }; } });

test('precisaConfirmar: trecho do nome, "*" e sem lista', () => {
  assert.equal(mcpClient.precisaConfirmar({ confirmar: ['execute'] }, 'execute_blender_code'), true);
  assert.equal(mcpClient.precisaConfirmar({ confirmar: ['execute'] }, 'get_scene_info'), false);
  assert.equal(mcpClient.precisaConfirmar({ confirmar: ['*'] }, 'qualquer'), true);
  assert.equal(mcpClient.precisaConfirmar({}, 'execute_x'), false);
});

test('ferramenta marcada só roda se o usuário responde s; "n" ou vazio cancela', async () => {
  const chamadas = [];
  mcpClient._testar({ conexoes: { blender: fakeConn({ confirmar: ['execute'] }, chamadas) }, ask: async () => 'n' });
  assert.match(await mcpClient.execute('mcp__blender__execute_blender_code', { code: 'x' }), /cancelada/);
  mcpClient._testar({ ask: async () => '' });
  assert.match(await mcpClient.execute('mcp__blender__execute_blender_code', { code: 'x' }), /cancelada/);
  assert.equal(chamadas.length, 0);
  mcpClient._testar({ ask: async () => 'S' });
  assert.equal(await mcpClient.execute('mcp__blender__execute_blender_code', { code: 'x' }), 'feito');
  assert.equal(chamadas.length, 1);
});

test('ferramenta não marcada roda sem perguntar', async () => {
  const chamadas = []; let perguntou = false;
  mcpClient._testar({ conexoes: { blender: fakeConn({ confirmar: ['execute'] }, chamadas) }, ask: async () => { perguntou = true; return 'n'; } });
  assert.equal(await mcpClient.execute('mcp__blender__get_scene_info', {}), 'feito');
  assert.equal(perguntou, false);
});

test('mcp off/on liga e desliga sem perder a configuração; list e check respeitam', () => {
  const { p } = tmp();
  comando(['add', 'blender'], opts(p));
  assert.match(comando(['off', 'blender'], opts(p)), /desligado/);
  assert.equal(ler(p).mcpServers.blender.desativado, true);
  assert.equal(ler(p).mcpServers.blender.command, 'uvx');
  assert.match(comando(['list'], opts(p)), /blender \[DESLIGADO\]/);
  assert.match(comando(['check'], opts(p)), /Tudo certo/); // uvx ausente do PATH de teste, mas está desligado
  assert.match(comando(['on', 'blender'], opts(p)), /ligado/);
  assert.equal('desativado' in ler(p).mcpServers.blender, false);
  assert.match(comando(['off', 'nada'], opts(p)), /Não existe/);
  assert.match(comando(['on'], opts(p)), /^Uso:/);
});
