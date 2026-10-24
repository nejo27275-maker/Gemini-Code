// src/agent.js
// Loop agentivo: manda a mensagem pro Gemini junto com a lista de
// ferramentas; se o modelo pedir para chamar uma ferramenta, executa e
// devolve o resultado, repetindo até o modelo responder só com texto.
'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('./terminalColors');
const { loadConfig } = require('./config');
const { chatWithTools } = require('./provider');
const tools = require('./tools');
const { listSkills } = require('./skills/loader');
const { loadKnowledge } = require('./knowledge');
const { logAcao } = require('./decisionLog');
const security = require('./security');
const subagent = require('./subagent');
const hooks = require('./hooks');
const stepApproval = require('./stepApproval');
const loopGuard = require('./loopGuard');
const outputCompact = require('./outputCompact');
const { enxugarResultadosAntigos } = require('./compact');
const permissions = require('./permissions');
const { partesComImagens, tirarImagensDoHistorico } = require('./imagens');

// Item 4 do roadmap "top 1" (set/2026): antes o agente só sabia em que
// projeto estava se o usuário explicasse (nome, stack, scripts disponíveis)
// — toda sessão nova repetia essa explicação. Agora lê alguns arquivos
// marcadores do cwd (onde o gemini-code foi iniciado) e resume no próprio
// system prompt: nome/scripts do package.json, ou presença de
// requirements.txt/pyproject.toml. Só um resumo curto — não substitui
// read_file para o agente examinar o projeto a fundo quando precisar.
function resumoContextoProjeto(cwd) {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = Object.keys(pkg.scripts || {});
      return (
        `Projeto Node.js detectado no diretório atual: "${pkg.name || '(sem nome)'}"` +
        (scripts.length ? `, scripts disponíveis: ${scripts.join(', ')}.` : ', sem scripts definidos.')
      );
    }
    if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
      return 'Projeto Python detectado no diretório atual (requirements.txt/pyproject.toml presente).';
    }
  } catch { /* detecção é best-effort, não deve travar o agente */ }
  return '';
}

function buildSystemInstruction(extra, { cwd = process.cwd() } = {}) {
  let linhaWorkflows = '';
  try { linhaWorkflows = require('./tools/workflowTools').resumoParaPrompt(); } catch { /* sem workflows */ }
  const skills = listSkills();
  const skillsList = skills.length
    ? skills.map((s) => `- ${s.name}: ${s.description} (ler com read_skill em "${s.path}")`).join('\n')
    : '(nenhuma skill instalada em ~/.gemini-code/skills)';

  const contextoProjeto = resumoContextoProjeto(cwd);

  const base = (
    'Você é o gemini-code, um agente de programação e automação que roda no ' +
    'terminal (Termux/Linux), no mesmo espírito do Claude Code. Você pode ler e ' +
    'escrever arquivos, rodar comandos de shell, chamar ferramentas de MCP ' +
    'conectadas e consultar skills para seguir boas práticas em tarefas específicas. ' +
    'Seja direto, explique o que vai fazer antes de rodar comandos que alteram o ' +
    'sistema, e prefira soluções simples e corretas.\n\n' +
    'Depois de editar ou criar código (write_file/edit_file em arquivos de código, não em ' +
    'documentos soltos), chame run_checks para rodar os testes/lint do projeto que está sendo ' +
    'editado. Se algo falhar, leia a saída, corrija e rode run_checks de novo antes de dizer que a ' +
    'tarefa está concluída — não pare no primeiro erro. Se run_checks disser que não há verificação ' +
    'reconhecida, siga em frente normalmente.\n\n' +
    'Para investigações grandes (ler/buscar em muitos arquivos), revisões ou subtarefas independentes, use ' +
    'delegate_task: o subagente trabalha em contexto próprio e devolve só um relatório. Para tarefas ' +
    'pequenas, faça você mesmo — delegar custa uma chamada extra.\n\n' +
    'Em trabalho com 3 ou mais passos, escreva o plano com todo_write antes de começar, mantenha UMA ' +
    'tarefa in_progress e marque cada uma como completed assim que terminar. Em pedido simples, não use.\n\n' +
    (linhaWorkflows ? linhaWorkflows + ' Se o pedido combina com um deles, chame run_workflow sem "name" para ver as descrições e depois com o nome.\n\n' : '') +
    (contextoProjeto ? contextoProjeto + '\n\n' : '') +
    'Skills disponíveis:\n' + skillsList
  );

  // Conhecimento fixo (spec da NetoLang, convenções do projeto...): entra
  // direto no prompt, sem depender do modelo chamar uma ferramenta pra ler.
  let conhecimento = '';
  try {
    const { text } = loadKnowledge({ cwd, maxChars: Number(loadConfig().knowledgeMaxChars) || 10000 });
    if (text) {
      conhecimento =
        '\n\nConhecimento fixo sobre o usuário e os projetos dele (siga estas convenções e ' +
        'sintaxes à risca; em caso de conflito com seu conhecimento geral, estes arquivos vencem):\n\n' + text;
    }
  } catch { /* sem conhecimento fixo: segue normal */ }

  // "extra" é a instrução adicional de uma persona (agents/*.json,
  // campo "systemInstructionExtra") — antes esse campo existia no JSON de
  // exemplo mas não era lido em lugar nenhum do código.
  // v0.42.0: o extra (persona, perfil, modo plano, agente pessoal) vem ANTES do conhecimento fixo. O provedor
  // local corta o system pelo fim para caber em contextos pequenos (compactarSistema em src/providers/llamacpp.js):
  // com o extra no fim, era o papel do agente que sumia primeiro, e não o conhecimento.
  return extra ? `${base}\n\n${extra}${conhecimento}` : base + conhecimento;
}

// Item 5 da revisão (set/2026): em sessões longas de chat/cowork, `history`
// só crescia — cada chamada manda o histórico inteiro de volta pro Gemini,
// o que aumenta custo a cada turno e eventualmente estoura o limite de
// contexto do modelo (ou fica bem lento). Poda simples: acima de
// MAX_TURNOS_HISTORICO mensagens, mantém as 2 primeiras (contexto inicial da
// conversa) + as últimas MANTER_RECENTES, descartando o meio.
const MAX_TURNOS_HISTORICO = 40;
const MAX_CONTINUACOES_STOP = 3; // hook Stop não pode prender o agente num laço sem fim
const MANTER_RECENTES = 30;

// Correção (v0.3.6): o corte antigo (`slice(0, 2)` + `slice(-30)`) ignorava a
// estrutura das chamadas de ferramenta. Numa tarefa longa (dezenas de passos
// de ferramenta numa única `runOnce`) o corte podia deixar um `functionCall`
// do modelo sem o `functionResponse` correspondente, ou começar o trecho
// recente em cima de um `functionResponse` órfão — e a API do Gemini rejeita
// isso com erro 400. Agora o corte sempre cai numa fronteira segura: o trecho
// recente começa numa mensagem de texto do usuário (nunca no meio de um par
// chamada/resposta) e o início preservado não termina numa chamada pendente.
function textoDe(v) {
  if (v == null) return '(sem resultado)';
  if (typeof v === 'object') {
    try { return JSON.stringify(v, null, 2); } catch { /* circular etc. */ }
  }
  return String(v);
}

// v0.3.8: o corte pelo INÍCIO escondia justamente o que importa em saída de
// comando — o erro do teste/build vem no FIM. Para run_shell e run_checks
// mantém começo + fim e omite o meio; as demais ferramentas seguem como antes.
const LIMITE_RESULTADO = 20000;
const FERRAMENTAS_COM_FIM_IMPORTANTE = new Set(['run_shell', 'run_checks']);

function cortarResultado(nomeFerramenta, texto) {
  // v0.33.0: saída de comando perde cores ANSI, barras de progresso e linhas repetidas antes do corte (menos tokens).
  if (FERRAMENTAS_COM_FIM_IMPORTANTE.has(nomeFerramenta)) texto = outputCompact.compactar(texto);
  if (texto.length <= LIMITE_RESULTADO) return texto;
  if (FERRAMENTAS_COM_FIM_IMPORTANTE.has(nomeFerramenta)) {
    const inicio = 5000;
    const fim = LIMITE_RESULTADO - inicio;
    const omitidos = texto.length - LIMITE_RESULTADO;
    return (
      texto.slice(0, inicio) +
      `\n\n[... ${omitidos} caracteres do meio omitidos (total: ${texto.length}); mostrando o início e o FIM da saída ...]\n\n` +
      texto.slice(-fim)
    );
  }
  return texto.slice(0, LIMITE_RESULTADO) + `\n\n[... resultado truncado: mostrando ${LIMITE_RESULTADO} de ${texto.length} caracteres]`;
}

function temParte(msg, chave) {
  return Array.isArray(msg && msg.parts) && msg.parts.some((p) => p && p[chave]);
}

function podarHistorico(convo) {
  if (convo.length <= MAX_TURNOS_HISTORICO) return convo;

  // Início: a 1ª mensagem; a 2ª só entra se for resposta de texto do modelo
  // (sem chamar ferramenta — senão ficaria sem o functionResponse).
  const inicio = convo.slice(0, 2);
  if (inicio.length === 2 && inicio[1].role === 'model' && temParte(inicio[1], 'functionCall')) {
    inicio.pop();
  }

  // Trecho recente: recua até uma mensagem de usuário que NÃO seja um
  // functionResponse (assim o par chamada→resposta fica inteiro).
  let corte = convo.length - MANTER_RECENTES;
  while (corte > inicio.length && (convo[corte].role !== 'user' || temParte(convo[corte], 'functionResponse'))) {
    corte--;
  }
  // Nada seguro para descartar: melhor mandar tudo do que quebrar a API.
  if (corte <= inicio.length) return convo;

  const aviso = {
    role: 'user',
    parts: [{ text: '[...histórico do meio da conversa foi omitido para economizar contexto...]' }],
  };
  return [...inicio, aviso, ...convo.slice(corte)];
}

/**
 * Roda uma única "rodada" do agente para uma instrução do usuário.
 *
 * `onText`, se passado, é chamado com cada pedaço de texto conforme ele
 * chega (streaming — item 4 da revisão). Quem chama runOnce com `onText` já
 * terá visto o texto completo impresso incrementalmente quando a promise
 * resolver, então não deve reimprimir `result.text`.
 *
 * `deps`, se passado, sobrescreve as dependências externas (`loadConfig`,
 * `chatWithTools`, `getAllDeclarations`, `execute`, `buildSystemInstruction`)
 * — existe só para testar o loop sem chamar a API do Gemini, o sistema de
 * arquivos real ou ferramentas de verdade (ver tests/agent.test.js). Em uso
 * normal (CLI) ninguém passa `deps` e o comportamento é idêntico ao de antes.
 */
async function runOnce(userMessage, opts = {}) {
  // `imagens` (v0.41.0): [{ inlineData: {mimeType, data} }] de src/imagens.js, enviadas junto com a mensagem.
  const { history = [], modelName, extraSystemInstruction, allowedTools, onText, deps = {}, maxSteps = 60, logPrefix = '', imagens = [] } = opts;
  const loadConfigFn = deps.loadConfig || loadConfig;
  const chatWithToolsFn = deps.chatWithTools || chatWithTools;
  const getAllDeclarationsFn = deps.getAllDeclarations || tools.getAllDeclarations;
  const executeFn = deps.execute || tools.execute;
  const buildSystemInstructionFn = deps.buildSystemInstruction || buildSystemInstruction;

  const cfg = loadConfigFn();
  // Sessão de convidado (ver src/security.js): restringe a lista de
  // ferramentas ANTES de pedir as declarações pro modelo e antes de
  // executar qualquer chamada — o modelo nem fica sabendo que ferramentas
  // fora dessa lista existem, e mesmo que insistisse, executeFn recusaria.
  const allowedToolsEfetivo = security.restringirParaSessao(allowedTools);
  const declarations = await getAllDeclarationsFn(allowedToolsEfetivo);
  // v0.41.0: hooks SessionStart (contexto no prompt do sistema, 1x por processo) e UserPromptSubmit
  // (código 2 bloqueia o pedido; saída com código 0 vira contexto extra) — ver src/hooks.js.
  const inicio = hooks.contextoDeInicio();
  inicio.avisos.forEach((a) => console.log(chalk.yellow(`${logPrefix}[hook SessionStart] ${a}`)));
  const systemInstruction = buildSystemInstructionFn(extraSystemInstruction) +
    (inicio.texto ? `\n\nContexto adicionado pelo hook SessionStart do usuário:\n${inicio.texto}` : '');
  // UserPromptSubmit e Stop são do pedido do USUÁRIO: dentro de um subagente (delegate_task) não rodam —
  // senão um Stop "npm test ainda falha" obrigava até o explorador somente leitura a continuar.
  const dentroDeSubagente = subagent.profundidadeAtual() > 0;
  const envio = dentroDeSubagente ? { avisos: [], bloqueado: false, saidas: [] } : hooks.executar('UserPromptSubmit', { extra: { prompt: userMessage } });
  envio.avisos.forEach((a) => console.log(chalk.yellow(`${logPrefix}[hook UserPromptSubmit] ${a}`)));
  if (envio.bloqueado) return { text: `Pedido bloqueado por hook do usuário (UserPromptSubmit): ${envio.mensagem}`, history: [...history] };
  const mensagemFinal = envio.saidas.length ? `${userMessage}\n\n[contexto adicionado por hook do usuário]\n${envio.saidas.join('\n')}` : userMessage;

  const convo = podarHistorico([...history, { role: 'user', parts: partesComImagens(mensagemFinal, imagens) }]);
  // Imagens valem para ESTE pedido; no histórico devolvido viram um marcador curto.
  const fechar = (resultado) => (imagens.length ? { ...resultado, history: tirarImagensDoHistorico(resultado.history) } : resultado);

  // Limite alto (não removido de propósito): sem nenhum teto, se o modelo
  // entrar num loop chamando ferramenta sem nunca fechar com texto, o
  // agente fica preso rodando pra sempre, gastando cota da API sem o
  // usuário perceber. 60 passos é alto o bastante pra nunca interromper uma
  // tarefa normal, mas ainda corta um loop de verdade.
  // v0.32.0: corta o modelo repetindo a mesma chamada com o mesmo resultado (ver src/loopGuard.js).
  const guarda = loopGuard.criar();
  let loopDetectado = '';
  // v0.41.0: orçamento do histórico enviado a cada passo (ver enxugarResultadosAntigos). 0 desliga.
  const maxCharsContexto = cfg.contextoMaxChars === 0 ? 0 : Number(cfg.contextoMaxChars) || 300000;
  let avisouEnxugar = false;
  let continuacoesStop = 0;
  for (let step = 0; step < maxSteps; step++) {
    const enxuto = enxugarResultadosAntigos(podarHistorico(convo), { maxChars: maxCharsContexto });
    if (enxuto.enxugados && !avisouEnxugar) {
      avisouEnxugar = true;
      console.log(chalk.dim(`${logPrefix}(contexto grande: resultados antigos de ferramenta viraram resumo curto para caber e gastar menos)`));
    }
    const response = await chatWithToolsFn({
      modelName, // undefined = o roteador (src/provider.js) escolhe conforme o config
      systemInstruction,
      history: enxuto.history,
      tools: declarations,
      onText,
    });

    const calls = response.functionCalls ? response.functionCalls() : [];
    if (!calls || calls.length === 0) {
      const text = response.text();
      convo.push({ role: 'model', parts: [{ text }] });
      // v0.41.0: hook Stop com código 2 obriga a continuar (ex.: "os testes não passaram"), até 3 vezes.
      const parada = !dentroDeSubagente && continuacoesStop < MAX_CONTINUACOES_STOP ? hooks.executar('Stop', { extra: { resposta: text } }) : null;
      if (parada) parada.avisos.forEach((a) => console.log(chalk.yellow(`${logPrefix}[hook Stop] ${a}`)));
      if (parada && parada.bloqueado) {
        continuacoesStop++;
        console.log(chalk.yellow(`${logPrefix}[hook Stop] ainda não terminou: ${parada.mensagem}`));
        convo.push({ role: 'user', parts: [{ text: `[hook Stop do usuário] A tarefa ainda não terminou: ${parada.mensagem}\nContinue até resolver isso.` }] });
        continue;
      }
      return fechar({ text, history: convo });
    }

    // O modelo pediu para usar uma ou mais ferramentas.
    // Ecoa os parts exatamente como o Google devolveu (preserva o "id" de
    // cada functionCall e qualquer outro campo, como thoughtSignature).
    // Gemini 3.5+ exige que a functionResponse devolva o mesmo id — só
    // reconstruir {name, args} como antes perdia esse campo e quebrava o
    // turno seguinte.
    convo.push({ role: 'model', parts: response.rawParts() });

    // Executa UMA chamada e devolve o functionResponse correspondente.
    const executarChamada = async (call) => {
      console.log(chalk.dim(`\n${logPrefix}→ usando ferramenta: ${call.name}(${JSON.stringify(call.args)})`));
      let result;
      let ap;
      // v0.41.0: regras "negar" do config (src/permissions.js) valem antes de tudo.
      const regraNegar = permissions.negada(call.name, call.args || {}, cfg);
      // v0.13.0: hooks do usuário (~/.gemini-code/hooks.json) — ver src/hooks.js.
      const pre = regraNegar ? { avisos: [], bloqueado: false } : hooks.executar('PreToolUse', { tool: call.name, args: call.args || {} });
      pre.avisos.forEach((a) => console.log(chalk.yellow(`${logPrefix}[hook] ${a}`)));
      if (regraNegar) {
        result = `Bloqueado pela regra de permissão "${regraNegar}" (config.json → permissoes.negar). Não tente contornar; peça ao usuário se precisar.`;
        logAcao({ tool: call.name, args: call.args, erro: result });
      } else if (pre.bloqueado) {
        result = `Bloqueado por hook do usuário: ${pre.mensagem}`;
        logAcao({ tool: call.name, args: call.args, erro: result });
      } else if (!(ap = await stepApproval.checar(call.name, call.args || {})).permitido) {
        // v0.16.0: /passo — o usuário recusou esta gravação.
        result = ap.motivo;
        logAcao({ tool: call.name, args: call.args, erro: result });
      } else {
        try {
          result = await executeFn(call.name, call.args || {}, allowedToolsEfetivo);
          logAcao({ tool: call.name, args: call.args, resultado: result });
        } catch (err) {
          result = `Erro: ${err.message}`;
          logAcao({ tool: call.name, args: call.args, erro: err.message });
        }
        const post = hooks.executar('PostToolUse', { tool: call.name, args: call.args || {}, resultado: typeof result === 'string' ? result : textoDe(result) });
        post.avisos.forEach((a) => console.log(chalk.yellow(`${logPrefix}[hook] ${a}`)));
        if (post.bloqueado) result = `${typeof result === 'string' ? result : textoDe(result)}\n[hook] ${post.mensagem}`;
      }
      // Item 6 da revisão (set/2026): o corte vem com um aviso explícito
      // dentro do próprio texto devolvido (ver cortarResultado).
      // v0.3.7: String(objeto) virava "[object Object]" para o modelo.
      let texto = typeof result === 'string' ? result : textoDe(result);
      const v = guarda.registrar(call.name, call.args, texto);
      if (v.aviso) {
        console.log(chalk.yellow(`${logPrefix}${v.aviso}`));
        texto += `\n${v.aviso}`;
        if (v.parar) loopDetectado = v.aviso;
      }
      return {
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: { result: cortarResultado(call.name, texto) },
        },
      };
    };

    // v0.3.11: vários subagentes SOMENTE LEITURA pedidos na mesma resposta rodam
    // em paralelo (até 3). O resto continua em sequência, na ordem — ferramentas
    // que editam ou perguntam (s/n) no terminal não podem se atropelar.
    const paralelizavel =
      calls.length > 1 && calls.length <= 3 &&
      calls.every((c) => c.name === 'delegate_task' && subagent.ehSomenteLeitura(c.args));
    const responseParts = paralelizavel
      ? await Promise.all(calls.map(executarChamada))
      : [];
    if (!paralelizavel) {
      for (const call of calls) responseParts.push(await executarChamada(call));
    }
    // Bug corrigido (set/2026): o Google mudou a API por baixo — o
    // "generateContent" clássico (usado aqui via @google/generative-ai)
    // agora rejeita role:"function" com "Role 'function' is not supported"
    // e uma lista de roles válidos que não inclui "function" mais. Isso
    // travava QUALQUER uso de ferramenta (run_shell, read_file, MCP, etc.):
    // a primeira chamada até funcionava, mas assim que o resultado da
    // ferramenta voltava pro modelo (2º turno), a API rejeitava. O próprio
    // formato de function-calling do Gemini sempre aceitou functionResponse
    // dentro de role:"user" como alternativa — é o que usamos agora.
    convo.push({ role: 'user', parts: responseParts });
    if (loopDetectado) {
      convo.push({ role: 'model', parts: [{ text: loopDetectado }] });
      return fechar({ text: loopDetectado, history: convo });
    }
  }

  // Se chegou aqui, o modelo ficou 60 rodadas seguidas só chamando
  // ferramentas sem nunca fechar com uma resposta em texto. Antes essa
  // mensagem de aviso era devolvida pro usuário mas NÃO entrava em `convo`
  // — na próxima chamada de `runOnce` com esse `history`, o modelo perdia o
  // fio: via os `functionResponse` das ferramentas mas nenhuma fala do
  // "assistente" fechando aquele turno, o que deixa o histórico inconsistente.
  const aviso = '(número máximo de passos de ferramenta atingido)';
  convo.push({ role: 'model', parts: [{ text: aviso }] });
  return fechar({ text: aviso, history: convo });
}

module.exports = { runOnce, buildSystemInstruction, podarHistorico, cortarResultado };
