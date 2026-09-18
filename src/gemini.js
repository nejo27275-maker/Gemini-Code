// src/gemini.js
// Wrapper fino sobre @google/generative-ai, para não espalhar detalhes da SDK
// pelo resto do código.
'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { loadConfig } = require('./config');

function getClient() {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE\n' +
      'Pegue uma chave grátis em https://aistudio.google.com/apikey'
    );
  }
  return new GoogleGenerativeAI(cfg.apiKey);
}

/**
 * Chama o modelo com histórico de mensagens + definição de ferramentas
 * (function calling), no formato usado pelo agente (agent.js).
 *
 * Bug (set/2026): mesmo chamando model.generateContent({contents}) direto
 * (pulando o startChat/sendMessage), o erro "Role 'function' is not
 * supported" continuou idêntico. Ou seja, a própria biblioteca
 * @google/generative-ai (arquivada pelo Google, sem mais atualizações)
 * reescreve o role de qualquer parte com functionResponse para "function"
 * em algum nível mais baixo, não importa por qual função da SDK a gente
 * entre. Não tem como desligar isso client-side.
 *
 * Solução: parar de usar a SDK pra essa chamada e falar direto com a API
 * REST do Google via fetch, montando o JSON à mão. Assim a gente controla
 * 100% do corpo da requisição e o role "user" (que a própria mensagem de
 * erro lista como válido) realmente vai pro Google do jeito que definimos
 * em agent.js, sem nenhuma camada no meio reescrevendo nada.
 */
async function chatWithTools({ modelName, systemInstruction, history, tools }) {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE\n' +
      'Pegue uma chave grátis em https://aistudio.google.com/apikey'
    );
  }

  const model = modelName || cfg.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: history,
    ...(tools && tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data) || res.statusText;
    throw new Error(
      `[GoogleGenerativeAI Error]: Error fetching from ${url}: [${res.status} Bad Request] ${msg}`
    );
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];

  // Objeto de resposta compatível com o que agent.js já espera
  // (response.text(), response.functionCalls() e response.rawParts()).
  return {
    text: () =>
      parts
        .filter((p) => typeof p.text === 'string')
        .map((p) => p.text)
        .join(''),
    functionCalls: () => {
      // Preserva o "id" que o Gemini 3.5+ manda em cada functionCall — a
      // documentação atual do Google exige devolver esse mesmo id na
      // functionResponse; sem ele, o turno seguinte é rejeitado (às vezes
      // com uma mensagem de erro enganosa sobre "role" em vez de citar o
      // id faltando).
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p) => ({
          name: p.functionCall.name,
          args: p.functionCall.args || {},
          id: p.functionCall.id,
        }));
      return calls.length ? calls : undefined;
    },
    // Parts crus exatamente como o Google devolveu (preserva id,
    // thoughtSignature e qualquer outro campo que a gente não conheça —
    // reconstruir esse objeto à mão, como fazíamos antes, jogava esses
    // campos fora e quebrava o turno seguinte).
    rawParts: () => parts,
  };
}

/** Chamada simples de texto, sem ferramentas (usada por design/media helpers). */
async function generateText({ prompt, modelName }) {
  const cfg = loadConfig();
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: modelName || cfg.fastModel });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Geração de imagem. Depende do modelo de imagem estar habilitado na conta
 * do Google AI Studio / Vertex ligada à sua API key. Se não estiver, a API
 * retorna erro claro — trate isso na camada de cima.
 */
async function generateImage({ prompt, modelName }) {
  const cfg = loadConfig();
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: modelName || cfg.imageModel });
  const result = await model.generateContent(prompt);
  const parts = result.response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) {
    throw new Error(
      'O modelo não retornou imagem. Verifique se sua conta tem acesso a geração ' +
      'de imagem (Imagen/Gemini image) no Google AI Studio.'
    );
  }
  return imagePart.inlineData; // { mimeType, data (base64) }
}

module.exports = { getClient, chatWithTools, generateText, generateImage };
