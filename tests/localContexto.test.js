'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ctxlocal-'));
process.env.HOME = home;
const dados = path.join(home, '.gemini-code');
fs.mkdirSync(path.join(dados, 'knowledge'), { recursive: true });
fs.writeFileSync(path.join(dados, 'config.json'), JSON.stringify({ configVersion: 99, provider: 'llamacpp', apiKey: '', llamaCppCtx: 4096 }));
fs.writeFileSync(path.join(dados, 'knowledge', 'netolang.md'), `# NetoLang\nMARCADOR_NETOLANG: use "mostrar" no lugar de print.\n${'linha de especificação. '.repeat(300)}`);

process.chdir(home); // sem AGENTS.md/GEMINI.md do repositório entrando no conhecimento
const usage = require('../src/usage');
const local = require('../src/providers/llamacpp');
const provider = require('../src/provider');

test('auto-compact local: compacta com 60% do contexto do servidor, mesmo abaixo do limiar da nuvem', () => {
  usage.zerar();
  usage.registrar({ local: true, promptTokens: 2600 });
  assert.equal(usage.contextoGrande(60000, { ctxLocal: 4096 }), true);
  assert.equal(usage.contextoGrande(60000), false, 'sem ctxLocal mantém o comportamento antigo');
  assert.equal(usage.contextoGrande(0, { ctxLocal: 4096 }), false, '0 continua desligando');
  usage.zerar();
  usage.registrar({ local: true, promptTokens: 1500 });
  assert.equal(usage.contextoGrande(60000, { ctxLocal: 4096 }), false);
  usage.registrar({ modelo: 'gemini-x', uso: { promptTokenCount: 3000, totalTokenCount: 3100 } });
  assert.equal(usage.contextoGrande(60000, { ctxLocal: 4096 }), false, 'última chamada foi na nuvem: vale o limiar da nuvem');
});

test('chamada local pelo roteador registra o tamanho do prompt', async () => {
  usage.zerar();
  const antigo = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'oi' } }] }) });
  try {
    await provider.chatWithTools({ history: [{ role: 'user', parts: [{ text: 'a'.repeat(900) }] }], tools: [], systemInstruction: 'sys' });
  } finally { global.fetch = antigo; }
  const e = usage.estado();
  assert.equal(e.locais, 1);
  assert.ok(e.ultimoPrompt >= 300, `ultimoPrompt=${e.ultimoPrompt}`);
  assert.equal(e.ultimoLocal, true);
});

test('o conhecimento fixo do usuário sobrevive ao corte do system (antes era cortado junto com o fim)', async () => {
  const sistema = require('../src/agent').buildSystemInstruction();
  assert.match(sistema, /MARCADOR_NETOLANG/);
  const antigo = global.fetch;
  let corpo;
  global.fetch = async (u, op) => { corpo = JSON.parse(op.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
  try {
    const tools = await require('../src/tools').getAllDeclarations();
    await local.chatWithTools({ systemInstruction: sistema, history: [{ role: 'user', parts: [{ text: 'oi' }] }], tools });
  } finally { global.fetch = antigo; }
  const sys = corpo.messages[0].content;
  assert.match(sys, /Você é o gemini-code/);
  assert.match(sys, /run_checks/);
  assert.match(sys, /MARCADOR_NETOLANG/);
  assert.doesNotMatch(sys, /Skills disponíveis/);
  assert.doesNotMatch(sys, /delegate_task/);
  assert.ok(local.estimarTokens(JSON.stringify(corpo.messages)) + local.estimarTokens(JSON.stringify(corpo.tools)) + corpo.max_tokens <= 4096);
});

test('compactarSistema: texto que já cabe passa intacto; corte final deixa aviso', () => {
  assert.equal(local.compactarSistema('curto', 100), 'curto');
  const r = local.compactarSistema(`Base.\n\nPara investigações use delegate_task.\n\nSkills disponíveis:\n- a\n- b\n\n${'z'.repeat(500)}`, 200);
  assert.match(r, /^Base\./);
  assert.doesNotMatch(r, /delegate_task|Skills dispon/);
  assert.match(r, /omitidas/);
});
