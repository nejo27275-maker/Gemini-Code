// src/security.js
// Pedido do usuário (set/2026): a apiKey do Gemini ficava em TEXTO PURO em
// ~/.gemini-code/config.json. Quem tivesse acesso ao arquivo (celular
// destravado, backup, etc.) lia a chave direto, sem precisar de mais nada.
//
// Agora existe uma "chave de segurança" (passphrase) opcional:
// `gemini-code config set-passphrase` criptografa a apiKey já salva
// (AES-256-GCM, chave derivada da passphrase via scrypt com salt aleatório)
// e some com a versão em texto puro do config.json. Sem a passphrase
// correta, a apiKey NÃO dá pra recuperar — nem o próprio gemini-code
// consegue "resetar" ela, só reconfigurar uma nova com `config set-key`.
//
// A passphrase em si NUNCA é gravada em disco, nem em log (ver
// decisionLog.js — args de run_shell/etc não passam por aqui). Depois de um
// `unlock` bem-sucedido, a apiKey decriptada fica só em memória (variável
// deste módulo), válida enquanto o processo do gemini-code estiver rodando.
'use strict';

const crypto = require('crypto');

// Cache em memória da sessão atual — nunca persistido em disco.
let sessionApiKey = null;
let sessionRole = null; // 'owner' | 'guest' | null

// Ferramentas liberadas pra quem entra com a chave de convidado: só leitura
// e verificação, nada que escreva/apague arquivo, rode shell arbitrário ou
// alcance um MCP (potencial acesso a outro sistema). Lista deliberadamente
// curta — prefere pecar por menos acesso do que por mais.
const GUEST_ALLOWED_TOOLS = ['read_file', 'list_dir', 'search_files', 'read_skill', 'run_checks'];

function encriptar(textoPlano, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: dados.toString('hex'),
  };
}

// Lança se a passphrase estiver errada (a tag de autenticação do GCM não bate).
function decriptar(blob, passphrase) {
  const salt = Buffer.from(blob.salt, 'hex');
  const iv = Buffer.from(blob.iv, 'hex');
  const tag = Buffer.from(blob.tag, 'hex');
  const dados = Buffer.from(blob.data, 'hex');
  const chave = crypto.scryptSync(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  decipher.setAuthTag(tag);
  const textoPlano = Buffer.concat([decipher.update(dados), decipher.final()]);
  return textoPlano.toString('utf8');
}

function isLocked(cfg) {
  return !!(cfg && cfg.apiKeyLocked);
}

/**
 * Ativa a proteção: criptografa a apiKey atual do config com `passphrase` e
 * apaga a versão em texto puro do disco. Exige que já exista uma apiKey
 * configurada (não faz sentido trancar uma chave vazia) e que ainda não
 * esteja trancada (evita sobrescrever sem passar por unlock antes).
 */
function lock(passphrase) {
  const { loadConfig, saveConfig } = require('./config'); // lazy: evita ciclo com config.js
  const cfg = loadConfig();
  if (isLocked(cfg)) {
    throw new Error('Já existe uma chave de segurança definida. Use "config remove-passphrase" antes de trocar.');
  }
  if (!cfg.apiKey) {
    throw new Error('Nenhuma API key configurada ainda — rode "gemini-code config set-key SUA_CHAVE" primeiro.');
  }
  const blob = encriptar(cfg.apiKey, passphrase);
  saveConfig({ apiKeyLocked: blob, apiKey: '' });
  sessionApiKey = cfg.apiKey;
  return true;
}

/**
 * Tenta destrancar a sessão atual com `passphrase`. Testa primeiro contra a
 * chave mestra (dono, acesso total); se não bater e existir uma chave de
 * convidado configurada, testa contra ela também. Devolve true/false —
 * nunca lança, pra quem chama poder simplesmente checar o resultado e
 * pedir de novo em caso de erro de digitação. Depois de um unlock bem
 * sucedido, `getSessionRole()` diz qual das duas foi usada.
 */
function unlock(passphrase) {
  const { loadConfig } = require('./config');
  const cfg = loadConfig();
  if (!isLocked(cfg)) return true; // nada pra destrancar

  try {
    sessionApiKey = decriptar(cfg.apiKeyLocked, passphrase);
    sessionRole = 'owner';
    return true;
  } catch { /* não era a chave mestra — tenta a de convidado abaixo, se existir */ }

  if (cfg.apiKeyLockedGuest) {
    try {
      sessionApiKey = decriptar(cfg.apiKeyLockedGuest, passphrase);
      sessionRole = 'guest';
      return true;
    } catch { /* nenhuma das duas bateu */ }
  }
  return false;
}

/**
 * Define (ou troca) a chave de convidado. Exige a chave MESTRA correta —
 * não basta a sessão atual estar destrancada — pra confirmar de novo que
 * quem está mexendo nisso é o dono, mesmo que o processo já esteja aberto.
 * A mesma apiKey é reencriptada com `guestPassphrase`; a mestra continua
 * intacta.
 */
function setGuestPassphrase(ownerPassphrase, guestPassphrase) {
  const { loadConfig, saveConfig } = require('./config');
  const cfg = loadConfig();
  if (!isLocked(cfg)) {
    throw new Error('Defina a chave mestra primeiro, com "config set-passphrase".');
  }
  const apiKeyPlano = decriptar(cfg.apiKeyLocked, ownerPassphrase); // lança se a chave mestra estiver errada
  const blobConvidado = encriptar(apiKeyPlano, guestPassphrase);
  saveConfig({ apiKeyLockedGuest: blobConvidado });
  return true;
}

/** Remove a chave de convidado (exige a chave mestra correta). */
function removeGuestPassphrase(ownerPassphrase) {
  const { loadConfig, saveConfig } = require('./config');
  const cfg = loadConfig();
  if (!cfg.apiKeyLockedGuest) return true;
  decriptar(cfg.apiKeyLocked, ownerPassphrase); // só confirma que é o dono; lança se errada
  saveConfig({ apiKeyLockedGuest: undefined });
  return true;
}

function getSessionRole() {
  return sessionRole;
}

/**
 * Aplica a restrição de ferramentas da sessão de convidado sobre uma lista
 * de `allowedTools` pedida (ex.: por uma persona em agents/*.json). Sessão
 * de dono: devolve a lista original sem mexer (undefined = sem restrição,
 * comportamento de sempre). Sessão de convidado: se não havia lista, usa
 * GUEST_ALLOWED_TOOLS; se havia, faz a INTERSEÇÃO — uma persona não
 * consegue liberar mais ferramentas do que o convidado já tem direito.
 */
function restringirParaSessao(allowedTools) {
  if (sessionRole !== 'guest') return allowedTools;
  if (!allowedTools || !allowedTools.length) return GUEST_ALLOWED_TOOLS;
  return allowedTools.filter((t) => GUEST_ALLOWED_TOOLS.includes(t));
}

/**
 * Remove a proteção: exige a passphrase correta, decripta e volta a gravar
 * a apiKey em texto puro (comportamento de antes do lock).
 */
function removePassphrase(passphrase) {
  const { loadConfig, saveConfig } = require('./config');
  const cfg = loadConfig();
  if (!isLocked(cfg)) return true;
  const textoPlano = decriptar(cfg.apiKeyLocked, passphrase); // lança se a passphrase estiver errada
  // Remove a chave mestra E a de convidado juntas — sem a mestra, a de
  // convidado (que só faz sentido como um "acesso menor" dentro do mesmo
  // esquema trancado) fica órfã e sem propósito.
  saveConfig({ apiKey: textoPlano, apiKeyLocked: undefined, apiKeyLockedGuest: undefined });
  sessionApiKey = null;
  sessionRole = null;
  return true;
}

function getSessionApiKey() {
  return sessionApiKey;
}

/** Limpa a chave decriptada da memória (uso: testes, ou trocar de usuário no mesmo processo). */
function clearSession() {
  sessionApiKey = null;
  sessionRole = null;
}

/** Mascara uma string sensível pra exibição (ex.: "config show") — mostra só os 4 últimos caracteres. */
function mascarar(texto) {
  if (!texto) return texto;
  // Chave com 4 caracteres ou menos: mostrar os "últimos 4" seria mostrar
  // ela inteira, que é o oposto do propósito de mascarar. Nesse caso, some
  // com tudo.
  if (texto.length <= 4) return '*'.repeat(texto.length);
  const visiveis = texto.slice(-4);
  return '*'.repeat(texto.length - 4) + visiveis;
}

module.exports = {
  isLocked,
  lock,
  unlock,
  removePassphrase,
  setGuestPassphrase,
  removeGuestPassphrase,
  getSessionApiKey,
  getSessionRole,
  restringirParaSessao,
  clearSession,
  mascarar,
  encriptar,
  decriptar,
  GUEST_ALLOWED_TOOLS,
};
