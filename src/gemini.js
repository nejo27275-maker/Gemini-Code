// src/gemini.js
// Wrapper fino sobre @google/generative-ai, para não espalhar detalhes da SDK
// pelo resto do código.
'use strict';

const { loadConfig } = require('./config');
const usage = require('./usage');

function exigirApiKey(cfg) {
  if (!cfg.apiKey) {
    throw new Error(
      'Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE\n' +
      'Pegue uma chave grátis em https://aistudio.google.com/apikey'
    );
  }
}


// Erros transitórios do servidor do Google (ex.: 503 "high demand", visto no
// Termux com gemini-3.6-flash). Não são falha da conta nem do código: tentar
// de novo depois de alguns segundos costuma resolver.
const STATUS_TRANSITORIOS = new Set([500, 502, 503, 504]);
const ESPERAS_RETRY_MS = [2000, 5000, 10000, 20000];
// Só pra testes: GEMINI_CODE_RETRY_MS="0,0" zera as esperas.
function esperasPadrao() {
  const env = process.env.GEMINI_CODE_RETRY_MS;
  if (env !== undefined && env !== '') return env.split(',').map((n) => Number(n) || 0);
  return ESPERAS_RETRY_MS;
}

// v0.30.0: espera opcional para o 429 de cota POR MINUTO. Desligada por padrão (0), porque repetir sozinho
// gasta cota sem você ver. Ligue com `esperarCotaSegundos` na config (ex.: 60) ou GEMINI_CODE_WAIT429=60:
// se o Google disser "tente em Ns" com N <= esse teto, espera N+1s (com aviso) e repete UMA vez.
// Nunca repete "limit: 0" (o modelo não tem cota nesse projeto) nem 429 sem tempo informado.
function teto429Padrao() {
  const env = process.env.GEMINI_CODE_WAIT429;
  let v = env !== undefined && env !== '' ? Number(env) : NaN;
  if (!Number.isFinite(v)) { try { v = Number(loadConfig().esperarCotaSegundos); } catch { v = 0; } }
  return Number.isFinite(v) && v > 0 ? Math.min(v, 300) : 0;
}

async function esperaDo429(res, max) {
  if (!(max > 0) || typeof res.clone !== 'function') return null;
  let data = null;
  try { data = await res.clone().json(); } catch { /* corpo ilegível: sem tempo informado */ }
  const msg = String(data?.error?.message || '');
  if (/limit:\s*0\b/i.test(msg)) return null;
  const s = extrairRetryDepois(data, res.headers?.get?.('retry-after'));
  if (s == null || s > max) return null;
  return Math.ceil(s) + 1;
}

async function fetchComRetry(url, init, opts = {}) {
  const esperas = opts.esperas || esperasPadrao();
  const aviso = opts.aviso || ((m) => console.error(m));
  const dormir = opts.dormir || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const max429 = opts.esperar429Max !== undefined ? opts.esperar429Max : teto429Padrao();
  let usou429 = false;
  for (let i = 0; ; i++) {
    let motivo;
    try {
      const res = await fetch(url, init);
      if (res.status === 429 && !usou429) {
        const seg = await esperaDo429(res, max429);
        if (seg != null) {
          usou429 = true;
          try { await res.body?.cancel?.(); } catch { /* ignora */ }
          aviso(`[gemini] cota por minuto atingida. Esperando ${seg}s e repetindo uma vez (esperarCotaSegundos=${max429})...`);
          await dormir(seg * 1000);
          i--; // não gasta tentativa do retry de servidor
          continue;
        }
      }
      if (!STATUS_TRANSITORIOS.has(res.status) || i >= esperas.length) return res;
      motivo = `HTTP ${res.status}`;
      try { await res.body?.cancel?.(); } catch { /* ignora */ }
    } catch (err) {
      // erro de rede (sem internet, DNS...): só 1 nova tentativa, pra não
      // deixar o usuário esperando à toa quando está offline de verdade.
      if (i >= Math.min(1, esperas.length)) throw err;
      motivo = `falha de rede: ${err.message}`;
    }
    aviso(`[gemini] servidor indisponível (${motivo}). Tentando de novo em ${esperas[i] / 1000}s (${i + 1}/${esperas.length})...`);
    await dormir(esperas[i]);
  }
}

/**
 * Monta o Error de uma resposta HTTP de erro da API. Antes, toda falha saía
 * com o texto fixo "[NNN Bad Request]" (mesmo em 429/403/404), e o 429 vinha
 * com a mensagem crua do Google ("You exceeded your current quota, please
 * check your plan and billing details") — que parece "sem crédito" mesmo
 * quando a conta TEM crédito. Na prática o 429 quase sempre é cota do
 * PROJETO da chave para aquele MODELO (ex.: "limit: 0" = o modelo não tem
 * tier gratuito nesse projeto), não saldo. Aqui explicamos isso e mantemos a
 * mensagem original da API no fim, pra não esconder nada.
 */
function duracaoEmSegundos(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor;
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  // Respostas da API Google costumam usar a duração protobuf, por exemplo "52.38s".
  const protobuf = texto.match(/^(\d+(?:\.\d+)?)s$/i);
  if (protobuf) return Number(protobuf[1]);
  // O cabeçalho HTTP Retry-After também pode ser um número de segundos.
  if (/^\d+(?:\.\d+)?$/.test(texto)) return Number(texto);
  const data = Date.parse(texto);
  if (Number.isFinite(data)) return Math.max(0, (data - Date.now()) / 1000);
  return null;
}

function extrairRetryDepois(data, retryAfter) {
  const detalhes = data?.error?.details;
  if (Array.isArray(detalhes)) {
    for (const detalhe of detalhes) {
      const tipo = String(detalhe?.['@type'] || '');
      if (tipo.endsWith('.RetryInfo') || detalhe?.retryDelay != null) {
        const segundos = duracaoEmSegundos(detalhe.retryDelay);
        if (segundos != null) return segundos;
      }
    }
  }
  const doCabecalho = duracaoEmSegundos(retryAfter);
  if (doCabecalho != null) return doCabecalho;
  const msg = String(data?.error?.message || '');
  const naMensagem = msg.match(/(?:please\s+)?retry\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  return naMensagem ? Number(naMensagem[1]) : null;
}

function erroDaApi({ status, data, statusText, model, contexto, retryAfter }) {
  const msgOriginal = data?.error?.message || (data && Object.keys(data).length ? JSON.stringify(data) : '') || statusText || '';
  const statusApi = data?.error?.status || '';
  const cabecalho = `[Gemini] ${contexto} (HTTP ${status}${statusApi ? ' ' + statusApi : ''}, modelo ${model})`;

  if (status === 429 || statusApi === 'RESOURCE_EXHAUSTED') {
    const limiteZero = msgOriginal.match(/limit:\s*0\b/i);
    const limiteMatch = msgOriginal.match(/limit:\s*(\d+)\b/i);
    const metricMatch = msgOriginal.match(/(?:metric|quotaMetric):\s*([^\s,]+)/i);
    const modeloMatch = msgOriginal.match(/model:\s*([^\s,]+)/i);
    const retrySeconds = extrairRetryDepois(data, retryAfter);
    const waitSeconds = retrySeconds == null ? null : Math.ceil(retrySeconds);
    let orientacao;

    if (limiteZero) {
      orientacao =
        `O Google informou limit: 0 para esta cota; esse modelo/operação não tem requisições liberadas nessa métrica para o projeto atual.\n` +
        `Não adianta repetir imediatamente. Para continuar usando somente a API Gemini, consulte os modelos e as cotas da sua chave; se escolher outro modelo Gemini, configure-o com: gemini-code config set-model NOME_DO_MODELO\n`;
    } else if (waitSeconds != null) {
      orientacao =
        `O Google pediu para aguardar aproximadamente ${waitSeconds} segundo(s) antes de tentar novamente. Aguarde esse tempo e envie a mensagem novamente.\n` +
        `A Gemini Code NÃO repetiu a chamada automaticamente, para evitar consumir mais cota ou gerar tentativas em sequência. Se voltar a falhar, a cota pode ser por minuto, por dia ou específica do projeto/modelo.\n`;
    } else {
      orientacao =
        `A cota de requisições foi excedida. A resposta não informou um tempo seguro para tentar novamente; não repita em sequência. Confira uso e limites do projeto/chave no Google AI Studio.\n`;
    }

    const detalhesQuota = [
      metricMatch ? `Métrica: ${metricMatch[1]}` : '',
      limiteMatch ? `limite informado: ${limiteMatch[1]}` : '',
      modeloMatch ? `modelo informado pela API: ${modeloMatch[1]}` : '',
    ].filter(Boolean).join('; ');
    const e = new Error(
      `${cabecalho}: limite de uso da API Gemini atingido.\n` +
      orientacao +
      (detalhesQuota ? `Detalhes da cota: ${detalhesQuota}.\n` : '') +
      `Consulte https://ai.google.dev/gemini-api/docs/rate-limits e https://aistudio.google.com/ para verificar os limites do projeto.\n` +
      `Mensagem original: ${msgOriginal}`
    );
    e.status = status;
    e.quotaExceeded = true;
    if (waitSeconds != null) e.retryAfterSeconds = waitSeconds;
    if (metricMatch) e.quotaMetric = metricMatch[1];
    return e;
  }
  if (STATUS_TRANSITORIOS.has(status)) {
    const err = new Error(
      `${cabecalho}: servidor do Google indisponível ou sobrecarregado — é temporário e NÃO é problema da sua conta.\n` +
      `Já tentei ${esperasPadrao().length} vezes com espera. Aguarde um minuto e mande de novo (ou troque de modelo com /model NOME).\n` +
      `Mensagem original: ${msgOriginal}`
    );
    err.transitorio = true; // usado pelo fallbackModel (chatWithTools)
    return err;
  }
  if (status === 401 || status === 403) {
    return new Error(`${cabecalho}: chave recusada ou sem permissão. Confira a chave (gemini-code config set-key) e se a API Gemini está habilitada no projeto.\nMensagem original: ${msgOriginal}`);
  }
  if (status === 404) {
    return new Error(`${cabecalho}: modelo não encontrado ou não disponível pra contas novas (o Google desativa modelos antigos). Troque: gemini-code config set-model gemini-3.6-flash\nMensagem original: ${msgOriginal}`);
  }
  return new Error(`${cabecalho}: ${msgOriginal}`);
}

/**
 * Resposta 200 mas sem nenhum "part" (bloqueio de segurança, MAX_TOKENS, etc.).
 * Antes isso virava silêncio: o chat imprimia "gemini-code>" e mais nada, sem
 * erro. Agora vira um erro que diz o motivo, se a API informou.
 */
function erroRespostaVazia({ bloqueio, finishReason, model }) {
  const motivo = bloqueio
    ? `bloqueada pelo filtro (blockReason: ${bloqueio})`
    : finishReason
      ? `sem conteúdo (finishReason: ${finishReason})`
      : 'vazia (a API não mandou nenhum conteúdo)';
  return new Error(
    `[Gemini] O modelo ${model} devolveu resposta ${motivo}. ` +
    'Tente de novo ou troque de modelo: gemini-code config set-model NOME'
  );
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
// Monta o objeto de resposta compatível com o que agent.js já espera
// (response.text(), response.functionCalls() e response.rawParts()) a
// partir de uma lista de "parts" já acumulada (streaming ou não).
function respostaDePartes(parts) {
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
    // reconstruir esse objeto à mão jogava esses campos fora e quebrava o
    // turno seguinte).
    rawParts: () => parts,
  };
}

function montarBody({ history, tools, systemInstruction }) {
  return {
    contents: history,
    ...(tools && tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
  };
}

/**
 * Chama o modelo com histórico de mensagens + definição de ferramentas
 * (function calling), no formato usado pelo agente (agent.js).
 *
 * Item 4 da revisão (set/2026): antes só existia a chamada não-streaming —
 * com respostas de 10-30s (comuns no Gemini 3.1 Pro), o usuário ficava
 * olhando o cursor parado o tempo todo. Agora, se um callback `onText` for
 * passado, usamos o endpoint `:streamGenerateContent?alt=sse` e chamamos
 * `onText(pedaço)` conforme o texto vai chegando, mantendo o parse de
 * functionCall (que só vem completo, nunca em pedaços) para o final do
 * stream. Sem `onText`, o comportamento é idêntico ao de antes (uma
 * requisição, uma resposta completa) — usado por chamadas não-interativas
 * (workflows, cowork server, voice listen) onde não há pra quem imprimir.
 */
async function chatWithTools(args) {
  const cfg = loadConfig();
  if (!cfg.apiKey) exigirApiKey(cfg);
  const modelo = args.modelName || cfg.model;

  // Se o usuário definiu um modelo reserva (gemini-code config set-fallback-model)
  // e o principal segue indisponível (503/500...) depois dos retries, tenta o
  // reserva UMA vez — mas só se nada foi impresso ainda (senão duplicaria texto).
  let emitiu = false;
  const onText = args.onText ? (t) => { emitiu = true; args.onText(t); } : undefined;
  try {
    return await chatUmModelo({ ...args, modelName: modelo, onText }, cfg);
  } catch (err) {
    const reserva = cfg.fallbackModel;
    if (err && err.transitorio && reserva && reserva !== modelo && !emitiu) {
      console.error(`[gemini] ${modelo} continua indisponível; tentando o modelo reserva ${reserva}.`);
      return chatUmModelo({ ...args, modelName: reserva, onText }, cfg);
    }
    throw err;
  }
}

async function chatUmModelo({ modelName, systemInstruction, history, tools, onText }, cfg) {
  if (!cfg.apiKey) {
    throw new Error(
      'Nenhuma API key configurada. Rode: gemini-code config set-key SUA_CHAVE\n' +
      'Pegue uma chave grátis em https://aistudio.google.com/apikey'
    );
  }

  const model = modelName || cfg.model;
  const body = montarBody({ history, tools, systemInstruction });

  if (onText && cfg.enableStreaming !== false) {
    return chatWithToolsStream({ model, body, apiKey: cfg.apiKey, onText });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetchComRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw erroDaApi({ status: res.status, data, statusText: res.statusText, retryAfter: res.headers?.get?.('retry-after'), model, contexto: 'Erro ao chamar o modelo' });
  }

  usage.registrar({ modelo: model, uso: data?.usageMetadata });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  if (!parts.length) {
    throw erroRespostaVazia({
      bloqueio: data?.promptFeedback?.blockReason,
      finishReason: data?.candidates?.[0]?.finishReason,
      model,
    });
  }
  return respostaDePartes(parts);
}

/**
 * Versão em streaming (SSE) de chatWithTools. O endpoint manda vários
 * eventos "data: {...}" separados por linha em branco (CRLF ou LF), cada um com um pedaço da resposta no mesmo
 * formato de `candidates[0].content.parts`. Concatenamos os `text` de cada
 * pedaço chamando `onText` incrementalmente, e juntamos as `functionCall`
 * (que vêm inteiras num único pedaço, nunca fatiadas) para o final.
 */
async function chatWithToolsStream({ model, body, apiKey, onText }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const res = await fetchComRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw erroDaApi({ status: res.status, data: errData, statusText: res.statusText, retryAfter: res.headers?.get?.('retry-after'), model, contexto: 'Erro ao chamar o modelo (streaming)' });
  }

  const todasPartes = [];
  let buffer = '';
  let bloqueio;
  let finishReason;
  let uso;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf8');

  // Processa UM evento SSE já inteiro (as linhas "data: ..." dele).
  const processarEvento = (evento) => {
    const dados = evento
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!dados || dados === '[DONE]') return;
    let chunk;
    try {
      chunk = JSON.parse(dados);
    } catch {
      return; // evento malformado — ignora
    }
    if (chunk?.error) {
      throw erroDaApi({
        status: chunk.error.code || 500,
        data: chunk,
        model,
        contexto: 'Erro ao chamar o modelo (streaming)',
      });
    }
    if (chunk?.usageMetadata) uso = chunk.usageMetadata; // o último evento traz o total
    if (chunk?.promptFeedback?.blockReason) bloqueio = chunk.promptFeedback.blockReason;
    const cand = chunk?.candidates?.[0];
    if (cand?.finishReason) finishReason = cand.finishReason;
    for (const p of cand?.content?.parts || []) {
      todasPartes.push(p);
      if (typeof p.text === 'string' && p.text) onText(p.text);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Bug real (testado no Termux, set/2026): o Google separa os eventos SSE
    // com "\r\n\r\n", não "\n\n". Procurando só "\n\n" o parser nunca achava
    // o fim de nenhum evento: o chat respondia em branco, sem erro. Normaliza
    // CRLF -> LF no buffer inteiro a cada leitura (assim um "\r" que chegou no
    // fim de um pedaço e o "\n" no começo do próximo também se juntam).
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');

    // Cada evento SSE é separado por linha em branco.
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const evento = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processarEvento(evento);
    }
  }

  // Resto que ficou no buffer (último evento sem linha em branco no final).
  buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
  if (buffer.trim()) processarEvento(buffer);

  usage.registrar({ modelo: model, uso });
  if (!todasPartes.length) throw erroRespostaVazia({ bloqueio, finishReason, model });
  return respostaDePartes(todasPartes);
}

/**
 * Chamada simples de texto, sem ferramentas (usada por design/media
 * helpers). Item 14 da revisão (set/2026): migrado de @google/generative-ai
 * (lib arquivada pelo Google, sem mais atualizações — e já tínhamos
 * abandonado ela para chatWithTools por causa do bug de role "function")
 * para `fetch` direto na API REST, igual chatWithTools já fazia. Assim dá
 * pra remover a dependência de vez — o projeto fica só com `ws` e `chalk`.
 */
async function generateText({ prompt, modelName }) {
  const cfg = loadConfig();
  exigirApiKey(cfg);
  const model = modelName || cfg.fastModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetchComRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey,
    },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw erroDaApi({ status: res.status, data, statusText: res.statusText, retryAfter: res.headers?.get?.('retry-after'), model, contexto: 'Erro ao gerar texto' });
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/**
 * Geração de imagem. Depende do modelo de imagem estar habilitado na conta
 * do Google AI Studio / Vertex ligada à sua API key. Se não estiver, a API
 * retorna erro claro — trate isso na camada de cima. Migrada para `fetch`
 * pelo mesmo motivo de generateText (item 14 da revisão).
 */
async function generateImage({ prompt, modelName }) {
  const cfg = loadConfig();
  exigirApiKey(cfg);
  const model = modelName || cfg.imageModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetchComRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cfg.apiKey,
    },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw erroDaApi({ status: res.status, data, statusText: res.statusText, retryAfter: res.headers?.get?.('retry-after'), model, contexto: 'Erro ao gerar imagem' });
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) {
    throw new Error(
      'O modelo não retornou imagem. Verifique se sua conta tem acesso a geração ' +
      'de imagem (Imagen/Gemini image) no Google AI Studio.'
    );
  }
  return imagePart.inlineData; // { mimeType, data (base64) }
}

/**
 * Lista os modelos que a SUA chave realmente pode usar pra gerar texto. Existe
 * porque o Google desativa/restringe modelos sem aviso (ex.: 404 "no longer
 * available to new users") — em vez de adivinhar nomes, pergunta pra API.
 */
async function listarModelos() {
  const cfg = loadConfig();
  exigirApiKey(cfg);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
  const res = await fetchComRetry(url, { headers: { 'x-goog-api-key': cfg.apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw erroDaApi({ status: res.status, data, statusText: res.statusText, retryAfter: res.headers?.get?.('retry-after'), model: '(lista de modelos)', contexto: 'Erro ao listar modelos' });
  }
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name))
    .map((m) => ({ name: m.name.replace(/^models\//, ''), displayName: m.displayName || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { chatWithTools, generateText, generateImage, erroDaApi, fetchComRetry, listarModelos, respostaDePartes };
