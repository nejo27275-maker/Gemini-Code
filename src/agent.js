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
const { paraTerminal } = require('./ui/textoSeguro');

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
    'Edite como um profissional: leia o arquivo antes de mudá-lo; para mudar um trecho use edit_file (ou ' +
    'edit_files, várias edições de uma vez) em vez de reescrever o arquivo inteiro; siga o estilo do arquivo ' +
    '(indentação, aspas, nomes). Cada edição volta com o diff e os números de linha: confira se ficou como você ' +
    'queria. Se a ferramenta avisar erro de sintaxe, corrija na hora.\n\n' +
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

// v0.52.0: MODO ATÉ TERMINAR — a pessoa liga, e o agente trabalha sozinho até a tarefa estar feita. Quando ele
// fecha o turno sem dizer que terminou, o loop manda continuar (como o hook Stop). Tetos: continuações, passos e a
// mesma resposta duas vezes (sem progresso). O "Parar" da pessoa continua valendo, e as permissões das ferramentas
// também (quem pergunta é o sistema, não o modelo). As marcas saem do texto, inclusive no meio do streaming.
const MARCA_CONCLUIDA = '[TAREFA CONCLUÍDA]';
const MARCA_PRECISA = '[PRECISO DE VOCÊ]';
const RE_MARCAS = /\[\s*(TAREFA\s+CONCLU[IÍ]DA|PRECISO\s+DE\s+VOC[EÊ])\s*\]/gi;
const MAX_CONTINUACOES_ATE_TERMINAR = 25;
const PASSOS_ATE_TERMINAR = 400;
const INSTRUCAO_ATE_TERMINAR = 'MODO ATÉ TERMINAR (a pessoa ligou): trabalhe sozinho até a tarefa estar completa. Não pare no ' +
  'meio para perguntar "posso continuar?" ou "quer que eu faça X?": escolha o caminho razoável e siga. As permissões das ' +
  'ferramentas continuam sendo pedidas pelo sistema; isso não depende de você. Antes de dizer que terminou, confira o ' +
  'resultado (rode os testes, leia o arquivo gravado, veja a imagem criada). Quando a tarefa estiver feita de verdade, ' +
  `escreva na última linha exatamente ${MARCA_CONCLUIDA}. Se só a pessoa puder destravar (uma informação que você não ` +
  `tem, uma decisão de gosto, um acesso), diga exatamente o que precisa e termine com ${MARCA_PRECISA}.`;
const CONTINUAR_ATE_TERMINAR = '[modo até terminar] Você parou sem marcar a tarefa como concluída. Continue de onde parou, ' +
  'sem repetir o que já fez nem pedir confirmação. Se ela já está pronta, confira o resultado e termine com ' +
  `${MARCA_CONCLUIDA}; se só a pessoa pode destravar, diga o quê e termine com ${MARCA_PRECISA}.`;

/** Tira as marcas do texto. @returns {{ limpo: string, marca: 'concluida'|'precisa'|null }} (a última marca vale) */
function marcaDoFim(texto) {
  let marca = null;
  const limpo = String(texto || '').replace(RE_MARCAS, (m, qual) => {
    marca = /^TAREFA/i.test(qual) ? 'concluida' : 'precisa';
    return '';
  }).replace(/[ \t]+$/gm, '').trimEnd();
  return { limpo, marca };
}

const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const INICIOS_DE_MARCA = ['TAREFA CONCLUIDA]', 'PRECISO DE VOCE]'];
/** O texto depois do último "[" ainda pode virar uma marca? ("[TAREFA CONC", "[PRECISO DE V") */
function podeVirarMarca(resto) {
  if (resto.length > 24 || resto.includes(']')) return false;
  const r = semAcento(resto.slice(1)).toUpperCase().replace(/\s+/g, ' ').replace(/^ /, '');
  return INICIOS_DE_MARCA.some((m) => m.startsWith(r));
}

/** onText sem as marcas: segura um possível começo de marca no fim de um pedaço até saber o que é. */
function filtrarMarcas(onText) {
  let pendente = '';
  return {
    escrever(pedaco) {
      let s = (pendente + String(pedaco)).replace(RE_MARCAS, '');
      pendente = '';
      const i = s.lastIndexOf('[');
      if (i >= 0 && podeVirarMarca(s.slice(i))) { pendente = s.slice(i); s = s.slice(0, i); }
      if (s) onText(s);
    },
    fim() { if (pendente) { const s = pendente.replace(RE_MARCAS, ''); pendente = ''; if (s) onText(s); } },
  };
}

// v0.48.1: "Parar" de verdade (o modo site manda; ver src/site/servidor.js). Com `signal` (AbortSignal) o agente
// para no próximo ponto seguro: não chama o modelo de novo, não roda a próxima ferramenta e não espera a resposta
// que está chegando (o provedor recebe o mesmo signal e corta a conexão). Uma ferramenta que JÁ está rodando
// termina antes — cortar no meio deixaria arquivo pela metade.
const AVISO_INTERROMPIDO = '(interrompido por você)';
const NAO_RODOU = 'Não rodou: o usuário mandou parar antes desta ferramenta. Não tente de novo sem ele pedir.';
const PARADO = Symbol('parado');

/** A resposta do modelo, ou PARADO assim que o signal disparar (a chamada que estava no ar é descartada). */
function esperarOuParar(promessa, signal) {
  if (!signal) return promessa;
  return new Promise((resolve, reject) => {
    const aoParar = () => resolve(PARADO);
    if (signal.aborted) aoParar(); else signal.addEventListener('abort', aoParar, { once: true });
    promessa.then(
      (v) => { signal.removeEventListener('abort', aoParar); resolve(v); },
      (e) => { signal.removeEventListener('abort', aoParar); if (signal.aborted) resolve(PARADO); else reject(e); },
    );
  });
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
 *
 * `signal` (v0.48.1), se passado, para o agente no próximo ponto seguro; o resultado vem com `interrompido: true`
 * e o histórico continua consistente (toda chamada de ferramenta tem resposta e o turno fecha com texto).
 */
async function runOnce(userMessage, opts = {}) {
  // `imagens` (v0.41.0): [{ inlineData: {mimeType, data} }] de src/imagens.js, enviadas junto com a mensagem.
  // `onFerramenta` (v0.48.0): avisa o nome de cada ferramenta usada (o modo site mostra na tela)
  // `ateTerminar` (v0.52.0): o modo até terminar (ver INSTRUCAO_ATE_TERMINAR); `onContinuar(n)` avisa cada continuação.
  const { history = [], modelName, extraSystemInstruction, allowedTools, onFerramenta, deps = {}, logPrefix = '', imagens = [], signal, onContinuar } = opts;
  const parado = () => Boolean(signal && signal.aborted);
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
  // UserPromptSubmit e Stop são do pedido do USUÁRIO: dentro de um subagente (delegate_task) não rodam —
  // senão um Stop "npm test ainda falha" obrigava até o explorador somente leitura a continuar.
  const dentroDeSubagente = subagent.profundidadeAtual() > 0;
  // o modo até terminar é do pedido da pessoa: um subagente não fica "continuando" sozinho
  const ateTerminar = opts.ateTerminar === true && !dentroDeSubagente;
  const maxSteps = opts.maxSteps !== undefined ? opts.maxSteps : (ateTerminar ? PASSOS_ATE_TERMINAR : 60);
  const filtro = ateTerminar && typeof opts.onText === 'function' ? filtrarMarcas(opts.onText) : null;
  const onText = filtro ? filtro.escrever : opts.onText;
  const systemInstruction = buildSystemInstructionFn(extraSystemInstruction) +
    (inicio.texto ? `\n\nContexto adicionado pelo hook SessionStart do usuário:\n${inicio.texto}` : '') +
    (ateTerminar ? `\n\n${INSTRUCAO_ATE_TERMINAR}` : '');
  const envio = dentroDeSubagente ? { avisos: [], bloqueado: false, saidas: [] } : hooks.executar('UserPromptSubmit', { extra: { prompt: userMessage } });
  envio.avisos.forEach((a) => console.log(chalk.yellow(`${logPrefix}[hook UserPromptSubmit] ${a}`)));
  if (envio.bloqueado) return { text: `Pedido bloqueado por hook do usuário (UserPromptSubmit): ${envio.mensagem}`, history: [...history] };
  const mensagemFinal = envio.saidas.length ? `${userMessage}\n\n[contexto adicionado por hook do usuário]\n${envio.saidas.join('\n')}` : userMessage;

  const convo = podarHistorico([...history, { role: 'user', parts: partesComImagens(mensagemFinal, imagens) }]);
  // Imagens valem para ESTE pedido; no histórico devolvido viram um marcador curto.
  const fechar = (resultado) => (imagens.length ? { ...resultado, history: tirarImagensDoHistorico(resultado.history) } : resultado);
  const interromper = () => {
    convo.push({ role: 'model', parts: [{ text: AVISO_INTERROMPIDO }] });
    return fechar({ text: AVISO_INTERROMPIDO, history: convo, interrompido: true });
  };

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
  let continuacoesAte = 0;
  let ultimaRespostaAte = null;
  for (let step = 0; step < maxSteps; step++) {
    if (parado()) return interromper();
    const enxuto = enxugarResultadosAntigos(podarHistorico(convo), { maxChars: maxCharsContexto });
    if (enxuto.enxugados && !avisouEnxugar) {
      avisouEnxugar = true;
      console.log(chalk.dim(`${logPrefix}(contexto grande: resultados antigos de ferramenta viraram resumo curto para caber e gastar menos)`));
    }
    const response = await esperarOuParar(chatWithToolsFn({
      modelName, // undefined = o roteador (src/provider.js) escolhe conforme o config
      systemInstruction,
      history: enxuto.history,
      tools: declarations,
      onText,
      ...(signal ? { signal } : {}),
    }), signal);
    if (filtro) filtro.fim();
    if (response === PARADO) return interromper();

    const calls = response.functionCalls ? response.functionCalls() : [];
    if (!calls || calls.length === 0) {
      const fim = ateTerminar ? marcaDoFim(response.text()) : { limpo: response.text(), marca: null };
      const text = fim.limpo;
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
      if (ateTerminar && !fim.marca) {
        // sem avançar = a mesma resposta (inclusive vazia) logo depois da anterior, sem nenhuma ferramenta no meio
        const repetiu = ultimaRespostaAte !== null && text.trim() === ultimaRespostaAte;
        if (repetiu || continuacoesAte >= MAX_CONTINUACOES_ATE_TERMINAR) {
          const aviso = !repetiu
            ? `(modo até terminar: parei depois de ${MAX_CONTINUACOES_ATE_TERMINAR} continuações sem a tarefa ser marcada como concluída)`
            : text.trim() ? '(modo até terminar: parei — o agente deu a mesma resposta duas vezes seguidas, sem avançar)'
              : '(modo até terminar: parei — o agente respondeu vazio duas vezes seguidas)';
          console.log(chalk.yellow(`${logPrefix}${aviso}`));
          return fechar({ text: text ? `${text}\n\n${aviso}` : aviso, history: convo, fim: repetiu ? 'repetiu' : 'teto' });
        }
        ultimaRespostaAte = text.trim();
        continuacoesAte++;
        console.log(chalk.dim(`\n${logPrefix}(modo até terminar: ainda não terminou — continuando, ${continuacoesAte}/${MAX_CONTINUACOES_ATE_TERMINAR})`));
        if (typeof onContinuar === 'function') { try { onContinuar(continuacoesAte); } catch { /* quem ouve não derruba o agente */ } }
        if (onText && text) onText('\n\n'); // o que ele escrever depois é outro parágrafo
        convo.push({ role: 'user', parts: [{ text: CONTINUAR_ATE_TERMINAR }] });
        continue;
      }
      return fechar({ text, history: convo, ...(ateTerminar ? { fim: fim.marca } : {}) });
    }

    // O modelo pediu para usar uma ou mais ferramentas. (Modo até terminar: usar ferramenta é avançar — a próxima
    // resposta igual à anterior não conta como "repetiu".)
    ultimaRespostaAte = null;
    // Ecoa os parts exatamente como o Google devolveu (preserva o "id" de
    // cada functionCall e qualquer outro campo, como thoughtSignature).
    // Gemini 3.5+ exige que a functionResponse devolva o mesmo id — só
    // reconstruir {name, args} como antes perdia esse campo e quebrava o
    // turno seguinte.
    convo.push({ role: 'model', parts: response.rawParts() });

    // Executa UMA chamada e devolve o functionResponse correspondente.
    const executarChamada = async (call) => {
      // parou antes desta: ela não roda, mas ganha resposta (a API exige uma resposta por chamada)
      if (parado()) return { functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result: NAO_RODOU } } };
      console.log(chalk.dim(`\n${logPrefix}→ usando ferramenta: ${paraTerminal(call.name)}(${paraTerminal(JSON.stringify(call.args))})`));
      if (typeof onFerramenta === 'function') { try { onFerramenta(String(call.name)); } catch { /* quem ouve não derruba o agente */ } }
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
    if (parado()) return interromper();
  }

  // Se chegou aqui, o modelo ficou 60 rodadas seguidas só chamando
  // ferramentas sem nunca fechar com uma resposta em texto. Antes essa
  // mensagem de aviso era devolvida pro usuário mas NÃO entrava em `convo`
  // — na próxima chamada de `runOnce` com esse `history`, o modelo perdia o
  // fio: via os `functionResponse` das ferramentas mas nenhuma fala do
  // "assistente" fechando aquele turno, o que deixa o histórico inconsistente.
  const aviso = ateTerminar
    ? `(modo até terminar: parei no limite de ${maxSteps} passos de ferramenta — a tarefa pode não estar completa)`
    : '(número máximo de passos de ferramenta atingido)';
  convo.push({ role: 'model', parts: [{ text: aviso }] });
  return fechar({ text: aviso, history: convo, ...(ateTerminar ? { fim: 'passos' } : {}) });
}

module.exports = {
  runOnce, buildSystemInstruction, podarHistorico, cortarResultado, AVISO_INTERROMPIDO,
  marcaDoFim, filtrarMarcas, MARCA_CONCLUIDA, MARCA_PRECISA, CONTINUAR_ATE_TERMINAR, MAX_CONTINUACOES_ATE_TERMINAR, PASSOS_ATE_TERMINAR,
};
