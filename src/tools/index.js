// src/tools/index.js
'use strict';

const fileTools = require('./fileTools');
// v0.41.0: edição atômica em vários arquivos, busca por nome (glob) e leitura de páginas web.
const multiEditTools = require('./multiEditTools');
const globTools = require('./globTools');
const webTools = require('./webTools');
const shellTools = require('./shellTools');
// v0.43.0: controlar aparelhos Android do usuário (TV, celular) por adb.
const adbTools = require('./adbTools');
// v0.44.0: navegador de verdade (Chrome/Chromium sem janela) controlado pelo agente.
const browserTools = require('./browserTools');
const searchTools = require('./searchTools');
const checkTools = require('./checkTools');
const mcpClient = require('./mcpClient');
const subagent = require('../subagent');
const skillLoader = require('../skills/loader');
const todoTools = require('./todoTools');
const workflowTools = require('./workflowTools');
// v0.42.0: memória e base de conhecimento dos agentes pessoais (só aparecem numa conversa com um deles).
const personalTools = require('./personalTools');

// v0.41.0: lista VAZIA significa "nenhuma ferramenta"; só a AUSÊNCIA de lista
// (undefined/null) libera todas. Antes `[]` liberava tudo: um passo de workflow
// com `tools: []` rodado por `gemini-code agent run` recebia write_file e run_shell.
const semRestricao = (allowedNames) => allowedNames == null;

/**
 * @param {string[]} [allowedNames] Se informado, só devolve as ferramentas
 *   cujo nome está nessa lista (usado pelos agentes/personas de agents/*.json,
 *   campo "allowedTools"); `[]` = nenhuma. Sem lista, devolve todas.
 */
async function getAllDeclarations(allowedNames) {
  // Evita iniciar/consultar servidores MCP quando o perfil de permissão
  // só admite ferramentas locais (ex.: run --read-only). Só carregamos MCP
  // se não houver restrição ou se a allowlist pedir explicitamente uma delas.
  const needsMcp = semRestricao(allowedNames) || allowedNames.some((name) => name.startsWith('mcp__'));
  const mcpDecls = needsMcp ? await mcpClient.declarationsForGemini() : [];
  const all = [
    ...fileTools.declarations,
    ...multiEditTools.declarations,
    ...globTools.declarations,
    ...webTools.declarations,
    ...shellTools.declarations,
    ...adbTools.declarations,
    ...browserTools.declarations,
    ...searchTools.declarations,
    ...checkTools.declarations,
    ...todoTools.declarations,
    ...workflowTools.declarations,
    ...skillLoader.declarations,
    ...subagent.declarations,
    ...personalTools.declarations,
    ...mcpDecls,
  ];
  if (semRestricao(allowedNames)) return all;
  return all.filter((d) => allowedNames.includes(d.name));
}

async function execute(name, args, allowedNames) {
  if (!semRestricao(allowedNames) && !allowedNames.includes(name)) {
    throw new Error(`Ferramenta "${name}" não está liberada para este agente.`);
  }
  if (fileTools.declarations.some((d) => d.name === name)) return fileTools.execute(name, args);
  if (multiEditTools.declarations.some((d) => d.name === name)) return multiEditTools.execute(name, args);
  if (globTools.declarations.some((d) => d.name === name)) return globTools.execute(name, args);
  if (webTools.declarations.some((d) => d.name === name)) return webTools.execute(name, args);
  if (shellTools.declarations.some((d) => d.name === name)) return shellTools.execute(name, args);
  if (adbTools.declarations.some((d) => d.name === name)) return adbTools.execute(name, args);
  if (browserTools.declarations.some((d) => d.name === name)) return browserTools.execute(name, args);
  if (searchTools.declarations.some((d) => d.name === name)) return searchTools.execute(name, args);
  if (checkTools.declarations.some((d) => d.name === name)) return checkTools.execute(name, args);
  if (todoTools.declarations.some((d) => d.name === name)) return todoTools.execute(name, args);
  if (workflowTools.declarations.some((d) => d.name === name)) return workflowTools.execute(name, args, { allowedPai: allowedNames });
  if (skillLoader.declarations.some((d) => d.name === name)) return skillLoader.execute(name, args);
  if (subagent.declarations.some((d) => d.name === name)) return subagent.execute(name, args, { allowedPai: allowedNames });
  if (personalTools.NOMES.includes(name)) return personalTools.execute(name, args);
  if (name.startsWith('mcp__')) return mcpClient.execute(name, args);
  throw new Error(`Ferramenta desconhecida: ${name}`);
}

/** Nomes de todas as ferramentas nativas (sem MCP), estejam ou não disponíveis agora. */
function nomesNativos() {
  return [
    fileTools, multiEditTools, globTools, webTools, shellTools, searchTools,
    checkTools, todoTools, workflowTools, skillLoader, subagent, adbTools, browserTools,
  ].flatMap((m) => m.declarations.map((d) => d.name)).concat(personalTools.NOMES);
}

module.exports = { getAllDeclarations, execute, nomesNativos, stopMcp: mcpClient.stopAll };
