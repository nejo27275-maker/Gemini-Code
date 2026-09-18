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

  const res = await fetch(`${API_BASE}/${modelPath}:predictLongRunning?key=${cfg.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Este recurso (${modelPath}) não respondeu OK (status ${res.status}). ` +
      'É provável que sua conta ainda não tenha esse modelo liberado. ' +
      `Detalhe: ${data.error?.message || JSON.stringify(data)}`
    );
  }
  return data; // contém um "operation name" para consultar depois
}

async function pollOperation(operationName, { intervalMs = 5000, timeoutMs = 5 * 60 * 1000 } = {}) {
  const cfg = loadConfig();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${API_BASE}/${operationName}?key=${cfg.apiKey}`);
    const data = await res.json();
    if (data.done) return data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Tempo esgotado esperando a geração terminar.');
}

async function makeVideo(prompt, outDir, { model = 'models/veo-3.1-generate-preview' } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const started = await callLongRunningModel(model, { instances: [{ prompt }] });
  const done = await pollOperation(started.name, { timeoutMs: 10 * 60 * 1000 });
  const videoB64 = done.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.encodedVideo;
  if (!videoB64) throw new Error('Resposta sem vídeo. Veja se o modelo Veo está habilitado na conta.');
  const outPath = path.join(outDir, 'video.mp4');
  fs.writeFileSync(outPath, Buffer.from(videoB64, 'base64'));
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

module.exports = { makeVideo, makeMusic, makeSound };
