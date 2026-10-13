// src/config.js
// Guarda e lê a configuração do usuário em ~/.gemini-code/config.json
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const ConfigManager = require('../config-manager');

const HOME_DIR = path.join(os.homedir(), '.gemini-code');
const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
const MCP_PATH = path.join(HOME_DIR, 'mcp.json');
const SKILLS_DIR = path.join(HOME_DIR, 'skills');
const AGENTS_DIR = path.join(HOME_DIR, 'agents');
const WORKFLOWS_DIR = path.join(HOME_DIR, 'workflows');
const HISTORY_DIR = path.join(HOME_DIR, 'history');
const HOOKS_PATH = path.join(HOME_DIR, 'hooks.json');
const COWORK_TOKEN_PATH = path.join(HOME_DIR, 'cowork-token.txt');
const ROUTINE_API_TOKEN_PATH = path.join(HOME_DIR, 'routine-api-token.txt');
const TRUST_PATH = path.join(HOME_DIR, 'confianca.json'); // v0.41.0: src/trust.js

// Arquivos que o modelo nunca pode gravar sozinho (write_file/edit_file) e que
// forçam confirmação no run_shell. Cada um, se reescrito, dá ao modelo mais
// poder do que ele já tem: config.json desliga confirmShell; mcp.json e
// hooks.json definem comandos que rodam sem confirmação; os tokens liberam o
// agente para quem estiver na rede. O .bak é restaurado automaticamente se o
// config.json sumir (ver config-manager.js). confianca.json decide se instruções
// de um repositório entram no prompt (o modelo não pode se dar confiança).
const PROTECTED_PATHS = Object.freeze([
  CONFIG_PATH,
  `${CONFIG_PATH}.bak`,
  `${CONFIG_PATH}.tmp`,
  MCP_PATH,
  HOOKS_PATH,
  COWORK_TOKEN_PATH,
  ROUTINE_API_TOKEN_PATH,
  TRUST_PATH,
]);

// v0.41.0: destes o modelo nem LÊ (read_file, search_files, read_skill): guardam a API
// key em texto puro, segredos de servidores MCP ou tokens que dão o agente inteiro pela
// rede. Antes a sessão de convidado lia o cowork-token.txt e virava dona pelo cowork.
const SECRET_PATHS = Object.freeze([
  CONFIG_PATH,
  `${CONFIG_PATH}.bak`,
  `${CONFIG_PATH}.tmp`,
  MCP_PATH,
  COWORK_TOKEN_PATH,
  ROUTINE_API_TOKEN_PATH,
]);

// Versão do formato do config.json. v2: config parou de gravar todos os padrões
// em disco (ver migrarConfig). v3: 'gemini-2.5-flash' também virou padrão
// antigo (404 "no longer available to new users"). v4: o mesmo vale pro
// `fastModel` gravado em disco (usado por "design").
const CONFIG_VERSION = 5;

const DEFAULT_CONFIG = {
  apiKey: process.env.GEMINI_API_KEY || '',
  // Padrão precisa funcionar pra quem NÃO tem billing (o caso comum) e pra
  // contas novas. Histórico de padrões que quebraram: 'gemini-3.1-pro-preview'
  // (sem tier gratuito, 429 "limit: 0"); 'gemini-2.5-pro' (só pago desde
  // abr/2026, segundo fontes públicas); 'gemini-2.5-flash' (404: "no longer
  // available to new users", o próprio Google manda migrar pro 3.6 Flash).
  // Quem quiser um modelo "pro": gemini-code config set-model NOME
  model: 'gemini-3.6-flash',
  fastModel: 'gemini-3.6-flash',
  // Modelo reserva usado se o principal ficar indisponível (503). Vazio = desligado.
  // Descubra os nomes válidos pra sua chave com: gemini-code models
  fallbackModel: '',
  imageModel: 'gemini-2.5-flash-image',
  confirmShell: true,
  // v0.41.0: regras FERRAMENTA(PADRÃO); "negar" bloqueia sempre, "permitir" dispensa a confirmação de
  // comandos simples do run_shell. Ver src/permissions.js e "gemini-code config regras".
  permissoes: { permitir: [], negar: [] },
  // v0.41.0: 'perguntar' = o chat pergunta uma vez por pasta se confia nas instruções do projeto
  // (AGENTS.md, CLAUDE.md...); 'sempre' = carrega sem perguntar (comportamento antigo). Ver src/trust.js.
  confiancaProjeto: 'perguntar',
  shellTimeoutMs: 120000,
  coworkPort: 8765,
  // Item 4 da revisão: streaming da resposta de texto (via SSE) em modos
  // interativos, pra não deixar o usuário olhando o cursor parado 10-30s.
  // Desative com "gemini-code config show" + editar config.json se preferir
  // o comportamento antigo (resposta só sai inteira no final).
  enableStreaming: true,
  // Permite usar o modelo local automaticamente quando a chave online não foi configurada.
  codeIaAuto: true,
  // Fotos automáticas do projeto (git, referência escondida) a cada turno do chat — ver src/snapshots.js. Desligue com false.
  autoGit: true,
  // --- Custo (v0.15.0) ---
  // maxTokensSessao: teto de tokens do Gemini por sessão do chat/processo (0 = sem limite). Local não conta.
  maxTokensSessao: 0,
  // esperarCotaSegundos (v0.30.0): se o Gemini responder 429 pedindo para aguardar até N segundos (cota por minuto), espera e repete UMA vez. 0 = desligado (padrão). Máx. 300.
  esperarCotaSegundos: 0,
  // confirmarEscrita: true liga o /passo já ao abrir o chat (prévia + s/n/t antes de cada write_file/edit_file). Ver src/stepApproval.js.
  confirmarEscrita: false,
  // autoCompactTokens: no chat, se o contexto da última chamada passou disso, roda /compact sozinho (grátis) antes do próximo turno. 0 desliga.
  autoCompactTokens: 60000,
  // v0.41.0: dentro de um pedido longo (muitas ferramentas seguidas), acima disto (caracteres do histórico)
  // os resultados de ferramenta antigos viram um aviso curto; os 6 mais recentes ficam inteiros. 0 desliga.
  contextoMaxChars: 300000,
  // --- Modelos locais/online ---
  // 'hybrid' usa llama.cpp local e, se houver chave, Gemini para pedidos mais complexos.
  // O local funciona sem internet depois de baixar um GGUF. Não requer Ollama.
  provider: 'hybrid',
  // v0.39.0: modo solo — o code-ia roda sozinho, sem nenhuma outra IA por trás (ver src/solo.js). Liga com: gemini-code solo on
  modoSolo: false,
  llamaCppUrl: 'http://127.0.0.1:8080',
  llamaCppModel: 'local-model',
  // Caminho opcional para um GGUF local. Vazio mantém a localização histórica.
  llamaCppModelPath: '',
  llamaCppTemperature: 0.4,
  llamaCppMaxTokens: 1024,
  // v0.37.0: tamanho de contexto do llama-server (tokens). DEVE bater com o --ctx-size do servidor (android/start-llama-server.sh usa 4096).
  llamaCppCtx: 4096,
  // v0.37.0: tempo máximo (ms) sem receber NENHUM dado do llama-server antes de desistir (celular lento no 1º token).
  llamaCppTimeoutMs: 180000,
  // v0.37.0: se o servidor local estiver desligado, sobe sozinho (só vale para endereço local). `gemini-code llamacpp start` faz à mão.
  llamaCppAutoStart: false,
  // Compatibilidade: opcionalmente ainda aceita uma instalação Ollama antiga.
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3:4b-instruct',
  ollamaNumCtx: 8192,
  ollamaKeepAlive: '10m',
  ollamaTemperature: 0.6,
  hybridComplexityChars: 600, // pedido maior que isso vai pra nuvem no modo hybrid
  // --- v0.41.0: API compatível com OpenAI COM chave (OpenRouter, OpenAI, DeepSeek, Groq...) ---
  // Para usar os mesmos modelos fortes dos outros agentes. provider 'openai' usa sempre; hybridCloud 'openai'
  // usa no lugar do Gemini como lado nuvem do modo hybrid. A chave fica aqui (0600, ilegível pelo modelo) ou
  // em GEMINI_CODE_OPENAI_KEY.
  openaiBaseUrl: 'https://openrouter.ai/api/v1',
  openaiModel: '',
  openaiApiKey: '',
  openaiCtx: 128000, // contexto do modelo escolhido (tokens); só acima disso o histórico é podado
  openaiMaxTokens: 8192,
  hybridCloud: 'gemini',
  // --- v0.41.0: web_fetch ---
  confirmWeb: true, // pergunta antes de cada acesso; domínios abaixo não perguntam
  webDominiosPermitidos: [],
  // Orçamento (em caracteres) do conhecimento fixo injetado no prompt — ver src/knowledge.js
  knowledgeMaxChars: 10000,
};

// Padrões antigos de `model` que versões anteriores gravaram em disco.
const MODELOS_PADRAO_ANTIGOS = ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'];
const FAST_MODELOS_PADRAO_ANTIGOS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

/**
 * Bug (set/2026): na primeira execução o config gravava o objeto DEFAULT_CONFIG
 * inteiro em ~/.gemini-code/config.json, e loadConfig() faz
 * { ...DEFAULT_CONFIG, ...onDisk } — o que está no disco sempre vence. Então
 * qualquer mudança de padrão no código (ex.: trocar o modelo que dava 429)
 * NUNCA chegava a quem já tinha rodado uma versão antiga: continuava com o
 * modelo velho pra sempre, tomando 429/"sem cota" mesmo com crédito.
 *
 * Migração (roda uma vez por versão, config com configVersion < atual): se `model` ainda é
 * um padrão antigo, some do arquivo pra voltar a valer o padrão atual.
 * Retorna { config, mudou, avisos }.
 */
function migrarConfig(onDisk) {
  if ((onDisk.configVersion || 1) >= CONFIG_VERSION) {
    return { config: onDisk, mudou: false, avisos: [] };
  }
  const config = { ...onDisk, configVersion: CONFIG_VERSION };
  const avisos = [];
  if (MODELOS_PADRAO_ANTIGOS.includes(config.model)) {
    avisos.push(
      `[config] O modelo '${config.model}' era um padrão antigo gravado no seu config; ` +
      `agora usando '${DEFAULT_CONFIG.model}'. Pra escolher outro: gemini-code config set-model NOME`
    );
    delete config.model;
  }
  if (FAST_MODELOS_PADRAO_ANTIGOS.includes(config.fastModel)) {
    avisos.push(
      `[config] O fastModel '${config.fastModel}' era um padrão antigo gravado no seu config; ` +
      `agora usando '${DEFAULT_CONFIG.fastModel}'. Pra escolher outro: gemini-code config set-fast-model NOME`
    );
    delete config.fastModel;
  }
  if (Number(onDisk.configVersion || 1) < 5 && config.provider === 'ollama') {
    config.provider = 'hybrid';
    avisos.push('[config] Provedor local migrado de Ollama para llama.cpp/hybrid; veja ANDROID_TERMUX.md.');
  }
  return { config, mudou: true, avisos };
}

const configManager = new ConfigManager(CONFIG_PATH);

function ensureDirs() {
  // 0o700 só vale para pasta criada agora; guarda chave de API e tokens.
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  for (const dir of [SKILLS_DIR, AGENTS_DIR, WORKFLOWS_DIR, HISTORY_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Item 5 do pedido de segurança (set/2026): se a apiKey estiver trancada
// (ver src/security.js), o config em disco NÃO tem mais o campo `apiKey` em
// texto puro — só `apiKeyLocked` (criptografado). Quem chama loadConfig()
// continua recebendo `apiKey` normalmente (todo o resto do código não
// precisa saber que existe um cadeado), mas só depois de um `unlock` bem
// sucedido nesta mesma sessão; sem isso, `apiKey` vem vazio, igual a quando
// nunca foi configurada.
function aplicarSessaoDesbloqueada(cfg) {
  if (cfg.apiKeyLocked && !cfg.apiKey) {
    try {
      // eslint-disable-next-line global-require
      const { getSessionApiKey } = require('./security'); // lazy: evita ciclo com security.js
      const sessao = getSessionApiKey();
      if (sessao) return { ...cfg, apiKey: sessao };
    } catch { /* security.js indisponível: segue sem apiKey, mesmo comportamento de antes */ }
  }
  return cfg;
}

function loadConfig() {
  ensureDirs();
  const onDisk = configManager.load();
  if (onDisk) {
    const { config, mudou, avisos } = migrarConfig(onDisk);
    if (mudou) {
      for (const aviso of avisos) console.error(aviso);
      try { configManager.save(config); } catch { /* segue com o config em memória */ }
    }
    return aplicarSessaoDesbloqueada({ ...DEFAULT_CONFIG, ...config });
  }
  // nem principal nem backup existiam/eram válidos: cria do zero. Só grava o
  // que é do usuário (chave via env, se houver) — NÃO os padrões, senão eles
  // ficam congelados em disco (ver migrarConfig).
  const inicial = { configVersion: CONFIG_VERSION };
  if (process.env.GEMINI_API_KEY) inicial.apiKey = process.env.GEMINI_API_KEY;
  configManager.save(inicial);
  return aplicarSessaoDesbloqueada({ ...DEFAULT_CONFIG, ...inicial });
}

// v0.3.10: saveConfig mesclava em cima de loadConfig(), que devolve (1) todos os
// padrões e (2) a apiKey já DESTRANCADA da sessão. Consequências reais:
//  - depois de unlock(), qualquer saveConfig (ex.: setGuestPassphrase) gravava a
//    chave em TEXTO PURO no config.json, anulando o cadeado;
//  - todo `config set-*` congelava os ~20 padrões em disco, recriando o bug de
//    "padrão antigo preso" que migrarConfig existe para curar.
// Agora a mescla parte só do que o usuário já tem gravado.
function saveConfig(partial) {
  loadConfig(); // cria/migra o arquivo se preciso
  const noDisco = configManager.load() || { configVersion: CONFIG_VERSION };
  const merged = { ...noDisco, ...partial };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  configManager.save(merged);
  return aplicarSessaoDesbloqueada({ ...DEFAULT_CONFIG, ...merged });
}

function loadMcpServers() {
  if (!fs.existsSync(MCP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MCP_PATH, 'utf8')).mcpServers || {};
  } catch {
    return {};
  }
}

module.exports = {
  HOME_DIR,
  CONFIG_PATH,
  MCP_PATH,
  SKILLS_DIR,
  AGENTS_DIR,
  WORKFLOWS_DIR,
  HISTORY_DIR,
  HOOKS_PATH,
  COWORK_TOKEN_PATH,
  ROUTINE_API_TOKEN_PATH,
  TRUST_PATH,
  PROTECTED_PATHS,
  SECRET_PATHS,
  DEFAULT_CONFIG,
  CONFIG_VERSION,
  migrarConfig,
  ensureDirs,
  loadConfig,
  saveConfig,
  loadMcpServers,
};
