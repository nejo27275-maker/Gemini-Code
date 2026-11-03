// src/tools/mediaTools.js
// Geração de vídeo, música e som. Esses modelos (Veo para vídeo, Lyria para
// música) são separados do Gemini de texto e nem toda API key/conta tem
// acesso liberado a eles (às vezes é preciso ativar no Google AI Studio /
// Vertex AI e podem ter custo). Este módulo faz a chamada da forma correta,
// mas trata o "sem acesso" com uma mensagem clara em vez de travar o app.
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function callLongRunningModel(modelPath, body) {
  const cfg = loadConfig();
  if (!cfg.apiKey) throw new Error('Configure a API key primeiro: gemini-code config set-key SUA_CHAVE');

  // v0.41.0: a chave ia na query string (aparece em log de proxy e em mensagem de erro); agora vai no cabeçalho.
  const res = await fetch(`${API_BASE}/${modelPath}:predictLongRunning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify(body),
  });
  // v0.46.1: uma página de erro em HTML (proxy, 502) fazia o res.json() estourar com um SyntaxError cru
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Este recurso (${modelPath}) não respondeu OK (status ${res.status}). ` +
      'É provável que sua conta ainda não tenha esse modelo liberado. ' +
      `Detalhe: ${data.error?.message || JSON.stringify(data).slice(0, 300)}`
    );
  }
  if (typeof data.name !== 'string' || !data.name) throw new Error('A API aceitou o pedido mas não devolveu a operação para acompanhar.');
  return data; // contém um "operation name" para consultar depois
}

const dormirPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Acompanha a operação até terminar (a documentação do Veo consulta a cada 10 s). v0.46.1: antes uma consulta com
 * erro (403, 500) ou uma operação que terminou com erro ficava girando até o tempo esgotar (10 min) e o motivo se
 * perdia; agora erro 4xx para na hora, falha de rede/5xx/429 tenta de novo até 5 vezes seguidas, e o erro da
 * operação aparece.
 */
async function pollOperation(operationName, { intervalMs = 10000, timeoutMs = 5 * 60 * 1000, dormir = dormirPadrao } = {}) {
  const cfg = loadConfig();
  const start = Date.now();
  let falhas = 0;
  while (Date.now() - start < timeoutMs) {
    let res = null;
    let data = {};
    let erroRede = null;
    try {
      res = await fetch(`${API_BASE}/${operationName}`, { headers: { 'x-goog-api-key': cfg.apiKey } });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      erroRede = e;
    }
    if (res && res.ok) {
      falhas = 0;
      if (data.done) {
        if (data.error) throw new Error(`A geração falhou: ${data.error.message || JSON.stringify(data.error).slice(0, 300)}`);
        return data;
      }
    } else {
      const status = res ? res.status : 0;
      const detalhe = data.error?.message ? `: ${data.error.message}` : '';
      if (status >= 400 && status < 500 && status !== 429) throw new Error(`Não consegui acompanhar a geração (HTTP ${status})${detalhe}.`);
      if (++falhas >= 5) throw new Error(`Não consegui acompanhar a geração (${erroRede ? erroRede.message : `HTTP ${status}`}${detalhe}).`);
    }
    await dormir(intervalMs);
  }
  throw new Error('Tempo esgotado esperando a geração terminar.');
}

async function makeVideo(prompt, outDir, { model = 'models/veo-3.1-generate-preview', dormir } = {}) {
  const started = await callLongRunningModel(model, { instances: [{ prompt }] });
  const done = await pollOperation(started.name, { timeoutMs: 10 * 60 * 1000, dormir });
  const resposta = done.response?.generateVideoResponse || {};
  const video = resposta.generatedSamples?.[0]?.video || {};
  // v0.46.0: a API devolve o vídeo dentro da resposta (encodedVideo) ou um endereço para baixar (uri). A chave só vai
  // para o próprio endereço da API do Google — nunca para um host qualquer que viesse na resposta.
  let dados;
  if (video.encodedVideo) {
    dados = Buffer.from(video.encodedVideo, 'base64');
  } else if (video.uri) {
    let u;
    try { u = new URL(video.uri); } catch { throw new Error('A resposta trouxe um endereço de vídeo inválido.'); }
    if (u.protocol !== 'https:' || u.hostname !== 'generativelanguage.googleapis.com') throw new Error(`O vídeo veio de um endereço inesperado (${u.hostname}); não baixei.`);
    const res = await fetch(u, { headers: { 'x-goog-api-key': loadConfig().apiKey }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Não consegui baixar o vídeo (HTTP ${res.status}).`);
    dados = Buffer.from(await res.arrayBuffer());
  } else {
    // v0.46.1: o filtro de segurança do Google tira o vídeo da resposta e diz por quê — antes isso virava "sem vídeo"
    const motivos = Array.isArray(resposta.raiMediaFilteredReasons) ? resposta.raiMediaFilteredReasons.filter((m) => typeof m === 'string') : [];
    if (resposta.raiMediaFilteredCount > 0 || motivos.length) {
      throw new Error(`O Google bloqueou o vídeo pelo filtro de segurança${motivos.length ? `: ${motivos.join(' ').slice(0, 400)}` : ''}. Mude a descrição e tente de novo.`);
    }
    throw new Error('Resposta sem vídeo. Veja se o modelo Veo está habilitado na conta.');
  }
  // v0.46.1: a pasta só é criada com o vídeo na mão (sem chave ou com erro, não sobra pasta vazia)
  fs.mkdirSync(outDir, { recursive: true });
  // antes era sempre "video.mp4" (o segundo vídeo apagava o primeiro); agora um nome novo a cada vez
  let outPath = path.join(outDir, `video-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp4`);
  for (let i = 2; fs.existsSync(outPath); i++) outPath = outPath.replace(/(-\d+)?\.mp4$/, `-${i}.mp4`);
  fs.writeFileSync(outPath, dados, { flag: 'wx' });
  return { outPath };
}

async function makeMusic(prompt, outDir, { model = 'models/lyria-realtime-exp' } = {}) {
  // A API de música (Lyria) do Gemini, na maioria das contas, funciona em modo
  // "streaming" (WebSocket), não em request/response simples. Aqui deixamos o
  // ponto de extensão pronto; ligue sua conta com acesso a Lyria e implemente
  // o handshake de streaming descrito na documentação oficial do Gemini API
  // para música em tempo real.
  fs.mkdirSync(outDir, { recursive: true });
  throw new Error(
    'Geração de música via Lyria usa streaming (WebSocket), não uma chamada única. ' +
    'Este comando está com a estrutura pronta em src/tools/mediaTools.js — ' +
    'complete a conexão de streaming quando tiver acesso ao modelo Lyria na sua conta.'
  );
}

async function makeSound(prompt, outDir) {
  // Efeitos sonoros curtos: por enquanto reaproveita o pipeline de música.
  return makeMusic(prompt, outDir);
}

module.exports = { makeVideo, makeMusic, makeSound, pollOperation };
