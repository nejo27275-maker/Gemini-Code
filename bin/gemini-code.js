#!/usr/bin/env node
// bin/gemini-code.js — ponto de entrada da CLI.
'use strict';

const path = require('path');
const fs = require('fs');
const chalk = require('../src/terminalColors');

const { loadConfig, saveConfig, SKILLS_DIR, AGENTS_DIR, WORKFLOWS_DIR, HISTORY_DIR } = require('../src/config');
const { getShared: getSharedReadline, ask, perguntarColando } = require('../src/ui/prompt');
const security = require('../src/security');
const configCommands = require('../src/configCommands');
const mcpPresets = require('../src/mcpPresets');
const PACKAGE_JSON = require('../package.json');
const { runOnce } = require('../src/agent');
const { runAgentFile } = require('../src/agents/runner');
const designTools = require('../src/tools/designTools');
const mediaTools = require('../src/tools/mediaTools');
const voice = require('../src/voice/voice');
const { runLive } = require('../src/live/live');
const { listSkills } = require('../src/skills/loader');
const toolsIndex = require('../src/tools');
const agenda = require('../src/agenda');
const projetos = require('../src/projetos');
const routines = require('../src/routines');
const { createRoutineRunner } = require('../src/routineRunner');
const backup = require('../src/tools/backup');
const sessions = require('../src/sessions');
const checkpoints = require('../src/checkpoints');
const rewind = require('../src/rewind');
const snapshots = require('../src/snapshots');
const hooks = require('../src/hooks');
const planMode = require('../src/planMode');
const usage = require('../src/usage');
const stepApproval = require('../src/stepApproval');
const workflowTools = require('../src/tools/workflowTools');
const artifacts = require('../src/artifacts');
const agentProfiles = require('../src/agentProfiles');
const { compactar } = require('../src/compact');
const customCommands = require('../src/customCommands');
const todoTools = require('../src/tools/todoTools');
const knowledgeModule = require('../src/knowledge');
const personalAgents = require('../src/personalAgents');
const aliadosCommands = require('../src/personalAgentCommands');
const { INSTRUCAO_MODO_CIENCIA } = require('../src/modoCiencia');

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
// v0.41.0: terminal fechado (SIGHUP) também passa pela limpeza — process.exit dispara o 'exit' que
// encerra os comandos em segundo plano do run_shell; sem isto o Node saía direto e eles ficavam órfãos.
process.on('SIGHUP', encerrarComLimpeza);

function printHelp() {
  console.log(`
gemini-code v${PACKAGE_JSON.version} — agente de terminal com Gemini (estilo Claude Code / Codex)

Uso:
  gemini-code chat                          Modo conversa interativo com o agente
  gemini-code run [--profile coder|explore|plan|review|test] [--checkpoint] "instrução"  Executa com perfil e salva artefato
  gemini-code run --json [--imagem foto.png] "instrução"   Saída JSON para scripts/CI; --imagem manda imagem (repetível)
  gemini-code profiles list|show NOME        Lista perfis e permissões reais do executor
  gemini-code sessions list|new|show|use|delete  Gerencia sessões persistentes
  gemini-code checkpoints create|list|restore    Checkpoints locais com restauração segura
  gemini-code artifacts list|show               Consulta relatórios e resultados salvos
  gemini-code context show                      Mostra arquivos de instrução do projeto
  gemini-code doctor                            Diagnóstico local de dependências e provedores
  gemini-code solo on|off|status                code-ia sozinho, sem nenhuma outra IA por trás (Gemini/llama.cpp/Ollama bloqueados)
  gemini-code config set-key SUA_CHAVE       Salva a API key do Gemini
  gemini-code config show                    Mostra a configuração atual
  gemini-code mcp presets|add|list|on|off|remove|check   Conecta Spotify, Blender e Roblox Studio (MCP) sem editar JSON
  gemini-code --version                      Mostra a versão instalada

No modo "chat", digite /help para ver os comandos de sessão (/clear, /model, /save).

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

  gemini-code models                          Lista os modelos que a SUA chave pode usar
  gemini-code code-ia status                  Mostra o modelo próprio code-ia (instalado? quanto sabe?)
  gemini-code code-ia ask "pergunta"          Pergunta direto pro code-ia (local, sem internet)
  gemini-code code-ia complete "trecho"       Completa código com o gerador próprio
  gemini-code code-ia learn <arquivo|pasta>   Ensina o code-ia (.md/.txt: cada título vira uma pergunta; código .js/.py/.html… vira busca + estilo)
  gemini-code code-ia teach "pergunta" "resposta"   Ensina uma coisa rápida (no chat: /ensinar pergunta :: resposta)
  gemini-code code-ia notes                   Lista o que você ensinou com teach
  gemini-code code-ia unteach "pergunta"       Esquece UMA coisa ensinada (no chat: /ensinados e /esquecer pergunta)
  gemini-code code-ia forget                  Esquece tudo que você ensinou
  gemini-code code-ia reinstall               Refaz o modelo do zero
  gemini-code llamacpp status                 Testa o servidor local sem Ollama
  gemini-code config set-provider hybrid|llamacpp|gemini|openai|ollama|code-ia   Escolhe IA online/local
  gemini-code config set-openai-key CHAVE | set-openai-model NOME | set-openai-url URL   API compatível com OpenAI (OpenRouter, OpenAI...)
  gemini-code config set-hybrid-cloud gemini|openai   Qual nuvem o modo hybrid usa
  gemini-code config negar|permitir "FERRAMENTA(PADRÃO)" | regras | remover-regra REGRA   Regras de permissão
  gemini-code confianca [status|confiar|negar|esquecer] [PASTA]   Confiança nas instruções do projeto (AGENTS.md...)
  gemini-code config set-llamacpp-url URL      URL do llama.cpp (padrão http://127.0.0.1:8080)
  gemini-code config set-llamacpp-model NOME   Nome usado pelo servidor (padrão local-model)
  gemini-code config set-llamacpp-path CAMINHO Arquivo GGUF local (override opcional)
  gemini-code config set-llamacpp-ctx TOKENS   Contexto do servidor local (padrão 4096; igual ao LLAMA_CTX)
  gemini-code config set-llamacpp-autostart on|off   Sobe o llama-server sozinho quando o chat precisar
  gemini-code llamacpp start|stop|status|log   Liga/desliga o modelo local em segundo plano
  gemini-code ollama models                   Lista modelos de uma instalação Ollama antiga (opcional)

  gemini-code knowledge add <arquivo|pasta>   Ensina o agente: copia .md/.txt (ex.: spec da NetoLang)
  gemini-code knowledge list                  Mostra o conhecimento fixo carregado agora
  gemini-code config set-fallback-model NOME  Modelo reserva se o principal ficar indisponível (503)

  gemini-code skills list                     Lista as skills instaladas

  gemini-code aliados listar                   Aliados: agentes pessoais com instruções, memória e conhecimento
  gemini-code aliados criar NOME --ia "o que ele faz"   A IA configura; você revisa e confirma
  gemini-code aliados criar NOME --instrucoes "Você é..." [--iniciador T] [--ferramentas P] [--memoria M]
  gemini-code aliados chat NOME                Conversa com ele (aliados run NOME "msg": uma pergunta só)
  gemini-code aliados conhecimento NOME add ARQ   Anexa arquivos de texto à base dele
  gemini-code aliados ajuda                    Tudo: ver, editar, remover, memoria, exportar, importar

  gemini-code agent run caminho/arquivo.json   Roda um workflow de vários passos OU
                                                abre chat com uma persona pronta
                                                (ex.: agents/exemplos/revisor-de-codigo.json)

  gemini-code cowork server [porta]            Inicia o servidor no PC
  gemini-code cowork connect <ip> --token X    Conecta do celular ao PC (canal cifrado)
  gemini-code cowork novo-token                Troca o token do cowork (o antigo deixa de valer)

  gemini-code ciencia "pergunta"               Modo ciência: explica em formato fixo (números, comparação, dá pra escapar?)

  gemini-code agenda add "texto" --dia N       Marca algo num dia (ou --data AAAA-MM-DD)
  gemini-code agenda dia N                     Mostra o que está marcado nesse dia
  gemini-code agenda listar                    Lista tudo que está marcado (mais próximo primeiro)
  gemini-code agenda remover ID                Remove um evento pelo id mostrado em "listar"

  gemini-code routines list                     Lista rotinas persistentes
  gemini-code routines create --name N --url URL (--every 5m | --at ISO | --cron '*/5 * * * *')
  gemini-code routines activate ID              Autoriza a execução automática de um rascunho
  gemini-code routines pause ID | resume ID     Pausa ou retoma uma rotina
  gemini-code routines run ID                   Executa uma verificação agora
  gemini-code routines logs [ID] [--limit N]    Consulta o histórico de execuções
  gemini-code routines remove ID --yes           Remove uma rotina pausada/rascunho
  gemini-code routines service                   Inicia o agendador + API persistentes

  gemini-code projetos add "nome" [pasta]      Registra um projeto (aba separada da conversa)
  gemini-code projetos listar                  Lista os projetos registrados
  gemini-code projetos remover "nome"          Remove um projeto da lista
  gemini-code sub "tarefa" [--tipo T]          Roda um subagente isolado (T: explorador | revisor | executor)
  gemini-code backups arquivo                  Lista os backups automáticos de um arquivo (mais recente = 1)
  gemini-code backups restore arquivo [N]      Restaura o backup N (padrão 1); o conteúdo atual também vira backup

Pastas de configuração: ~/.gemini-code (config.json, mcp.json, skills/, agents/, workflows/, aliados/)
`);
}

// Item 12 da revisão (set/2026): comandos de sessão dentro do chat — antes só
// dava pra sair (Ctrl+C); não tinha como limpar o histórico, trocar de
// modelo em runtime ou salvar a conversa (HISTORY_DIR existe em config.js
// desde sempre, mas nunca era usado por ninguém).
const CHAT_HELP = `
Comandos disponíveis no chat:
  /help              mostra esta lista
  /clear             zera o histórico da conversa atual
  /model NOME        troca o modelo (ex.: /model gemini-3.6-flash ou /model llamacpp:local-model)
  /codeia            usa o code-ia (modelo próprio, local, sem internet)
  /ensinar P :: R    ensina o code-ia na hora (pergunta :: resposta); mesma pergunta de novo substitui
  /local             força o modelo local (Ollama) a partir de agora
  /cloud             força a nuvem (Gemini) a partir de agora
  /auto              volta a deixar o config decidir (provider)
  /save [nome]       salva o histórico atual em arquivo e na sessão persistente
  /session list      lista sessões persistentes
  /session new [nome] inicia uma nova sessão
  /session use ID    retoma uma sessão existente
  /session rename NOME renomeia a sessão atual
  /ciencia pergunta  modo ciência: explica em formato fixo (números, comparação, dá pra escapar?)
  /agenda dia N              o que está marcado nesse dia
  /agenda add texto --dia N  marca algo nesse dia (ou --data AAAA-MM-DD)
  /agenda listar             lista tudo que está marcado
  /projetos                  lista os projetos registrados (gemini-code projetos add "nome" fora do chat)
  /compact           resume a conversa antiga (sem custo) e mantém só as últimas mensagens inteiras
  /compact ia        o próprio modelo resume a conversa antiga (perde menos detalhe; custa 1 chamada)
  /imagem ARQ [texto] manda uma imagem (png/jpg/webp/gif) junto com a pergunta
  /foto [texto]      tira foto com a câmera do celular (Termux:API) e manda ao agente
  /tarefas           mostra a lista de tarefas que o agente está seguindo (todo_write)
  /rewind [N|lista]  desfaz o que o agente gravou no(s) último(s) N turno(s) (como Ctrl+Z; --force sobrescreve o que você mudou depois)
  /snapshots         fotos automáticas do projeto (git escondido, inclui o que o shell mudou); /snapshots restaurar N volta à foto N
  /hooks             lista seus hooks (~/.gemini-code/hooks.json): comandos que rodam antes/depois das ferramentas
  /plano [pedido]    modo plano: o agente só lê e planeja (nada é gravado nem executado); /plano off cancela
  /aprovar [ajuste]  aprova o plano e deixa o agente executar
  /custo [zerar]     tokens gastos nesta sessão (reais, do Gemini), chamadas locais e limite; /custo zerar recomeça a contagem
  /passo [on|off]    aprovação passo a passo: mostra uma prévia e pergunta s/n/t antes de cada write_file/edit_file
  /workflows         lista os workflows salvos que o agente pode acionar sozinho (run_workflow)
  /workflows rodar <nome> [var=valor ...]   roda um workflow direto, sem o modelo escolher
  /workflows validar <nome>                 confere o workflow sem rodar (erros e avisos)
  /workflows ver <nome>                     resumo dos passos, opções e variáveis de um workflow
  /workflows exemplos                       lista os workflows de exemplo que vêm no projeto
  /workflows instalar <exemplo> [--forcar]  copia um exemplo para a sua pasta de workflows (sem mexer em arquivo)
  /workflows novo <nome>                    cria um esqueleto válido para você editar
  /workflows criar <nome> <pedido>          a IA escreve um RASCUNHO do workflow (fora de uso até você aprovar)
  /workflows rascunhos | aprovar <nome> | descartar <nome>   revisar, ativar ou jogar fora um rascunho
  /workflows historico [nome] [--erros]     últimas execuções: resultado, passos, tokens e duração (--erros: só as que falharam)
  /workflows resumo [nome]                  por workflow: % de sucesso, média de tokens/tempo, passo que mais falha
  /workflows retomar <nome>                 continua um workflow que falhou no meio, sem refazer os passos que deram certo
  /workflows limpar historico|<nome>        apaga o histórico, ou descarta a execução interrompida de um workflow
  /commands          lista seus comandos de barra (.md em .gemini-code/commands ou ~/.gemini-code/commands)
  /aliados           lista seus aliados (agentes pessoais; crie com: gemini-code aliados criar NOME --ia "...")
  /aliado NOME       a conversa passa a ser com esse aliado (instruções, memória e conhecimento dele); /aliado off volta
  @NOME mensagem     manda só esta mensagem para o aliado NOME
  /memoria [esquecer ID]   o que o aliado ativo guardou sobre você
  Ctrl+C             sai
`;

// Linhas { nivel, texto } dos módulos de comando (src/workflowCommands.js, src/personalAgentCommands.js).
const CORES_NIVEL = { dim: chalk.dim, erro: chalk.red, aviso: chalk.yellow, ok: chalk.green, texto: (t) => t };
function imprimirLinhas(linhas) {
  for (const l of linhas) console.log((CORES_NIVEL[l.nivel] || chalk.dim)(l.texto));
}

// Lê flags simples do tipo "--dia 7 --mes 10" de uma string de comando,
// devolvendo { texto: 'resto sem as flags', dia, mes, ano, data }.
function extrairFlagsAgenda(argsStr) {
  const flags = {};
  const texto = argsStr.replace(/--(dia|mes|ano|data)\s+(\S+)/g, (_, nome, valor) => {
    flags[nome] = valor;
    return '';
  }).trim();
  return { texto, ...flags };
}

function formatarEvento(e) {
  return `  [${e.id}] ${e.data} — ${e.texto}`;
}

function salvarHistorico(history, nomeArg) {
  const nome = (nomeArg || `sessao-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-');
  const arquivo = path.join(HISTORY_DIR, `${nome}.json`);
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(history, null, 2), 'utf8');
  return arquivo;
}

// v0.41.0: confiança no projeto (src/trust.js). Pergunta uma vez por pasta, só se o projeto traz
// instruções para agentes (AGENTS.md, CLAUDE.md, .cursorrules, .gemini-code/commands e /subagentes...).
// Devolve a linha lida quando ela não é resposta (ex.: `echo "pergunta" | gemini-code chat`): o chat a usa
// como primeira mensagem — antes ela era engolida pela pergunta e o processo saía sem responder.
async function perguntarConfiancaNoProjeto() {
  const trust = require('../src/trust');
  if (loadConfig().confiancaProjeto === 'sempre' || trust.estado() !== null) return null;
  const instrucoes = trust.instrucoesDoProjeto();
  if (!instrucoes.length) return null;
  console.log(chalk.yellow('Este projeto traz instruções para agentes, que entram no prompt do modelo:'));
  for (const arq of instrucoes) console.log(chalk.yellow(`  ${path.relative(process.cwd(), arq) || arq}`));
  console.log(chalk.yellow('Instruções de um repositório de terceiros podem mandar o agente fazer coisas que você não pediu.'));
  const linha = String(await ask('Confiar nelas? [s]im / [n]ão — fica salvo para esta pasta: '));
  const r = linha.trim().toLowerCase();
  if (r === 's' || r === 'y') { trust.definir(process.cwd(), 'confiar'); console.log(chalk.dim('(confiança salva; desfaça com: gemini-code confianca esquecer)\n')); return null; }
  if (r === 'n') { trust.definir(process.cwd(), 'negar'); console.log(chalk.dim('(instruções do projeto ignoradas; só o conhecimento global vale. Mude com: gemini-code confianca confiar)\n')); return null; }
  trust.negarNestaSessao();
  if (!r) { console.log(chalk.dim('(sem resposta: ignorando as instruções do projeto só nesta execução)\n')); return null; }
  console.log(chalk.dim('(não é s/n: ignorando as instruções do projeto só nesta execução; o texto segue como sua primeira mensagem)\n'));
  return linha;
}

// v0.42.0: `aliados chat NOME` abre este mesmo chat com o agente pessoal já ativo e com as conversas DELE
// (~/.gemini-code/aliados/NOME/sessoes.json, valem em qualquer pasta). No chat comum, /aliado NOME liga um
// agente pessoal na conversa atual e @NOME manda só uma mensagem para ele (src/personalAgentCommands.js).
async function chatLoop({ agente: nomeAgente } = {}) {
  const aliadosStore = personalAgents.defaultStore;
  let agenteAtivo = nomeAgente ? aliadosStore.obter(nomeAgente) : null;
  const sessoes = agenteAtivo ? aliadosStore.sessoes(agenteAtivo.name) : sessions;
  console.log(chalk.bold(`gemini-code v${PACKAGE_JSON.version} — modo conversa. Ctrl+C para sair, /help para comandos.\n`));
  if (require('../src/solo').ativo()) console.log(chalk.green('[solo] code-ia sozinho: nenhuma outra IA (Gemini, llama.cpp, Ollama) é usada.\n'));
  const primeiraMensagem = await perguntarConfiancaNoProjeto();
  // Item 8 da revisão: usa a MESMA interface de readline que a confirmação
  // de run_shell usa (src/ui/prompt.js), em vez de criar uma própria —
  // evita duas interfaces competindo pelo mesmo stdin.
  const rl = getSharedReadline();
  // v0.41.0: sessão da pasta atual (src/sessions.js getActiveFor), não a última de qualquer projeto.
  let sessaoAtual = agenteAtivo
    ? sessoes.getActive() || sessoes.create(`Conversa com ${agenteAtivo.name}`)
    : sessoes.getActiveFor(process.cwd()) || sessoes.create(`Sessão de ${path.basename(process.cwd()) || 'raiz'}`);
  let history = Array.isArray(sessaoAtual.history) ? sessaoAtual.history : [];
  let modeloAtual = sessaoAtual.modelName || undefined; // undefined = usa o padrão do config
  if (history.length) console.log(chalk.dim(`Sessão retomada: ${sessaoAtual.name} (${sessaoAtual.id}) — ${history.length} mensagens no histórico. Use /session new para começar outra.\n`));
  else console.log(chalk.dim(`Sessão persistente: ${sessaoAtual.name} (${sessaoAtual.id}). O histórico será salvo automaticamente.\n`));
  if (agenteAtivo) { imprimirLinhas(aliadosCommands.boasVindas(agenteAtivo, aliadosStore)); console.log(''); }
  // stdin fechado (Ctrl+D ou entrada redirecionada): encerra limpo em vez de
  // estourar ERR_USE_AFTER_CLOSE na próxima pergunta.
  let fechado = false;
  let modoPlano = false;
  stepApproval.configurar({ ativo: loadConfig().confirmarEscrita === true, perguntar: (q) => (fechado ? Promise.resolve('n') : require('../src/ui/prompt').ask(q)) });
  rl.on('close', () => { fechado = true; });

  const tratarLinha = async (line) => {
    const cmd = line.trim();
    if (!cmd) return ask();

    if (cmd === '/help') {
      console.log(CHAT_HELP);
      return ask();
    }
    if (cmd === '/compact' || cmd === '/compact ia') {
      // v0.41.0: "/compact ia" pede o resumo ao próprio modelo (1 chamada); sem "ia", resumo local grátis.
      const comIa = cmd === '/compact ia';
      const r = comIa
        ? await require('../src/compact').compactarComModelo(history, { chat: (a) => require('../src/provider').chatWithTools({ ...a, modelName: modeloAtual }) })
        : compactar(history);
      if (!r.compactou) console.log(chalk.dim('(conversa ainda curta, nada pra compactar)\n'));
      else {
        history = r.history;
        usage.contextoCompactado();
        sessaoAtual = sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual });
        const como = comIa && !r.comModelo ? ' (o modelo não respondeu; usei o resumo local)' : comIa ? ' feito pelo modelo' : '';
        console.log(chalk.dim(`(compactei ${r.removidas} mensagens antigas num resumo${como}; sessão salva)\n`));
      }
      return ask();
    }
    if (cmd === '/tarefas' || cmd === '/todo') {
      console.log(chalk.dim(todoTools.render() + '\n'));
      return ask();
    }
    if (cmd === '/rewind' || cmd.startsWith('/rewind ')) {
      const arg = cmd.slice('/rewind'.length).trim();
      const force = /(^|\s)--force(\s|$)/.test(arg);
      const resto = arg.replace(/--force/g, '').trim();
      if (resto === 'lista' || resto === 'list') {
        const itens = rewind.listar({ cwd: process.cwd() });
        console.log(chalk.dim(itens.length
          ? itens.map((t, i) => `  ${i + 1}. ${t.em.slice(0, 19).replace('T', ' ')} — ${t.arquivos.length} arquivo(s) — ${t.rotulo}`).join('\n') + '\n'
          : 'Nenhum turno com arquivos gravados neste projeto.\n'));
        return ask();
      }
      const n = resto ? parseInt(resto, 10) : 1;
      if (!Number.isInteger(n) || n < 1) { console.log(chalk.dim('Uso: /rewind [N] [--force] | /rewind lista\n')); return ask(); }
      console.log(chalk.dim(rewind.formatar(rewind.desfazer({ n, force, cwd: process.cwd() })) + '\n'));
      return ask();
    }
    if (cmd === '/snapshots' || cmd.startsWith('/snapshots ')) {
      const partes = cmd.slice('/snapshots'.length).trim().split(/\s+/).filter(Boolean);
      if (!snapshots.raiz()) { console.log(chalk.dim('Esta pasta não é um repositório git (rode git init para ter fotos automáticas).\n')); return ask(); }
      if (partes[0] === 'restaurar') {
        try {
          const r = snapshots.restaurar({ n: parseInt(partes[1], 10) || 1 });
          console.log(chalk.dim(`Restaurado para ${r.restaurada.curto} (${r.restaurada.rotulo}). ${r.fotoAntes ? `O estado anterior ficou salvo como ${r.fotoAntes.curto}.` : ''} Arquivos criados depois da foto não são apagados.\n`));
        } catch (e) { console.log(chalk.red(e.message + '\n')); }
        return ask();
      }
      const fotos = snapshots.listar({});
      console.log(chalk.dim(fotos.length ? fotos.map((f, i) => `  ${i + 1}. ${f.curto} ${f.em.slice(0, 19).replace('T', ' ')} — ${f.rotulo}`).join('\n') + '\n' : 'Nenhuma foto ainda (a primeira sai no próximo turno).\n'));
      return ask();
    }
    if (cmd === '/hooks') {
      const itens = hooks.resumo();
      console.log(chalk.dim(itens.length ? itens.join('\n') + '\n' : 'Nenhum hook. Crie ~/.gemini-code/hooks.json (veja o README) para bloquear ou checar ferramentas.\n'));
      return ask();
    }
    let textoDoPlano = null;
    {
      const pm = planMode.interpretar(cmd, { ativo: modoPlano });
      if (pm) {
        if (pm.acao !== 'aviso') modoPlano = pm.ativo;
        if (pm.aviso) console.log(chalk.dim(pm.aviso + '\n'));
        if (!pm.enviar) return ask();
        textoDoPlano = pm.enviar;
        if (pm.acao === 'aprovar') console.log(chalk.dim('(plano aprovado — executando)'));
      }
    }
    if (cmd === '/custo' || cmd === '/custo zerar') {
      if (cmd === '/custo zerar') { usage.zerar(); console.log(chalk.dim('Contagem zerada.\n')); }
      else console.log(chalk.dim(usage.resumo({ limite: loadConfig().maxTokensSessao }) + '\n'));
      return ask();
    }
    if (cmd === '/passo' || cmd.startsWith('/passo ')) {
      const arg = cmd.slice('/passo'.length).trim().toLowerCase();
      if (arg === 'on' || arg === 'off') stepApproval.configurar({ ativo: arg === 'on' });
      else if (arg) { console.log(chalk.dim('Uso: /passo [on|off]\n')); return ask(); }
      else stepApproval.configurar({ ativo: !stepApproval.ativo() });
      console.log(chalk.dim(stepApproval.ativo() ? 'Passo a passo LIGADO: cada gravação de arquivo pede sua aprovação (s/n/t).\n' : 'Passo a passo desligado.\n'));
      return ask();
    }
    if (cmd === '/workflows' || cmd.startsWith('/workflows ')) {
      // v0.25.0: a lógica dos comandos /workflows mora em src/workflowCommands.js (testável sem abrir o terminal)
      const linhas = await require('../src/workflowCommands').tratar(cmd, { pasta: WORKFLOWS_DIR });
      console.log('');
      imprimirLinhas(linhas);
      console.log('');
      return ask();
    }
    {
      // v0.42.0: /aliados, /aliado NOME|off e /memoria (agentes pessoais)
      const g = aliadosCommands.chat(cmd, { agente: agenteAtivo, store: aliadosStore });
      if (g) {
        imprimirLinhas(g.linhas);
        if (g.agente !== undefined) agenteAtivo = g.agente;
        console.log('');
        return ask();
      }
    }
    if (cmd === '/commands') {
      const todos = [...customCommands.carregar({ home: require('../src/config').HOME_DIR }).values()];
      console.log(chalk.dim(todos.length
        ? todos.map((c) => `  /${c.nome}${c.descricao ? ` — ${c.descricao}` : ''} (${c.origem})`).join('\n') + '\n'
        : 'Nenhum comando seu ainda. Crie .gemini-code/commands/revisar.md (use $ARGUMENTS) e use /revisar.\n'));
      return ask();
    }
    if (cmd === '/clear') {
      history = [];
      sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual });
      console.log(chalk.dim('(histórico limpo e sessão salva)\n'));
      return ask();
    }
    if ((cmd === '/local' || cmd === '/cloud' || cmd === '/auto') && require('../src/solo').ativo()) {
      console.log(chalk.yellow('[solo] Modo solo ligado: só o code-ia responde. Para usar outra IA: gemini-code solo off\n'));
      return ask();
    }
    if (cmd === '/local' || cmd === '/cloud' || cmd === '/auto' || cmd === '/codeia') {
      modeloAtual = cmd === '/local' ? '@local' : cmd === '/cloud' ? '@cloud' : cmd === '/codeia' ? '@codeia' : undefined;
      const cfg = loadConfig();
      if (cmd === '/codeia') {
        try { require('../src/code-ia/install').ensureInstalled({ log: (m) => console.log(chalk.dim(m)) }); }
        catch (err) { console.error(chalk.yellow(`[code-ia] ${err.message}`)); }
      }
      sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual });
      console.log(chalk.dim(
        cmd === '/codeia' ? 'Agora: code-ia (modelo próprio, local)\n'
          : cmd === '/local' ? `Agora: modelo local llama.cpp (${cfg.llamaCppModel || 'local-model'})\n`
          : cmd === '/cloud' ? `Agora: nuvem (${cfg.model})\n`
            : `Agora: automático (provider=${cfg.provider})\n`
      ));
      return ask();
    }
    if (cmd === '/ensinados' || cmd.startsWith('/esquecer')) {
      const ci = require('../src/code-ia/install');
      try {
        if (cmd === '/ensinados') {
          const l = ci.listarAnotacoes();
          console.log(chalk.dim(l.length ? `Você me ensinou ${l.length} coisa(s):\n${l.map((t) => `- ${t}`).join('\n')}\n` : 'Você ainda não me ensinou nada com /ensinar.\n'));
        } else {
          const r = ci.esquecerAnotacao(cmd.slice('/esquecer'.length).trim(), { log: (m) => console.log(chalk.dim(m)) });
          console.log(chalk.dim(`Esqueci: ${r.esquecida}\n`));
        }
      } catch (err) { console.error(chalk.red(`Erro: ${err.message}\n`)); }
      return ask();
    }
    if (cmd.startsWith('/ensinar')) {
      const resto = cmd.slice('/ensinar'.length).trim();
      const i = resto.indexOf('::');
      try {
        if (i < 0) throw new Error('Use: /ensinar pergunta :: resposta');
        const r = require('../src/code-ia/install').anotar(resto.slice(0, i), resto.slice(i + 2), { log: (m) => console.log(chalk.dim(m)) });
        console.log(chalk.dim(`${r.substituiu ? 'Atualizei' : 'Aprendi'}! O code-ia agora tem ${r.stats.blocos} blocos de conhecimento.\n`));
      } catch (err) { console.error(chalk.red(`Erro: ${err.message}\n`)); }
      return ask();
    }
    if (cmd.startsWith('/model')) {
      const novoModelo = cmd.slice('/model'.length).trim();
      if (!novoModelo) {
        console.log(chalk.dim(`Modelo atual: ${modeloAtual || loadConfig().model} (uso: /model NOME)\n`));
      } else {
        modeloAtual = novoModelo;
        sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual });
        console.log(chalk.dim(`Modelo trocado para: ${novoModelo}\n`));
      }
      return ask();
    }
    if (cmd.startsWith('/save')) {
      const nomeArg = cmd.slice('/save'.length).trim() || undefined;
      try {
        const arquivo = salvarHistorico(history, nomeArg);
        sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual, ...(nomeArg ? { name: nomeArg } : {}) });
        console.log(chalk.dim(`Histórico salvo em: ${arquivo}\nSessão persistente atualizada: ${sessaoAtual.id}\n`));
      } catch (err) {
        console.error(chalk.red('Erro ao salvar: ' + err.message));
      }
      return ask();
    }

    if (cmd.startsWith('/session')) {
      const [sub, ...args] = cmd.slice('/session'.length).trim().split(/\s+/).filter(Boolean);
      try {
        if (sub === 'list' || !sub) {
          const lista = sessoes.list({ limit: 30 });
          console.log(lista.length ? lista.map((s) => `${s.id === sessaoAtual.id ? '* ' : '  '}${s.id} | ${s.name} | ${s.messageCount} mensagens | ${s.updatedAt}`).join('\n') + '\n' : 'Nenhuma sessão salva.\n');
        } else if (sub === 'new') {
          sessaoAtual = sessoes.create(args.join(' ') || undefined, { modelName: modeloAtual });
          history = [];
          console.log(chalk.dim(`Nova sessão: ${sessaoAtual.name} (${sessaoAtual.id})\n`));
        } else if (sub === 'use' || sub === 'load' || sub === 'resume') {
          const existente = sessoes.get(args[0]);
          if (!existente) throw new Error('Sessão não encontrada. Use /session list.');
          sessaoAtual = sessoes.setActive(existente.id);
          history = sessaoAtual.history;
          modeloAtual = sessaoAtual.modelName || undefined;
          console.log(chalk.dim(`Sessão retomada: ${sessaoAtual.name} (${sessaoAtual.id}), ${history.length} mensagens.\n`));
        } else if (sub === 'rename') {
          const nome = args.join(' ');
          if (!nome) throw new Error('Uso: /session rename NOVO_NOME');
          sessaoAtual = sessoes.save(sessaoAtual.id, { name: nome });
          console.log(chalk.dim(`Sessão renomeada: ${sessaoAtual.name}\n`));
        } else if (sub === 'show') {
          console.log(JSON.stringify({ ...sessoes.get(sessaoAtual.id), history: `[${history.length} mensagens]` }, null, 2));
        } else {
          console.log('Uso: /session list | new [nome] | use ID | rename NOME | show\n');
        }
      } catch (err) { console.error(chalk.red(`Erro: ${err.message}\n`)); }
      return ask();
    }

    if (cmd.startsWith('/agenda')) {
      const argsStr = cmd.slice('/agenda'.length).trim();
      const [sub, ...restoArr] = argsStr.split(/\s+/);
      const resto = restoArr.join(' ');
      try {
        if (sub === 'add') {
          const { texto, ...opts } = extrairFlagsAgenda(resto);
          const evento = agenda.adicionarEvento(texto, opts);
          console.log(chalk.dim(`Marcado para ${evento.data}: "${evento.texto}"\n`));
        } else if (sub === 'dia') {
          const dia = restoArr[0];
          const { data, eventos } = agenda.eventosDoDia({ dia });
          console.log(eventos.length
            ? chalk.dim(`Em ${data}:\n${eventos.map(formatarEvento).join('\n')}\n`)
            : chalk.dim(`Nada marcado em ${data}.\n`));
        } else if (sub === 'listar' || !sub) {
          const eventos = agenda.listarEventos();
          console.log(eventos.length
            ? chalk.dim(`Agenda:\n${eventos.map(formatarEvento).join('\n')}\n`)
            : chalk.dim('Agenda vazia.\n'));
        } else if (sub === 'remover') {
          console.log(chalk.dim(agenda.removerEvento(restoArr[0]) ? 'Removido.\n' : 'Id não encontrado.\n'));
        } else {
          console.log(chalk.dim('Uso: /agenda add texto --dia N | /agenda dia N | /agenda listar | /agenda remover ID\n'));
        }
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
      }
      return ask();
    }

    if (cmd.startsWith('/projetos')) {
      const lista = projetos.listarProjetos();
      console.log(lista.length
        ? chalk.dim(lista.map((p) => `  ${p.nome}${p.pasta ? ` (${p.pasta})` : ''}${p.nota ? ` — ${p.nota}` : ''}`).join('\n') + '\n')
        : chalk.dim('Nenhum projeto registrado (gemini-code projetos add "nome" [pasta] fora do chat).\n'));
      return ask();
    }

    if (cmd.startsWith('/ciencia')) {
      const pergunta = cmd.slice('/ciencia'.length).trim();
      if (!pergunta) {
        console.log(chalk.dim('Uso: /ciencia pergunta (ex.: /ciencia quanto tempo passa em 1 segundo perto de um buraco negro?)\n'));
        return ask();
      }
      try {
        process.stdout.write(chalk.green('\ngemini-code> '));
        let streamed = false;
        const { text } = await runOnce(pergunta, {
          extraSystemInstruction: INSTRUCAO_MODO_CIENCIA,
          onText: (pedaco) => { streamed = true; process.stdout.write(pedaco); },
        });
        if (!streamed) process.stdout.write(text);
        console.log('\n');
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
      }
      return ask();
    }

    let textoEnviado = textoDoPlano || line;
    if (cmd.startsWith('/')) {
      const custom = customCommands.resolver(cmd, customCommands.carregar({ home: require('../src/config').HOME_DIR }));
      if (custom) { textoEnviado = custom.texto; console.log(chalk.dim(`(comando /${custom.nome})`)); }
    }
    // v0.42.0: "@nome mensagem" vai só esta vez para um agente pessoal; numa conversa vazia com um agente,
    // um número escolhe um dos iniciadores dele.
    let agenteDoTurno = agenteAtivo;
    if (!textoDoPlano) {
      const men = aliadosCommands.mencao(line, aliadosStore);
      const ini = men ? null : aliadosCommands.iniciadorEscolhido(agenteAtivo, line, history.length === 0);
      if (men) { agenteDoTurno = men.agente; textoEnviado = men.mensagem; console.log(chalk.dim(`(só esta mensagem vai para o aliado ${men.agente.name})`)); }
      else if (ini) { textoEnviado = ini; console.log(chalk.dim(`(${ini})`)); }
    }
    // v0.41.0: /imagem CAMINHO [pergunta] e /foto [pergunta] (câmera do celular via Termux:API) mandam imagem ao agente.
    let imagensDoTurno = [];
    if (cmd.startsWith('/imagem ') || cmd === '/foto' || cmd.startsWith('/foto ')) {
      try {
        let arquivo;
        let resto;
        if (cmd.startsWith('/imagem ')) {
          const m = cmd.slice('/imagem '.length).trim().match(/^(?:"([^"]+)"|(\S+))\s*([\s\S]*)$/);
          arquivo = m && (m[1] || m[2]);
          resto = m ? m[3] : '';
        } else {
          arquivo = path.join(require('os').tmpdir(), `gemini-code-foto-${Date.now()}.jpg`);
          console.log(chalk.dim('(tirando foto com a câmera...)'));
          await require('../src/voice/voice').takePhoto(arquivo);
          resto = cmd.replace(/^\/foto\s*/, '');
        }
        imagensDoTurno = [require('../src/imagens').lerImagem(arquivo)];
        textoEnviado = resto || 'Descreva esta imagem e aponte o que for relevante para o que estamos fazendo.';
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        return ask();
      }
    }
    // v0.15.0: contexto grande = cada chamada fica cara. Compacta sozinho (sem chamar modelo, sem custo).
    if (usage.contextoGrande(loadConfig().autoCompactTokens, { ctxLocal: require('../src/providers/llamacpp').ctxTamanho(loadConfig()) })) {
      const rc = compactar(history);
      if (rc.compactou) {
        history = rc.history;
        usage.contextoCompactado();
        sessaoAtual = sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual });
        console.log(chalk.dim(`(contexto grande: compactei ${rc.removidas} mensagens antigas sozinho para gastar menos)`));
      }
    }
    rewind.iniciarTurno(line);
    const autoGit = loadConfig().autoGit !== false;
    if (autoGit) snapshots.tirar({ rotulo: `antes: ${line}` });
    try {
      // Com agente pessoal: instruções, memória, trechos do conhecimento, ferramentas e modelo dele; o modo
      // plano só restringe (interseção das ferramentas). O modelo do agente, se definido, vale sobre o /model.
      const restricao = planMode.opcoes(modoPlano);
      const turno = agenteDoTurno ? personalAgents.prepararTurno(aliadosStore, agenteDoTurno, textoEnviado, { restricao }) : null;
      process.stdout.write(chalk.green(`\n${agenteDoTurno ? agenteDoTurno.name : 'gemini-code'}> `));
      let streamed = false;
      const rodar = () => runOnce(textoEnviado, {
        history,
        modelName: modeloAtual,
        imagens: imagensDoTurno,
        ...(turno ? turno.opcoes : restricao),
        onText: (pedaco) => {
          streamed = true;
          process.stdout.write(pedaco);
        },
      });
      const { text, history: newHistory } = await (turno ? personalAgents.comAgente(turno.ctx, rodar) : rodar());
      history = newHistory;
      sessaoAtual = sessoes.save(sessaoAtual.id, { history, modelName: modeloAtual });
      try { artifacts.createArtifact({ title: line.slice(0, 120), type: 'turno-chat', status: 'concluido', summary: text.slice(0, 1000), content: text, taskId: sessaoAtual.id, cwd: process.cwd(), metadata: { sessionId: sessaoAtual.id, ...(agenteDoTurno ? { agentePessoal: agenteDoTurno.name } : {}) } }); } catch { /* relatório é best-effort e não pode travar o chat */ }
      // Se nada foi impresso via streaming (ex.: resposta veio só como
      // functionCalls sem texto acompanhando, ou streaming desabilitado),
      // imprime o texto completo agora.
      if (!streamed) process.stdout.write(text);
      console.log('\n');
    } catch (err) {
      console.error(chalk.red('Erro: ' + err.message));
    }
    if (modoPlano) console.log(chalk.dim('(modo plano: nada foi alterado. /aprovar executa, /plano off cancela)\n'));
    const rw = rewind.finalizarTurno();
    if (autoGit) { const f = snapshots.tirar({ rotulo: `depois: ${line}` }); if (f) console.log(chalk.dim(`(foto ${f.curto} salva — /snapshots lista, /snapshots restaurar N volta)`)); }
    if (rw) console.log(chalk.dim(`(${rw.arquivos} arquivo(s) gravado(s) neste turno — /rewind desfaz)\n`));
    ask();
  };
  const rotulo = () => [agenteAtivo && agenteAtivo.name, modoPlano && 'plano'].filter(Boolean).join(' · ');
  const ask = () => fechado ? encerrarComLimpeza() : perguntarColando(rl, chalk.cyan(rotulo() ? `você [${rotulo()}]> ` : 'você> '), tratarLinha);
  if (primeiraMensagem) tratarLinha(primeiraMensagem); else ask();
}

// Comandos que nunca precisam da apiKey (ajuda/versão, e "config" porque os
// próprios subcomandos de config/passphrase se viram sozinhos com o cadeado)
// não devem interromper o usuário pedindo a chave de segurança à toa.
// "agenda" e "projetos" são só arquivo local (sem API key nenhuma
// envolvida) — pedir a chave de segurança pra só ver a lista seria atrito
// à toa.
const COMANDOS_SEM_DESBLOQUEIO = new Set([undefined, 'help', '--help', 'version', '--version', '-v', 'config', 'confianca', 'trust', 'agenda', 'projetos', 'backups', 'routines', 'sessions', 'checkpoints', 'artifacts', 'context', 'doctor', 'solo', 'security', 'profiles', 'agents', 'code-ia', 'codeia']);

// v0.42.0: de "aliados", só conversar (chat/run) e criar com --ia chamam o modelo.
function aliadosUsaModelo() {
  const sub = String(rest[0] || '').toLowerCase();
  return ['chat', 'conversar', 'run', 'perguntar', 'ask'].includes(sub) || rest.includes('--ia') || rest.includes('--ai') || rest.some((a) => /^--(ia|ai)=/.test(a));
}

async function garantirDesbloqueio() {
  if (COMANDOS_SEM_DESBLOQUEIO.has(cmd)) return;
  if (COMANDOS_ALIADOS.has(cmd) && !aliadosUsaModelo()) return;
  const cfg = loadConfig();
  if (!security.isLocked(cfg) || security.getSessionApiKey()) return;

  console.log(chalk.dim('\n[gemini-code] API key protegida por chave de segurança.'));
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const senha = await ask('Chave de segurança: ');
    if (security.unlock(senha)) {
      if (security.getSessionRole() === 'guest') {
        console.log(chalk.yellow(
          `\n[gemini-code] Sessão de convidado — acesso limitado a: ${security.GUEST_ALLOWED_TOOLS.join(', ')}.\n`
        ));
      }
      return;
    }
    console.log('Chave incorreta.');
  }
  throw new Error('Não foi possível desbloquear a API key (3 tentativas incorretas). Rode o comando de novo.');
}

// Geração de mídia/imagem consome cota da API paga pelo dono — convidado não
// deveria conseguir gastar isso mesmo tendo a chave de convidado em mãos.
function bloquearSeConvidado(mensagem) {
  if (security.getSessionRole() === 'guest') {
    console.log(chalk.yellow(`[gemini-code] Não disponível na sessão de convidado: ${mensagem}`));
    return true;
  }
  return false;
}

// Quando o provedor code-ia é selecionado, prepara o modelo pequeno de conhecimento.
// O padrão é o LLM geral local via llama.cpp; o modelo GGUF é baixado pelo usuário.
const COMANDOS_COM_MODELO = new Set(['chat', 'run', 'sub', 'agent', 'live', 'voice', 'ciencia']);
const COMANDOS_ALIADOS = new Set(['aliados', 'aliado']);
function bootstrapCodeIa() {
  if (!COMANDOS_COM_MODELO.has(cmd) && !(COMANDOS_ALIADOS.has(cmd) && aliadosUsaModelo())) return;
  if (loadConfig().provider !== 'code-ia' && !require('../src/solo').ativo()) return;
  try {
    require('../src/code-ia/install').ensureInstalled({ log: (m) => console.log(chalk.dim(m)) });
  } catch (err) {
    console.error(chalk.yellow(`[code-ia] não consegui instalar o modelo próprio agora: ${err.message}`));
  }
}

// v0.41.0: run --json — desde o início (inclusive a instalação do code-ia e o desbloqueio), tudo que não é
// o JSON final vai para o stderr; o JSON sai pelo stdout original, numa linha só.
const MODO_JSON = cmd === 'run' && rest.includes('--json');
const escreverStdout = process.stdout.write.bind(process.stdout);
function escreverJson(obj) { escreverStdout(JSON.stringify(obj) + '\n'); }

async function main() {
  if (MODO_JSON) process.stdout.write = (...a) => process.stderr.write(...a);
  require('../src/solo').instalarGuarda();
  await garantirDesbloqueio();
  const solo = require('../src/solo');
  if (solo.ativo()) {
    const bloqueado = new Set(['design', 'media', 'live', 'models', 'ollama']);
    if (bloqueado.has(cmd) || (cmd === 'llamacpp' && rest[0] === 'start')) {
      console.log(chalk.yellow(`[solo] "${cmd}" depende de outra IA e está bloqueado no modo solo (só o code-ia roda). Para sair: gemini-code solo off`));
      process.exitCode = 1;
      return;
    }
  }
  bootstrapCodeIa();
  switch (cmd) {
    case 'help':
    case '--help':
      return printHelp();

    case undefined: {
      // O chat usa o LLM local como padrão. Só instala a code-ia pequena se ela foi escolhida.
      const cfg = loadConfig();
      if (cfg.provider === 'code-ia') {
        const info = require('../src/code-ia/install').ensureInstalled({ log: (m) => console.log(chalk.dim(m)) });
        if (info.acao === 'ok' && cfg.apiKey) return printHelp();
      } else if (cfg.apiKey) {
        return printHelp();
      }
      return chatLoop();
    }

    case 'version':
    case '--version':
    case '-v':
      return console.log(`gemini-code v${PACKAGE_JSON.version}`);

    case 'chat':
      return chatLoop();

    case 'confianca':
    case 'trust': {
      // v0.41.0: gemini-code confianca [status|confiar|negar|esquecer] [PASTA]
      const trust = require('../src/trust');
      const [sub = 'status', pasta = process.cwd()] = rest;
      if (sub === 'status') {
        const e = trust.estado(pasta);
        const inst = trust.instrucoesDoProjeto(pasta);
        console.log(`Pasta: ${path.resolve(pasta)}\nDecisão: ${e || '(nenhuma — o chat pergunta; o run carrega)'}\nInstruções do projeto: ${inst.length ? inst.map((a) => path.relative(pasta, a) || a).join(', ') : '(nenhuma)'}`);
        return;
      }
      const decisao = { confiar: 'confiar', negar: 'negar', esquecer: null }[sub];
      if (decisao === undefined) throw new Error('Uso: gemini-code confianca [status|confiar|negar|esquecer] [PASTA]');
      const alvo = trust.definir(pasta, decisao);
      if (decisao) { console.log(`${alvo}: ${decisao}.`); return; }
      // A decisão de uma pasta-mãe continua valendo aqui: dizer qual, em vez de prometer que o chat vai perguntar.
      const herdada = trust.origemDaDecisao(alvo);
      console.log(herdada
        ? `${alvo}: decisão própria apagada, mas continua valendo "${herdada.decisao}" de ${herdada.pasta} (para mudar: gemini-code confianca esquecer ${herdada.pasta}).`
        : `${alvo}: decisão apagada (o chat vai perguntar de novo).`);
      return;
    }

    case 'run': {
      const parsed = agentProfiles.parseRunArgs(rest);
      const { profile, createCheckpoint, instruction } = parsed;
      if (!instruction) throw new Error('Informe uma instrução. Uso: gemini-code run [--profile coder|explore|plan|review|test] [--checkpoint] [--imagem ARQ] [--json] "instrução"');
      try {
        const imagens = parsed.imagens.map((arq) => require('../src/imagens').lerImagem(arq));
        let checkpoint = null;
        if (createCheckpoint) {
          checkpoint = checkpoints.createCheckpoint({ root: process.cwd(), reason: 'before-agent-run', label: `Antes de gemini-code run (${profile.name})` });
          console.log(chalk.dim(`Checkpoint preventivo criado: ${checkpoint.id} (${checkpoint.fileCount} arquivos).\n`));
        }
        const { text } = await runOnce(instruction, {
          allowedTools: profile.tools ? [...profile.tools] : undefined,
          extraSystemInstruction: profile.instructions,
          imagens,
        });
        if (!parsed.json) console.log(text);
        const report = artifacts.createArtifact({ title: instruction.slice(0, 120), type: profile.artifactType, status: 'concluido', summary: text.slice(0, 1000), content: text, cwd: process.cwd(), metadata: { profile: profile.name, allowedTools: profile.tools ? [...profile.tools] : 'session-default', checkpointId: checkpoint && checkpoint.id } });
        if (parsed.json) {
          const u = usage.estado();
          escreverJson({ ok: true, texto: text, perfil: profile.name, artefato: report.id, checkpoint: checkpoint && checkpoint.id, uso: { chamadasNuvem: u.chamadas, chamadasLocais: u.locais, tokensEntrada: u.prompt, tokensSaida: u.saida } });
        } else console.log(chalk.dim(`\nArtefato salvo: ${report.id} (${report.fileName})`));
      } finally {
        toolsIndex.stopMcp();
      }
      return;
    }

    case 'profiles':
    case 'agents': {
      const [sub, name] = rest;
      if (!sub || sub === 'list' || sub === 'listar') {
        console.log(JSON.stringify(agentProfiles.listProfiles(), null, 2));
        return;
      }
      if (sub === 'show' || sub === 'mostrar') {
        if (!name) throw new Error('Uso: gemini-code profiles show NOME');
        const profile = agentProfiles.resolveProfile(name);
        console.log(JSON.stringify({ ...profile, tools: profile.tools ? [...profile.tools] : 'todas as ferramentas autorizadas pela sessão' }, null, 2));
        return;
      }
      throw new Error('Uso: gemini-code profiles list | profiles show NOME');
    }

    case 'aliados':
    case 'aliado': {
      // v0.42.0: agentes pessoais (src/personalAgentCommands.js)
      const r = await aliadosCommands.cli(rest, { mostrar: imprimirLinhas });
      imprimirLinhas(r.linhas);
      if (r.abrirChat) return chatLoop({ agente: r.abrirChat });
      if (r.codigo) process.exitCode = r.codigo;
      if (['run', 'perguntar', 'ask'].includes(String(rest[0] || '').toLowerCase())) toolsIndex.stopMcp();
      // Uma pergunta feita no caminho (assistente, confirmação, s/n de ferramenta) deixa a readline segurando o
      // terminal: sem fechar, o processo só saía com Ctrl+C.
      require('../src/ui/prompt').closeShared();
      return;
    }

    case 'mcp': {
      try { console.log(mcpPresets.comando(rest, { mcpPath: require('../src/config').MCP_PATH })); } catch (err) { console.log(`Erro no mcp.json: ${err.message}`); }
      return;
    }

    case 'config': {
      const [sub, ...args] = rest;
      if (sub === 'set-key') {
        const cfgAtual = loadConfig();
        if (security.isLocked(cfgAtual)) {
          return console.log(
            'A API key está protegida por chave de segurança. Rode "gemini-code config ' +
            'remove-passphrase" primeiro, defina a nova chave, e proteja de novo com "set-passphrase" se quiser.'
          );
        }
        return console.log(saveConfig({ apiKey: args[0] }) && 'API key salva.');
      }
      {
        const linha = configCommands.aplicar(sub, args, saveConfig);
        if (linha !== null) return console.log(linha);
      }
      if (sub === 'set-passphrase') {
        const senha1 = await ask('\nDefina a chave MESTRA (acesso total; não é salva em texto puro nem exibida de novo): ');
        if (!senha1) return console.log('Cancelado: chave vazia.');
        const senha2 = await ask('Confirme a chave mestra: ');
        if (senha1 !== senha2) return console.log('As chaves digitadas não bateram. Nada foi alterado.');
        try {
          security.lock(senha1);
          return console.log(
            'Chave mestra definida. A API key agora fica criptografada em ~/.gemini-code/config.json. ' +
            'Da próxima vez que for usada, o gemini-code vai pedir essa chave automaticamente. ' +
            'Pra dar acesso limitado a outras pessoas sem entregar a chave mestra, use ' +
            '"gemini-code config set-guest-passphrase".'
          );
        } catch (err) {
          return console.log(`Erro: ${err.message}`);
        }
      }
      if (sub === 'unlock') {
        const senha = await ask('\nChave de segurança: ');
        const ok = security.unlock(senha);
        if (!ok) return console.log('Chave de segurança incorreta.');
        const papel = security.getSessionRole();
        return console.log(
          papel === 'guest' ? 'Desbloqueado como convidado (acesso limitado) para esta sessão.' : 'Desbloqueado para esta sessão.'
        );
      }
      if (sub === 'set-guest-passphrase') {
        console.log(chalk.dim('Isso cria/troca uma segunda chave, de acesso limitado, pra dar a amigos.'));
        const senhaMestra = await ask('Chave MESTRA (a tua, pra confirmar que é você): ');
        const senhaConvidado1 = await ask('Nova chave de convidado: ');
        if (!senhaConvidado1) return console.log('Cancelado: chave vazia.');
        const senhaConvidado2 = await ask('Confirme a chave de convidado: ');
        if (senhaConvidado1 !== senhaConvidado2) return console.log('As chaves digitadas não bateram. Nada foi alterado.');
        try {
          security.setGuestPassphrase(senhaMestra, senhaConvidado1);
          return console.log(
            `Chave de convidado definida. Quem destrancar com ela só tem acesso a: ${security.GUEST_ALLOWED_TOOLS.join(', ')} ` +
            '— sem editar/apagar arquivo, sem rodar shell, sem MCP, sem gerar mídia.'
          );
        } catch {
          return console.log('Chave mestra incorreta — nada foi alterado.');
        }
      }
      if (sub === 'remove-guest-passphrase') {
        const senhaMestra = await ask('\nChave MESTRA (pra confirmar que é você): ');
        try {
          security.removeGuestPassphrase(senhaMestra);
          return console.log('Chave de convidado removida.');
        } catch {
          return console.log('Chave mestra incorreta — nada foi alterado.');
        }
      }
      if (sub === 'remove-passphrase') {
        const senha = await ask('\nChave de segurança atual (pra remover a proteção): ');
        try {
          security.removePassphrase(senha);
          return console.log('Chave de segurança removida. A API key volta a ficar em texto puro no config.json.');
        } catch {
          return console.log('Chave de segurança incorreta — nada foi alterado.');
        }
      }
      if (sub === 'show') {
        const cfg = loadConfig();
        const mostrar = { ...cfg };
        // Nunca imprime segredo em texto puro na tela, mesmo desbloqueado —
        // evita vazar em print/screenshot/log de terminal. Ver src/security.js.
        if (mostrar.apiKey) mostrar.apiKey = security.mascarar(mostrar.apiKey);
        if (mostrar.openaiApiKey) mostrar.openaiApiKey = security.mascarar(mostrar.openaiApiKey);
        if (mostrar.apiKeyLocked) mostrar.apiKeyLocked = '(protegida por chave mestra — "gemini-code config unlock")';
        if (mostrar.apiKeyLockedGuest) mostrar.apiKeyLockedGuest = '(chave de convidado configurada, acesso limitado)';
        return console.log(JSON.stringify(mostrar, null, 2));
      }
      return console.log(
        'Uso: gemini-code config set-key SUA_CHAVE | set-model NOME | set-fast-model NOME | ' +
        'set-fallback-model [NOME] | set-wait-quota SEGUNDOS | set-provider hybrid|llamacpp|gemini|openai|ollama|code-ia | set-openai-key CHAVE | set-openai-model NOME | set-openai-url URL | set-hybrid-cloud gemini|openai | ' +
        'set-llamacpp-url URL | set-llamacpp-model NOME | set-llamacpp-path CAMINHO | set-llamacpp-ctx TOKENS | set-llamacpp-autostart on|off | set-ollama-model NOME | ' +
        'set-ollama-url URL | set-passphrase | unlock | remove-passphrase | ' +
        'set-guest-passphrase | remove-guest-passphrase | show'
      );
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
        if (bloquearSeConvidado('geração de imagem (custa cota da API do dono).')) return;
        const r = await designTools.makeImage(prompt, outDir);
        console.log(`Imagem gerada: ${r.outPath}`);
      } else {
        console.log('Uso: gemini-code design [slides|doc|image] "descrição" [pasta]');
      }
      return;
    }

    case 'media': {
      if (bloquearSeConvidado('geração de vídeo/música/som (custa cota da API do dono).')) return;
      const [sub, prompt, outDir = './saida-media'] = rest;
      if (sub === 'video') console.log((await mediaTools.makeVideo(prompt, outDir)).outPath);
      else if (sub === 'music') console.log((await mediaTools.makeMusic(prompt, outDir)).outPath);
      else if (sub === 'sound') console.log((await mediaTools.makeSound(prompt, outDir)).outPath);
      else console.log('Uso: gemini-code media [video|music|sound] "descrição" [pasta]');
      return;
    }

    case 'voice': {
      const [sub, ...args] = rest;
      if (sub === 'say') return await voice.speak(args.join(' '));
      if (sub === 'listen') {
        const text = await voice.listen();
        console.log(`Você disse: ${text}`);
        const { text: reply } = await runOnce(text);
        console.log(reply);
        await voice.speak(reply.slice(0, 500));
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

    case 'models': {
      const { listarModelos } = require('../src/gemini');
      try {
        const modelos = await listarModelos();
        if (!modelos.length) return console.log('Nenhum modelo Gemini disponível para essa chave.');
        console.log('Modelos que sua chave pode usar (gemini-code config set-model NOME):\n');
        for (const m of modelos) console.log('  ' + m.name + (m.displayName ? '  — ' + m.displayName : ''));
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        process.exitCode = 1;
      }
      return;
    }

    case 'code-ia':
    case 'codeia': {
      const ci = require('../src/code-ia/install');
      const { responder } = require('../src/providers/codeia');
      const { completar } = require('../src/code-ia/model');
      const [sub, ...args] = rest;
      const log = (m) => console.log(chalk.dim(m));
      try {
        if (sub === 'status' || !sub) {
          const r = ci.ensureInstalled({ log });
          const cfg = loadConfig();
          console.log(`code-ia: ${r.acao === 'ok' ? 'instalado e em dia' : r.acao}\n` +
            `  arquivo:   ${ci.modelPath()}\n  corpus:    ${r.stats.arquivos} arquivos, ${r.stats.blocos} blocos de conhecimento\n` +
            `  gerador:   ${r.stats.blocosDeCodigo} trechos de código (${r.stats.tokensDeCodigo} tokens), contexto de até 12 tokens\n` +
            `  ensinar:   gemini-code code-ia learn arquivo.md (pasta: ${ci.learnDir()})\n` +
            `  em uso:    provider=${cfg.provider}${!cfg.apiKey && cfg.codeIaAuto !== false ? ' (sem chave da nuvem → usa llama.cpp local)' : ''}`);
        } else if (sub === 'ask') {
          if (!args.length) throw new Error('Uso: gemini-code code-ia ask "pergunta"');
          console.log(responder(ci.ensureInstalled({ log }).modelo, args.join(' ')));
        } else if (sub === 'complete') {
          if (!args.length) throw new Error('Uso: gemini-code code-ia complete "trecho de código"');
          const trecho = args.join(' ');
          const cont = completar(ci.ensureInstalled({ log }).modelo, trecho);
          console.log(cont ? trecho + cont : '(o code-ia não aprendeu nada parecido com esse trecho; ensine com "code-ia learn")');
        } else if (sub === 'learn') {
          if (!args[0]) throw new Error('Uso: gemini-code code-ia learn <arquivo|pasta> (.md/.txt ou código)');
          const r = ci.ensinar(args[0], { log });
          console.log(`Aprendi ${r.copiados} arquivo(s). Agora o code-ia tem ${r.stats.blocos} blocos de conhecimento.`);
        } else if (sub === 'teach') {
          if (args.length < 2) throw new Error('Uso: gemini-code code-ia teach "pergunta" "resposta"');
          const r = ci.anotar(args[0], args.slice(1).join(' '), { log });
          console.log(`${r.substituiu ? 'Atualizei' : 'Aprendi'}! O code-ia agora tem ${r.stats.blocos} blocos de conhecimento.`);
        } else if (sub === 'notes') {
          const l = ci.listarAnotacoes();
          console.log(l.length ? l.map((t) => `- ${t}`).join('\n') : 'Nada ensinado com teach ainda.');
        } else if (sub === 'unteach') {
          if (!args[0]) throw new Error('Uso: gemini-code code-ia unteach "pergunta"');
          const r = ci.esquecerAnotacao(args.join(' '), { log });
          console.log(`Esqueci: ${r.esquecida}. Sobraram ${r.stats.blocos} blocos.`);
        } else if (sub === 'forget') {
          const r = ci.esquecer({ log });
          console.log(`Esqueci tudo que foi ensinado. Sobraram ${r.stats.blocos} blocos do corpus base.`);
        } else if (sub === 'reinstall') {
          try { fs.rmSync(ci.modelPath(), { force: true }); } catch { /* já não existe */ }
          ci.limparCache();
          const r = ci.ensureInstalled({ log });
          console.log(`code-ia refeito: ${r.stats.blocos} blocos.`);
        } else {
          console.log('Uso: gemini-code code-ia status | ask "pergunta" | complete "trecho" | learn <arquivo|pasta> | teach "pergunta" "resposta" | notes | unteach "pergunta" | forget | reinstall');
        }
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        process.exitCode = 1;
      }
      return;
    }

    case 'ollama': {
      const [sub] = rest;
      const { listarModelosLocais } = require('../src/providers/ollama');
      if (sub === 'models' || sub === 'status') {
        try {
          const modelos = await listarModelosLocais();
          if (sub === 'status') {
            const cfg = loadConfig();
            console.log(`Ollama respondendo. Modelo configurado: ${cfg.ollamaModel} — ${modelos.some((m) => m.name === cfg.ollamaModel || m.name === cfg.ollamaModel + ':latest') ? 'instalado' : 'NÃO instalado (ollama pull ' + cfg.ollamaModel + ')'}`);
            return;
          }
          if (!modelos.length) return console.log('Nenhum modelo instalado. Ex.: ollama pull qwen3:4b-instruct');
          console.log('Modelos locais (gemini-code config set-ollama-model NOME):\n');
          for (const m of modelos) console.log('  ' + m.name + (m.sizeGB ? `  (${m.sizeGB} GB)` : ''));
        } catch (err) {
          console.error(chalk.red(err.message));
          process.exitCode = 1;
        }
        return;
      }
      return console.log('Uso: gemini-code ollama models | status');
    }

    case 'llamacpp': {
      const [sub, ...resto] = rest;
      const llama = require('../src/providers/llamacpp');
      const servidor = require('../src/localServer');
      const cfgL = loadConfig();
      if (sub === 'status') {
        const result = await llama.status();
        if (result.ok) console.log(`llama.cpp respondendo em ${result.url} (contexto configurado: ${llama.ctxTamanho(cfgL)} tokens)`);
        else if (result.estado === 'carregando') console.log(`llama.cpp está carregando o modelo em ${result.url}; aguarde e rode de novo.`);
        else { console.log(`llama.cpp não respondeu em ${result.url}: ${result.error || `HTTP ${result.status}`}\nPara subir: gemini-code llamacpp start`); process.exitCode = 1; }
        return;
      }
      if (sub === 'start') {
        const r = await servidor.iniciar({ url: llama.baseUrl(cfgL), ctx: llama.ctxTamanho(cfgL), status: llama.status, config: cfgL, log: (m) => console.log(m) });
        console.log(r.mensagem);
        if (!r.ok) process.exitCode = 1;
        return;
      }
      if (sub === 'stop') {
        const r = servidor.parar();
        console.log(r.mensagem);
        if (!r.ok) process.exitCode = 1;
        return;
      }
      if (sub === 'log') {
        try { const t = fs.readFileSync(servidor.logPath(), 'utf8'); console.log(t.split('\n').slice(-40).join('\n')); } catch { console.log('Ainda não há log do llama-server.'); }
        return;
      }
      void resto;
      return console.log('Uso: gemini-code llamacpp status | start | stop | log');
    }

    case 'knowledge': {
      const [sub, alvo] = rest;
      const knowledge = require('../src/knowledge');
      if (sub === 'add') {
        if (!alvo) return console.log('Uso: gemini-code knowledge add <arquivo.md|pasta>');
        try {
          const copiados = knowledge.addKnowledge(alvo);
          if (!copiados.length) return console.log('Nada copiado (a pasta não tem .md/.txt).');
          copiados.forEach((c) => console.log('Adicionado: ' + c));
        } catch (err) {
          console.error(chalk.red('Erro: ' + err.message));
          process.exitCode = 1;
        }
        return;
      }
      if (sub === 'list') {
        const { files, text, truncated } = knowledge.loadKnowledge({ maxChars: Number(loadConfig().knowledgeMaxChars) || 10000 });
        if (!files.length) return console.log(`Nenhum conhecimento fixo. Coloque .md em ${knowledge.knowledgeDir()} ou um GEMINI.md no projeto.`);
        files.forEach((f) => console.log('- ' + f));
        console.log(`\n${text.length} caracteres carregados no prompt${truncated ? ' (CORTADO pelo limite knowledgeMaxChars)' : ''}.`);
        return;
      }
      return console.log('Uso: gemini-code knowledge add <arquivo.md|pasta> | list');
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
        // v0.24.0: se for workflow, a execução entra no histórico (/workflows historico), marcada "terminal".
        const arqRun = path.resolve(agentPath);
        let nomeWf = null;
        try { const d = JSON.parse(fs.readFileSync(arqRun, 'utf8')); if (d && Array.isArray(d.steps)) nomeWf = String(d.name || path.basename(arqRun, '.json')); } catch { /* o runAgentFile mostra o erro de JSON */ }
        const outcome = nomeWf
          ? await workflowTools.rodarComHistorico(nomeWf, () => runAgentFile(arqRun))
          : await runAgentFile(arqRun);
        // Só fecha as conexões MCP quando o workflow termina de rodar; numa
        // persona o chat fica aberto (igual ao comando "chat") e fechar aqui
        // cortaria as ferramentas MCP no meio da conversa.
        if (outcome.type === 'workflow') toolsIndex.stopMcp();
        return;
      }
      if (sub === 'check') {
        // v0.19.0: valida um workflow SEM rodar e sem gastar IA (aceita caminho ou o nome de um workflow salvo)
        if (!agentPath) return console.log('Uso: gemini-code agent check caminho/workflow.json  (ou o nome de um workflow salvo)');
        const arq = fs.existsSync(agentPath) ? path.resolve(agentPath) : path.join(WORKFLOWS_DIR, `${agentPath.replace(/\.json$/, '')}.json`);
        if (!fs.existsSync(arq)) return console.log(`Não achei ${arq}`);
        const { erros, avisos } = workflowTools.validarArquivo(arq);
        for (const e of erros) console.log(chalk.red('ERRO  ') + e);
        for (const a of avisos) console.log(chalk.yellow('AVISO ') + a);
        console.log(erros.length ? chalk.red(`\n${erros.length} erro(s): corrija antes de rodar.`) : chalk.green(`\nOK${avisos.length ? ` (${avisos.length} aviso(s))` : ''}.`));
        if (erros.length) process.exitCode = 1;
        return;
      }
      return console.log(`Uso: gemini-code agent run|check caminho/workflow-ou-agente.json (pasta padrão: ${WORKFLOWS_DIR} ou ${AGENTS_DIR})`);
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
      if (sub === 'novo-token') {
        // v0.43.0: o protocolo antigo mandava o token aberto na rede; depois de atualizar os dois lados, troque-o.
        const token = require('../src/cowork/server').novoToken();
        console.log(`Token novo do cowork (o anterior não vale mais): ${token}\nReinicie o "cowork server" e use este token no celular.`);
        return;
      }
      return console.log('Uso: gemini-code cowork server [porta] | gemini-code cowork connect <ip> --token X [--port P] | gemini-code cowork novo-token');
    }

    case 'ciencia': {
      const pergunta = rest.join(' ');
      if (!pergunta) {
        console.log('Uso: gemini-code ciencia "pergunta" (ex.: "quanto tempo passa em 1 segundo perto de um buraco negro?")');
        return;
      }
      const { text } = await runOnce(pergunta, { extraSystemInstruction: INSTRUCAO_MODO_CIENCIA });
      console.log(text);
      toolsIndex.stopMcp();
      return;
    }

    case 'sessions': {
      const [sub, ...args] = rest;
      try {
        if (sub === 'list' || sub === 'listar' || !sub) {
          const items = sessions.list();
          console.log(items.length ? items.map((s) => `${s.id} | ${s.name} | ${s.messageCount} mensagens | ${s.updatedAt}`).join('\n') : 'Nenhuma sessão persistente.');
        } else if (sub === 'new' || sub === 'nova') {
          const created = sessions.create(args.join(' ') || undefined);
          console.log(`Sessão criada e definida como ativa: ${created.id} | ${created.name}`);
        } else if (sub === 'show' || sub === 'ver') {
          const session = sessions.get(args[0]);
          if (!session) throw new Error('Sessão não encontrada.');
          console.log(JSON.stringify({ ...session, history: `[${session.history.length} mensagens]` }, null, 2));
        } else if (sub === 'use' || sub === 'resume' || sub === 'retomar') {
          const session = sessions.setActive(args[0]);
          console.log(`Sessão ativa: ${session.id} | ${session.name}`);
        } else if (sub === 'delete' || sub === 'remover') {
          if (!args.includes('--yes')) throw new Error('Exclusão exige --yes.');
          const id = args.find((a) => !a.startsWith('--'));
          console.log(sessions.remove(id, { yes: true }) ? 'Sessão removida.' : 'Sessão não encontrada.');
        } else {
          console.log('Uso: sessions list | new [nome] | show ID | use ID | delete ID --yes');
        }
      } catch (err) { console.error(chalk.red(`Erro: ${err.message}`)); process.exitCode = 1; }
      return;
    }

    case 'checkpoints': {
      const [sub, ...args] = rest;
      const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
      const root = option('root') || process.cwd();
      try {
        if (sub === 'create' || sub === 'criar') {
          const label = option('label') || args.filter((a, i) => !a.startsWith('--') && (i === 0 || args[i - 1] !== '--root' && args[i - 1] !== '--label')).join(' ');
          const cp = checkpoints.createCheckpoint({ root, label, reason: 'CLI manual' });
          console.log(`Checkpoint criado: ${cp.id}\nWorkspace: ${cp.root}\nArquivos: ${cp.fileCount}; tamanho: ${cp.totalBytes} bytes\nSegredos comuns, .git e node_modules são ignorados.`);
        } else if (sub === 'list' || sub === 'listar' || !sub) {
          const list = checkpoints.listCheckpoints({ root: option('root') ? path.resolve(root) : undefined });
          console.log(list.length ? list.map((cp) => `${cp.id} | ${cp.fileCount} arquivos | ${cp.createdAt} | ${cp.label || cp.reason}`).join('\n') : 'Nenhum checkpoint encontrado.');
        } else if (sub === 'restore' || sub === 'restaurar') {
          if (!args.includes('--yes')) throw new Error('A restauração altera arquivos do projeto. Revise o checkpoint e confirme com --yes.');
          const id = args.find((a) => !a.startsWith('--'));
          const result = checkpoints.restoreCheckpoint(id, { yes: true, root });
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('Uso: checkpoints create [--root PASTA] [--label TEXTO] | list [--root PASTA] | restore ID --yes [--root PASTA]');
        }
      } catch (err) { console.error(chalk.red(`Erro: ${err.message}`)); process.exitCode = 1; }
      return;
    }

    case 'artifacts': {
      const [sub, ...args] = rest;
      try {
        if (sub === 'list' || sub === 'listar' || !sub) {
          const list = artifacts.listArtifacts({ limit: Number(args[0] || 30) });
          console.log(list.length ? list.map((a) => `${a.id} | ${a.status} | ${a.type} | ${a.title} | ${a.createdAt}`).join('\n') : 'Nenhum artefato salvo.');
        } else if (sub === 'show' || sub === 'ver') {
          const item = artifacts.readArtifact(args[0]);
          if (!item) throw new Error('Artefato não encontrado.');
          console.log(`# ${item.title}\nID: ${item.id}\nTipo: ${item.type} | Estado: ${item.status}\nCriado: ${item.createdAt}\nSHA-256: ${item.sha256}\n\n${item.content}`);
        } else {
          console.log('Uso: artifacts list [limite] | artifacts show ID');
        }
      } catch (err) { console.error(chalk.red(`Erro: ${err.message}`)); process.exitCode = 1; }
      return;
    }

    case 'context': {
      const [sub] = rest;
      if (sub !== 'show' && sub !== 'mostrar' && sub !== undefined) {
        console.log('Uso: context show'); return;
      }
      const cfg = loadConfig();
      const result = knowledgeModule.loadKnowledge({ cwd: process.cwd(), maxChars: Number(cfg.knowledgeMaxChars) || 10000 });
      console.log(JSON.stringify({ cwd: process.cwd(), files: result.files, chars: result.text.length, truncated: result.truncated, text: result.text }, null, 2));
      return;
    }

    case 'security': {
      const [sub, folder] = rest;
      if (sub !== 'scan' && sub !== 'verificar') {
        console.log('Uso: gemini-code security scan [pasta]'); return;
      }
      try {
        const scanner = require('../src/securityScan');
        const report = scanner.scanSecrets(folder || process.cwd());
        console.log(JSON.stringify(report, null, 2));
        if (report.findings.length) process.exitCode = 2;
      } catch (err) {
        console.error(chalk.red(`Erro: ${err.message}`)); process.exitCode = 1;
      }
      return;
    }

    case 'solo': {
      const [sub] = rest;
      const soloMod = require('../src/solo');
      const cfgS = loadConfig();
      if (sub === 'on') {
        const antes = cfgS.provider !== 'code-ia' ? cfgS.provider : (cfgS.providerAntesDoSolo || 'hybrid');
        saveConfig({ modoSolo: true, provider: 'code-ia', providerAntesDoSolo: antes });
        try { require('../src/localServer').parar(); } catch { /* nada rodando */ }
        const info = require('../src/code-ia/install').ensureInstalled({ log: (m) => console.log(chalk.dim(m)) });
        console.log(`Modo solo LIGADO: só o code-ia responde (${info.stats ? info.stats.blocos : '?'} blocos de conhecimento).\nBloqueado: Gemini, llama.cpp, Ollama, design/media/live/models e qualquer API de IA online. Servidor llama.cpp parado, se estava no ar.\nPara voltar: gemini-code solo off`);
        return;
      }
      if (sub === 'off') {
        saveConfig({ modoSolo: false, provider: cfgS.providerAntesDoSolo || 'hybrid' });
        console.log(`Modo solo desligado. Provedor: ${cfgS.providerAntesDoSolo || 'hybrid'}.`);
        return;
      }
      if (sub === undefined || sub === 'status') {
        const lig = soloMod.ativo(cfgS);
        console.log(lig
          ? 'Modo solo: LIGADO — só o code-ia roda; nenhuma outra IA é chamada (roteador travado, comandos de IA recusados, rede de IA bloqueada).'
          : 'Modo solo: desligado. Ligue com: gemini-code solo on (o code-ia passa a rodar sozinho, sem Gemini/llama.cpp/Ollama).');
        return;
      }
      return console.log('Uso: gemini-code solo on | off | status');
    }

    case 'doctor': {
      const { spawnSync } = require('child_process');
      const which = (name) => {
        const r = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', timeout: 3000 });
        return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
      };
      const cfg = loadConfig();
      const bins = ['git', 'claude', 'codex', 'agy', 'hermes', 'kimi', 'kimi-code', 'higgsfield', 'ollama', 'docker'].map((name) => { const binPath = which(name); return { name, available: !!binPath, path: binPath }; });
      const report = { node: process.version, platform: process.platform, cwd: process.cwd(), provider: cfg.provider, model: cfg.model, ollamaModel: cfg.ollamaModel, codeIa: (() => { try { const i = require('../src/code-ia/install'); return { instalado: fs.existsSync(i.modelPath()), arquivo: i.modelPath() }; } catch { return { instalado: false }; } })(), modoSolo: require('../src/solo').ativo(cfg), geminiKeyConfigured: Boolean(cfg.apiKey), llamaCpp: (() => { const srv = require('../src/localServer'); const c = srv.caminhos(); const l = require('../src/providers/llamacpp'); let livreMB = null; try { const st = fs.statfsSync(require('os').homedir()); livreMB = Math.round((st.bavail * st.bsize) / 1048576); } catch { /* sem statfs */ } return { servidorBinario: fs.existsSync(c.servidor), modeloGGUF: fs.existsSync(c.modelo), ctx: l.ctxTamanho(cfg), autoStart: cfg.llamaCppAutoStart === true, pid: srv.lerPid(), espacoLivreMB: livreMB }; })(), integrations: bins, note: 'A presença de um executável só indica disponibilidade local; não comprova login, acesso à nuvem ou que a ferramenta funcione corretamente.' };
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    case 'routines': {
      const [sub, ...args] = rest;
      const parseFlags = (items) => {
        const flags = {};
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.startsWith('--')) {
            const key = item.slice(2);
            if (['yes'].includes(key)) flags[key] = true;
            else if (i + 1 < items.length && !items[i + 1].startsWith('--')) flags[key] = items[++i];
            else throw new Error(`Informe um valor para --${key}.`);
          } else if (!flags._) flags._ = [item];
          else flags._.push(item);
        }
        return flags;
      };
      const fmt = (r) => `${r.id} | ${r.status} | ${r.name} | ${r.trigger.type}${r.nextRunAt ? ` | próxima: ${r.nextRunAt}` : ''}`;
      try {
        if (sub === 'list' || sub === 'listar') {
          const lista = routines.list();
          console.log(lista.length ? lista.map(fmt).join('\n') : 'Nenhuma rotina cadastrada.');
          return;
        }
        if (sub === 'create' || sub === 'criar') {
          const flags = parseFlags(args);
          const name = flags.name;
          const url = flags.url;
          const timezone = flags.timezone || routines.DEFAULT_TIMEZONE;
          const triggers = ['every', 'at', 'cron'].filter((k) => flags[k] !== undefined);
          if (!name || !url || triggers.length !== 1) {
            console.log("Uso: gemini-code routines create --name \"Meu site\" --url https://exemplo.com (--every 5m | --at 2026-10-11T08:00:00-03:00 | --cron '*/5 * * * *') [--timezone America/Recife]");
            return;
          }
          let trigger;
          if (flags.every !== undefined) trigger = { type: 'interval', intervalMs: routines.parseDuration(flags.every), timezone };
          if (flags.at !== undefined) trigger = { type: 'once', runAt: flags.at, timezone };
          if (flags.cron !== undefined) trigger = { type: 'cron', expression: flags.cron, timezone };
          const routine = routines.create({
            name, description: flags.description || '', category: flags.category || 'monitoramento',
            priority: flags.priority || 'normal', trigger,
            action: { type: 'http-check', url, timeoutMs: flags.timeout ? routines.parseDuration(flags.timeout) : 10000,
              expectedStatus: flags['expected-status'] ? Number(flags['expected-status']) : undefined },
            missedPolicy: flags['missed-policy'] || 'skip',
          });
          console.log(`Rotina criada como rascunho (não executa automaticamente até ser ativada):\n${fmt(routine)}\nAtive com: gemini-code routines activate ${routine.id}`);
          return;
        }
        if (sub === 'show' || sub === 'ver') {
          const routine = routines.get(args[0]);
          console.log(routine ? JSON.stringify(routine, null, 2) : 'Rotina não encontrada.');
          if (!routine) process.exitCode = 1;
          return;
        }
        if (['activate', 'ativar', 'pause', 'pausar', 'resume', 'retomar'].includes(sub)) {
          const id = args[0];
          if (!id) throw new Error(`Informe o ID da rotina. Uso: gemini-code routines ${sub} ID`);
          let updated;
          if (sub === 'activate' || sub === 'ativar') updated = routines.activate(id);
          else if (sub === 'pause' || sub === 'pausar') updated = routines.pause(id);
          else updated = routines.resume(id);
          console.log(updated ? fmt(updated) : 'Rotina não encontrada.');
          if (!updated) process.exitCode = 1;
          return;
        }
        if (sub === 'run' || sub === 'executar') {
          if (!args[0]) throw new Error('Informe o ID da rotina.');
          const runner = createRoutineRunner({ store: routines });
          const result = await runner.execute(args[0], { source: 'cli' });
          console.log(JSON.stringify(result, null, 2));
          if (result.status === 'falhou') process.exitCode = 1;
          return;
        }
        if (sub === 'logs' || sub === 'historico') {
          const flags = parseFlags(args);
          const id = flags._ && flags._[0];
          const execs = routines.executions({ routineId: id, limit: flags.limit || 30 });
          console.log(execs.length ? execs.map((e) => `${e.id} | ${e.status} | ${e.startedAt} | ${e.routineName} | ${e.error || (e.result && e.result.message) || ''}`).join('\n') : 'Nenhuma execução registrada.');
          return;
        }
        if (sub === 'remove' || sub === 'remover') {
          const flags = parseFlags(args);
          const id = flags._ && flags._[0];
          if (!id || !flags.yes) throw new Error('Para remover, informe ID e confirme com --yes. Somente rascunhos/rotinas pausadas, falhas ou concluídas podem ser removidos.');
          console.log(routines.remove(id) ? 'Rotina removida.' : 'Rotina não encontrada.');
          return;
        }
        if (sub === 'service' || sub === 'servico' || sub === 'worker') {
          const flags = parseFlags(args);
          const port = flags.port ? Number(flags.port) : Number(process.env.ROUTINE_API_PORT || 8787);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida.');
          const runner = createRoutineRunner({ store: routines });
          const api = require('../src/routineApi').startRoutineApi({
            store: routines, runner,
            host: flags.host || process.env.ROUTINE_API_HOST || '127.0.0.1', port,
          });
          const scheduler = runner.start({ pollIntervalMs: Number(flags['poll-ms'] || 15000) });
          console.log(`[rotinas] Serviço iniciado. Estado salvo em ${routines.ROUTINES_PATH}; execuções em ${routines.EXECUTIONS_PATH}.`);
          console.log('[rotinas] O serviço continua enquanto este processo/host estiver ativo; não é hospedagem cloud por si só.');
          const stop = () => {
            scheduler.stop();
            api.server.close(() => process.exit(0));
            setTimeout(() => process.exit(1), 5000).unref();
          };
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
          return;
        }
        if (sub === 'status') {
          const all = routines.list();
          const counts = Object.fromEntries(Object.values(routines.STATUSES).map((status) => [status, all.filter((r) => r.status === status).length]));
          console.log(JSON.stringify({ runtime: 'local-process', scheduler: 'not running unless `routines service` is active', storage: routines.ROUTINES_PATH, count: all.length, counts }, null, 2));
          return;
        }
        console.log('Uso: gemini-code routines list | create --name N --url URL (--every 5m | --at ISO | --cron CRON) | activate ID | pause ID | resume ID | run ID | logs [ID] | remove ID --yes | service | status');
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        process.exitCode = 1;
      }
      return;
    }

    case 'agenda': {
      const [sub, ...args] = rest;
      try {
        if (sub === 'add') {
          const dataIdx = args.indexOf('--data');
          const diaIdx = args.indexOf('--dia');
          const mesIdx = args.indexOf('--mes');
          const anoIdx = args.indexOf('--ano');
          const flagIdxs = [dataIdx, diaIdx, mesIdx, anoIdx].filter((i) => i >= 0);
          const primeiraFlag = flagIdxs.length ? Math.min(...flagIdxs) : args.length;
          const texto = args.slice(0, primeiraFlag).join(' ');
          const evento = agenda.adicionarEvento(texto, {
            data: dataIdx >= 0 ? args[dataIdx + 1] : undefined,
            dia: diaIdx >= 0 ? args[diaIdx + 1] : undefined,
            mes: mesIdx >= 0 ? args[mesIdx + 1] : undefined,
            ano: anoIdx >= 0 ? args[anoIdx + 1] : undefined,
          });
          console.log(`Marcado para ${evento.data}: "${evento.texto}" (id: ${evento.id})`);
        } else if (sub === 'dia') {
          const { data, eventos } = agenda.eventosDoDia({ dia: args[0] });
          console.log(eventos.length ? `Em ${data}:\n${eventos.map(formatarEvento).join('\n')}` : `Nada marcado em ${data}.`);
        } else if (sub === 'listar') {
          const eventos = agenda.listarEventos();
          console.log(eventos.length ? eventos.map(formatarEvento).join('\n') : 'Agenda vazia.');
        } else if (sub === 'remover') {
          console.log(agenda.removerEvento(args[0]) ? 'Removido.' : 'Id não encontrado.');
        } else {
          console.log('Uso: gemini-code agenda add "texto" --dia N | agenda dia N | agenda listar | agenda remover ID');
        }
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        process.exitCode = 1;
      }
      return;
    }

    case 'sub': {
      const args = rest.slice();
      let tipo = 'explorador';
      const i = args.indexOf('--tipo');
      if (i !== -1) { tipo = args[i + 1] || ''; args.splice(i, 2); }
      const tarefa = args.join(' ').trim();
      if (!tarefa) return console.log('Uso: gemini-code sub "tarefa" [--tipo explorador|revisor|executor]');
      const subagent = require('../src/subagent');
      if (!subagent.TIPOS[tipo]) return console.log(`Tipo desconhecido: "${tipo}". Use: ${Object.keys(subagent.TIPOS).join(', ')}.`);
      const out = await subagent.execute('delegate_task', { task: tarefa, type: tipo }, { allowedPai: security.restringirParaSessao(undefined) });
      console.log('\n' + out);
      toolsIndex.stopMcp();
      return;
    }

    case 'backups': {
      const [a, b, c] = rest;
      const restaurar = a === 'restore';
      const arquivo = restaurar ? b : a;
      if (!arquivo) return console.log('Uso: gemini-code backups arquivo | backups restore arquivo [N]');
      try {
        if (restaurar) {
          const r = backup.restaurarBackup(arquivo, c || 1);
          console.log(`Restaurado: ${arquivo} ← ${r.restaurado}`);
          if (r.backupDoAtual) console.log(chalk.dim(`(o conteúdo anterior foi guardado em ${r.backupDoAtual})`));
          return;
        }
        const lista = backup.listarBackups(arquivo);
        if (!lista.length) return console.log(`Nenhum backup de ${arquivo}.`);
        lista.forEach((x, i) => console.log(`${i + 1}. ${x.nome.replace('.bak', '')}  (${x.bytes} bytes)`));
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        process.exitCode = 1;
      }
      return;
    }

    case 'projetos': {
      const [sub, ...args] = rest;
      try {
        if (sub === 'add') {
          const [nome, pasta] = args;
          const projeto = projetos.adicionarProjeto(nome, { pasta: pasta || '' });
          console.log(`Projeto registrado: ${projeto.nome}${projeto.pasta ? ` (${projeto.pasta})` : ''}`);
        } else if (sub === 'listar') {
          const lista = projetos.listarProjetos();
          console.log(lista.length
            ? lista.map((p) => `  ${p.nome}${p.pasta ? ` (${p.pasta})` : ''}${p.nota ? ` — ${p.nota}` : ''}`).join('\n')
            : 'Nenhum projeto registrado.');
        } else if (sub === 'remover') {
          console.log(projetos.removerProjeto(args[0]) ? 'Removido.' : 'Não encontrado.');
        } else {
          console.log('Uso: gemini-code projetos add "nome" [pasta] | projetos listar | projetos remover "nome"');
        }
      } catch (err) {
        console.error(chalk.red('Erro: ' + err.message));
        process.exitCode = 1;
      }
      return;
    }

    default:
      console.log(`Comando desconhecido: ${cmd}`);
      printHelp();
  }
}

main().catch((err) => {
  if (MODO_JSON) escreverJson({ ok: false, erro: err.message });
  else console.error(chalk.red('Erro fatal: ' + err.message));
  process.exit(1);
});
