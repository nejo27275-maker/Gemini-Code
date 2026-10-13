'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { erroDaApi } = require('../src/gemini');

const msg429 =
  'You exceeded your current quota, please check your plan and billing details. ' +
  '* Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro';

test('429 com "limit: 0" explica que a métrica não libera chamadas e sugere escolher outro modelo Gemini', () => {
  const e = erroDaApi({
    status: 429,
    data: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: msg429 } },
    model: 'gemini-3.1-pro-preview',
    contexto: 'Erro ao chamar o modelo',
  });
  assert.match(e.message, /HTTP 429 RESOURCE_EXHAUSTED/);
  assert.match(e.message, /limit: 0/);
  assert.match(e.message, /set-model NOME_DO_MODELO/);
  assert.match(e.message, /somente a API Gemini/);
  assert.equal(e.quotaExceeded, true);
  assert.ok(e.message.includes(msg429), 'mantém a mensagem original do Google');
  assert.doesNotMatch(e.message, /Bad Request/);
});

test('429 sem tempo de espera não recomenda repetir em sequência', () => {
  const e = erroDaApi({ status: 429, data: { error: { message: 'Resource has been exhausted' } }, model: 'm', contexto: 'x' });
  assert.match(e.message, /não informou um tempo seguro/);
  assert.match(e.message, /não repita em sequência/);
  assert.equal(e.retryAfterSeconds, undefined);
});

test('429 extrai espera da mensagem e métrica/limite sem sugerir o mesmo modelo', () => {
  const e = erroDaApi({
    status: 429,
    data: { error: { status: 'RESOURCE_EXHAUSTED', message:
      'Quota exceeded for metric: generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash. Please retry in 52.38s.' } },
    model: 'gemini-3.6-flash',
    contexto: 'Erro ao chamar o modelo',
  });
  assert.equal(e.retryAfterSeconds, 53);
  assert.equal(e.quotaMetric, 'generate_content_free_tier_requests');
  assert.match(e.message, /aguardar aproximadamente 53 segundo/);
  assert.match(e.message, /limite informado: 5/);
  assert.doesNotMatch(e.message, /set-model gemini-3\.6-flash/);
  assert.match(e.message, /NÃO repetiu a chamada automaticamente/);
});

test('429 extrai RetryInfo protobuf e cabeçalho Retry-After', () => {
  const eBody = erroDaApi({
    status: 429,
    data: { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded', details: [
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.4s' },
    ] } },
    model: 'm', contexto: 'x',
  });
  assert.equal(eBody.retryAfterSeconds, 13);

  const eHeader = erroDaApi({ status: 429, data: { error: { message: 'quota exceeded' } }, retryAfter: '7', model: 'm', contexto: 'x' });
  assert.equal(eHeader.retryAfterSeconds, 7);
});

test('403 e 404 têm dicas próprias; outros status mantêm a mensagem crua', () => {
  assert.match(erroDaApi({ status: 403, data: { error: { message: 'nope' } }, model: 'm', contexto: 'x' }).message, /chave recusada/);
  assert.match(erroDaApi({ status: 404, data: { error: { message: 'nf' } }, model: 'm', contexto: 'x' }).message, /modelo não encontrado ou não disponível pra contas novas/);
  assert.match(erroDaApi({ status: 400, data: { error: { message: 'boom' } }, model: 'm', contexto: 'x' }).message, /HTTP 400.*boom/);
});
