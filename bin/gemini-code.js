#!/usr/bin/env node
// bin/gemini-code.js — ponto de entrada da CLI.
'use strict';

const path = require('path');
const readline = require('readline');
const chalk = require('chalk');

const { loadConfig, saveConfig, SKILLS_DIR, AGENTS_DIR, WORKFLOWS_DIR } = require('../src/config');
const { runOnce } = require('../src/agent');
const { runAgentFile } = require('../src/agents/runner');
const designTools = require('../src/tools/designTools');
const mediaTools = require('../src/tools/mediaTools');
const voice = require('../src/voice/voice');
const { runLive } = require('../src/live/live');
const { listSkills } = require('../src/skills/loader');
const toolsIndex = require('../src/tools');

const [, , cmd, ...rest] = process.argv;

// Rede de segurança: garante que servidores MCP sejam encerrados ao sair
// com Ctrl+C, não importa o comando. Antes só "run", "voice listen", "live"
// e "agent run" (workflow) chamavam stopMcp() explicitamente — "chat" (o
// modo mais usado no dia a dia) nunca chamava, contando só com o processo
// filho receber SIGINT junto com o pai por estar no mesmo grupo do
// terminal. Isso costuma funcionar, mas não é garantido em todo ambiente
// (ex.: gemini-code chamado de dentro de outro script/wrapper) — com o
// handler explícito, a limpeza acontece sempre.
let saindo = false;
function encerrarComLimpeza() {
  if (saindo) return;
  saindo = true;
  try { toolsIndex.stopMcp(); } catch { /* já não tem o que fazer aqui */ }
  process.exit(0);
}
process.on('SIGINT', encerrarComLimpeza);
process.on('SIGTERM', encerrarComLimpeza);

function printHelp() {
  console.log(`
gemini-code — agente de terminal com Gemini (estilo Claude Code / Codex)

Uso:
  gemini-code chat                          Modo conversa interativo com o agente
  gemini-code run "instrução"                Roda uma única instrução e sai
  gemini-code config set-key SUA_CHAVE       Salva a API key do Gemini
  gemini-code config show                    Mostra a configuração atual

  gemini-code design slides "assunto" [pasta]   Gera uma apresentação (html+md)
  gemini-code design doc "assunto" [pasta]      Gera um documento (md)
  gemini-code design image "descrição" [pasta]  Gera uma imagem (requer acesso liberado)

  gemini-code media video "descrição" [pasta]   Gera um vídeo curto (Veo, se disponível)
  gemini-code media music "descrição" [pasta]   Gera música (Lyria, se disponível)
  gemini-code media sound "descrição" [pasta]   Gera efeito sonoro

  gemini-code voice say "texto"               Fala um texto (Termux:API)
  gemini-code voice listen                    Ouve o microfone e roda como comando

  gemini-code live                            Conversa AO VIVO por voz (você fala, ele responde falando)
  gemini-code live --sem-voz                  Igual, mas só em texto (pra testar sem áudio)

  gemini-code skills list                     Lista as skills instaladas
  gemini-code agent run caminho/arquivo.json   Roda um workflow de vários passos OU
                                                abre chat com uma persona pronta
                                                (ex.: agents/exemplos/revisor-de-codigo.json)

  gemini-code cowork server [porta]            Inicia o servidor no PC
  gemini-code cowork connect <ip> --token X    Conecta do celular ao PC

Pastas de configuração: ~/.gemini-code (config.json, mcp.json, skills/, agents/, workflows/)
`);
}

async function chatLoop() {
  console.log(chalk.bold('gemini-code — modo conversa. Ctrl+C para sair.\n'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let history = [];
  const ask = () => rl.question(chalk.cyan('você> '), async (line) => {
    if (!line.trim()) return ask();
    try {
      const { text, history: newHistory } = await runOnce(line, { history });
      history = newHistory;
      console.log(chalk.green('\ngemini-code> ') + text + '\n');
    } catch (err) {
      console.error(chalk.red('Erro: ' + err.message));
    }
    ask();
  });
  ask();
}

async function main() {
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      return printHelp();

    case 'chat':
      return chatLoop();

    case 'run': {
      const instruction = rest.join(' ');
      const { text } = await runOnce(instruction);
      console.log(text);
      toolsIndex.stopMcp();
      return;
    }

    case 'config': {
      const [sub, ...args] = rest;
      if (sub === 'set-key') return console.log(saveConfig({ apiKey: args[0] }) && 'API key salva.');
      if (sub === 'set-model') return console.log(saveConfig({ model: args[0] }) && `Modelo principal definido: ${args[0]}`);
      if (sub === 'set-fast-model') return console.log(saveConfig({ fastModel: args[0] }) && `Modelo rápido definido: ${args[0]}`);
      if (sub === 'show') return console.log(JSON.stringify(loadConfig(), null, 2));
      return console.log('Uso: gemini-code config set-key SUA_CHAVE | set-model NOME | set-fast-model NOME | show');
    }

    case 'design': {
      const [sub, prompt, outDir = './saida-design'] = rest;
      if (sub === 'slides') {
        const r = await designTools.makeSlides(prompt, outDir);
        console.log(`Slides gerados: ${r.htmlPath} (${r.slideCount} slides)`);
      } else if (sub === 'doc') {
        const r = await designTools.makeDoc(prompt, outDir);
        console.log(`Documento gerado: ${r.outPath}`);
      } else if (sub === 'image') {
        const r = await designTools.makeImage(prompt, outDir);
        console.log(`Imagem gerada: ${r.outPath}`);
      } else {
        console.log('Uso: gemini-code design [slides|doc|image] "descrição" [pasta]');
      }
      return;
    }

    case 'media': {
      const [sub, prompt, outDir = './saida-media'] = rest;
      if (sub === 'video') console.log((await mediaTools.makeVideo(prompt, outDir)).outPath);
      else if (sub === 'music') console.log((await mediaTools.makeMusic(prompt, outDir)).outPath);
      else if (sub === 'sound') console.log((await mediaTools.makeSound(prompt, outDir)).outPath);
      else console.log('Uso: gemini-code media [video|music|sound] "descrição" [pasta]');
      return;
    }

    case 'voice': {
      const [sub, ...args] = rest;
      if (sub === 'say') return voice.speak(args.join(' '));
      if (sub === 'listen') {
        const text = voice.listen();
        console.log(`Você disse: ${text}`);
        const { text: reply } = await runOnce(text);
        console.log(reply);
        voice.speak(reply.slice(0, 500));
        toolsIndex.stopMcp();
        return;
      }
      return console.log('Uso: gemini-code voice [say "texto"|listen]');
    }

    case 'live': {
      const semVoz = rest.includes('--sem-voz');
      await runLive({ vozAtiva: !semVoz });
      toolsIndex.stopMcp();
      return;
    }

    case 'skills': {
      const [sub] = rest;
      if (sub === 'list') {
        const skills = listSkills();
        if (!skills.length) return console.log(`Nenhuma skill em ${SKILLS_DIR}`);
        skills.forEach((s) => console.log(`- ${s.name}: ${s.description}`));
        return;
      }
      return console.log('Uso: gemini-code skills list');
    }

    case 'agent': {
      const [sub, agentPath] = rest;
      if (sub === 'run') {
        if (!agentPath) {
          console.log(`Uso: gemini-code agent run caminho/workflow-ou-agente.json (pasta padrão: ${WORKFLOWS_DIR} ou ${AGENTS_DIR})`);
          return;
        }
        // runAgentFile detecta sozinho se é um workflow (array "steps") ou
        // uma persona de agente, e trata cada um do jeito certo.
        const outcome = await runAgentFile(path.resolve(agentPath));
        // Só fecha as conexões MCP quando o workflow termina de rodar; numa
        // persona o chat fica aberto (igual ao comando "chat") e fechar aqui
        // cortaria as ferramentas MCP no meio da conversa.
        if (outcome.type === 'workflow') toolsIndex.stopMcp();
        return;
      }
      return console.log(`Uso: gemini-code agent run caminho/workflow-ou-agente.json (pasta padrão: ${WORKFLOWS_DIR} ou ${AGENTS_DIR})`);
    }

    case 'cowork': {
      const [sub, ...args] = rest;
      if (sub === 'server') {
        const port = args[0] && !args[0].startsWith('--') ? Number(args[0]) : undefined;
        require('../src/cowork/server').startServer(port);
        return;
      }
      if (sub === 'connect') {
        const ip = args[0];
        if (!ip) {
          console.log('Uso: gemini-code cowork connect <ip> --token X [--port P]');
          return;
        }
        const tokenIdx = args.indexOf('--token');
        const token = tokenIdx >= 0 ? args[tokenIdx + 1] : '';
        const portIdx = args.indexOf('--port');
        const port = portIdx >= 0 ? Number(args[portIdx + 1]) : loadConfig().coworkPort;
        require('../src/cowork/client').connect(ip, port, token);
        return;
      }
      return console.log('Uso: gemini-code cowork server [porta] | gemini-code cowork connect <ip> --token X [--port P]');
    }

    default:
      console.log(`Comando desconhecido: ${cmd}`);
      printHelp();
  }
}

main().catch((err) => {
  console.error(chalk.red('Erro fatal: ' + err.message));
  process.exit(1);
});
