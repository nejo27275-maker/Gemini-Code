'use strict';
// v0.41.0: hooks UserPromptSubmit, SessionStart e Stop (antes só PreToolUse/PostToolUse).
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME_FALSO = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-hooks-ev-'));
process.env.HOME = HOME_FALSO;
process.env.USERPROFILE = HOME_FALSO;

const test = require('node:test');
const assert = require('node:assert/strict');
const hooks = require('../src/hooks');
const { runOnce } = require('../src/agent');

const skip = process.platform === 'win32';
const NODE = JSON.stringify(process.execPath);
function script(nome, codigo) { const p = path.join(HOME_FALSO, nome); fs.writeFileSync(p, codigo); return `${NODE} ${JSON.stringify(p)}`; }
function configurar(obj) { const f = path.join(fs.mkdtempSync(path.join(HOME_FALSO, 'h-')), 'hooks.json'); fs.writeFileSync(f, JSON.stringify(obj)); hooks.definirArquivo(f); }
const resp = (text) => ({ functionCalls: () => [], text: () => text, rawParts: () => [] });
const deps = (modelo) => ({ chatWithTools: modelo, buildSystemInstruction: () => 'base', loadConfig: () => ({}) });

test('UserPromptSubmit com código 2 bloqueia o pedido sem chamar o modelo', { skip }, async () => {
  configurar({ UserPromptSubmit: [{ command: script('bloqueia.js', "process.stderr.write('pedido proibido hoje'); process.exit(2)") }] });
  let chamadas = 0;
  const historico = [{ role: 'user', parts: [{ text: 'antes' }] }];
  const r = await runOnce('apague tudo', { history: historico, deps: deps(async () => { chamadas++; return resp('x'); }) });
  assert.equal(chamadas, 0);
  assert.match(r.text, /bloqueado por hook.*pedido proibido hoje/);
  assert.deepEqual(r.history, historico);
});

test('UserPromptSubmit com saída e código 0 acrescenta contexto ao pedido (o hook recebe o prompt)', { skip }, async () => {
  configurar({ UserPromptSubmit: [{ command: script('contexto.js', "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('branch atual: main; prompt tinha ' + JSON.parse(d).prompt.length + ' chars'))") }] });
  let enviado = null;
  await runOnce('olá', { deps: deps(async ({ history }) => { enviado = JSON.parse(JSON.stringify(history)); return resp('ok'); }) });
  assert.match(enviado[enviado.length - 1].parts[0].text, /^olá\n\n\[contexto adicionado por hook do usuário\]\nbranch atual: main; prompt tinha 3 chars$/);
});

test('SessionStart entra no prompt do sistema e roda uma vez por processo', { skip }, async () => {
  const contador = path.join(HOME_FALSO, 'sessionstart.txt');
  configurar({ SessionStart: [{ command: script('inicio.js', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(contador)},'x');console.log('sprint 42: foco em pagamentos')`) }] });
  const sistemas = [];
  const modelo = async ({ systemInstruction }) => { sistemas.push(systemInstruction); return resp('ok'); };
  await runOnce('a', { deps: deps(modelo) });
  await runOnce('b', { deps: deps(modelo) });
  assert.match(sistemas[0], /^base\n\nContexto adicionado pelo hook SessionStart do usuário:\nsprint 42: foco em pagamentos$/);
  assert.equal(sistemas[1], sistemas[0]);
  assert.equal(fs.readFileSync(contador, 'utf8'), 'x', 'rodou uma vez só');
});

test('Stop com código 2 obriga a continuar com o motivo; depois termina', { skip }, async () => {
  const contador = path.join(HOME_FALSO, 'stop.txt');
  configurar({ Stop: [{ command: script('stop.js', `const fs=require('fs');const n=fs.existsSync(${JSON.stringify(contador)})?1:0;fs.writeFileSync(${JSON.stringify(contador)},'1');if(!n){process.stderr.write('npm test ainda falha');process.exit(2)}`) }] });
  const historicos = [];
  let n = 0;
  const r = await runOnce('corrija', { deps: deps(async ({ history }) => { historicos.push(JSON.parse(JSON.stringify(history))); n++; return resp(n === 1 ? 'pronto (mentira)' : 'agora sim'); }) });
  assert.equal(n, 2);
  assert.equal(r.text, 'agora sim');
  const ultima = historicos[1][historicos[1].length - 1];
  assert.match(ultima.parts[0].text, /^\[hook Stop do usuário\] A tarefa ainda não terminou: npm test ainda falha/);
});

test('Stop que sempre bloqueia não prende o agente: no máximo 3 continuações', { skip }, async () => {
  configurar({ Stop: [{ command: script('stop-sempre.js', "process.stderr.write('nunca satisfeito');process.exit(2)") }] });
  let n = 0;
  const r = await runOnce('x', { deps: deps(async () => { n++; return resp(`resposta ${n}`); }) });
  assert.equal(n, 4, '1 resposta + 3 continuações');
  assert.equal(r.text, 'resposta 4');
});
