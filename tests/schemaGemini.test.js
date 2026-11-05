'use strict';
// v0.45.1: esquema JSON completo (MCP) -> subconjunto aceito pelo Gemini; nomes de ferramenta MCP dentro das regras.
const test = require('node:test');
const assert = require('node:assert/strict');
const { paraGemini, declaracoesParaGemini } = require('../src/schemaGemini');
const mcp = require('../src/tools/mcpClient');

const PERMITIDAS = new Set(['type', 'format', 'title', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'minLength', 'maxLength', 'pattern', 'anyOf', 'items', 'minimum', 'maximum']);
function soChavesPermitidas(no, caminho = '$') {
  if (!no || typeof no !== 'object') return;
  for (const [k, v] of Object.entries(no)) {
    assert.ok(PERMITIDAS.has(k), `${caminho}.${k} não é aceito pela API`);
    if (k === 'properties') for (const [p, s] of Object.entries(v)) soChavesPermitidas(s, `${caminho}.properties.${p}`);
    if (k === 'items') soChavesPermitidas(v, `${caminho}.items`);
    if (k === 'anyOf') v.forEach((s, i) => soChavesPermitidas(s, `${caminho}.anyOf[${i}]`));
  }
}

test('esquema do zod (additionalProperties, $schema, const, formato "uri", default)', () => {
  const zod = {
    $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false,
    properties: {
      url: { type: 'string', format: 'uri', description: 'endereço' },
      modo: { type: 'string', const: 'rapido' },
      quando: { type: 'string', format: 'date-time' },
      limite: { type: 'integer', default: 10, exclusiveMinimum: 0 },
      tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
    required: ['url', 'inexistente'],
  };
  const g = paraGemini(zod);
  soChavesPermitidas(g);
  assert.equal(g.type, 'object');
  assert.deepEqual(g.required, ['url'], 'required só com propriedades que existem');
  assert.equal(g.properties.url.format, undefined, '"uri" não é formato aceito');
  assert.equal(g.properties.quando.format, 'date-time');
  assert.deepEqual(g.properties.modo.enum, ['rapido']);
  assert.equal(g.properties.url.description, 'endereço');
});

test('pydantic: "X ou null", $ref/$defs (inclusive recursivo), allOf, oneOf e type em lista', () => {
  const py = {
    type: 'object',
    $defs: {
      Pessoa: { type: 'object', properties: { nome: { type: 'string' }, filhos: { type: 'array', items: { $ref: '#/$defs/Pessoa' } } }, required: ['nome'] },
    },
    properties: {
      apelido: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'opcional' },
      dono: { $ref: '#/$defs/Pessoa' },
      extra: { allOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { properties: { b: { type: 'number' } } }] },
      valor: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      idade: { type: ['integer', 'null'] },
      nivel: { type: 'integer', enum: [1, 2, 3] },
      externo: { $ref: 'https://exemplo.com/esquema.json' },
    },
  };
  const g = paraGemini(py);
  soChavesPermitidas(g);
  assert.deepEqual(g.properties.apelido, { nullable: true, type: 'string', description: 'opcional' });
  assert.equal(g.properties.dono.type, 'object');
  assert.deepEqual(g.properties.dono.required, ['nome']);
  assert.equal(g.properties.dono.properties.filhos.items.type, 'object', 'referência a si mesma vira objeto genérico, sem laço');
  assert.deepEqual(Object.keys(g.properties.extra.properties).sort(), ['a', 'b']);
  assert.deepEqual(g.properties.extra.required, ['a']);
  assert.deepEqual(g.properties.valor.anyOf.map((x) => x.type), ['string', 'number']);
  assert.deepEqual(g.properties.idade, { nullable: true, type: 'integer' });
  assert.equal(g.properties.nivel.enum, undefined, 'enum de números não é aceito: fica só o tipo');
  assert.equal(g.properties.externo.type, 'object');
});

test('ferramenta sem argumentos fica sem "parameters" (objeto vazio no topo é recusado pela API)', () => {
  const [d] = declaracoesParaGemini([{ name: 'listar', description: 'x', parameters: { type: 'object', properties: {}, additionalProperties: false } }]);
  assert.deepEqual(d, { name: 'listar', description: 'x' });
  assert.equal(paraGemini(undefined), undefined);
});

test('as ferramentas nativas passam sem nenhuma mudança', async () => {
  const tools = require('../src/tools');
  const decls = await tools.getAllDeclarations(tools.nomesNativos());
  assert.deepEqual(declaracoesParaGemini(decls), decls);
});

test('nome MCP exposto: só [a-zA-Z0-9_-], até 64, sem colisão; a chamada chega ao servidor e à ferramenta certos', async () => {
  const curto = mcp.nomeExposto('github', 'list_issues');
  assert.equal(curto, 'mcp__github__list_issues', 'nome que já é válido não muda');
  const comPonto = mcp.nomeExposto('blender.local', 'scene.get');
  assert.match(comPonto, /^[a-zA-Z0-9_-]{1,64}$/);
  const longo = mcp.nomeExposto('servidor-com-um-nome-bem-comprido', 'ferramenta_com_um_nome_tambem_bem_comprido_mesmo');
  assert.match(longo, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(longo.length, 64);

  const chamadas = [];
  const conexao = (tools) => ({ tools, cfg: {}, callTool: async (n, a) => { chamadas.push([n, a]); return { content: [{ type: 'text', text: `ok ${n}` }] }; }, stop() {} });
  mcp._testar({ conexoes: { 'blender.local': conexao([{ name: 'scene.get' }, { name: 'scene_get' }]), 'servidor-com-um-nome-bem-comprido': conexao([{ name: 'ferramenta_com_um_nome_tambem_bem_comprido_mesmo' }]) } });
  const decls = await mcp.declarationsForGemini();
  const nomes = decls.map((d) => d.name);
  assert.equal(new Set(nomes).size, 3, 'scene.get e scene_get não colidem');
  for (const n of nomes) assert.match(n, /^[a-zA-Z0-9_-]{1,64}$/);
  for (const n of nomes) await mcp.execute(n, { x: 1 });
  assert.deepEqual(chamadas.map((c) => c[0]).sort(), ['ferramenta_com_um_nome_tambem_bem_comprido_mesmo', 'scene.get', 'scene_get']);
  mcp._testar({ conexoes: null });
});
