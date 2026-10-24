// src/personalAgentCommands.js
// v0.42.0 — comandos dos agentes pessoais, fora do bin/gemini-code.js para serem testados sem terminal:
//   cli(args, deps)      -> `gemini-code aliados ...`; devolve { linhas, codigo, abrirChat? }
//   chat(cmd, estado)    -> /aliados, /aliado NOME|off e /memoria dentro do chat; null se não for um deles
//   mencao(linha, store) -> "@nome mensagem": { agente, mensagem } ou null
// Linhas no formato de src/workflowCommands.js: { nivel: 'dim'|'erro'|'aviso'|'ok'|'texto', texto }.
'use strict';

const fs = require('fs');
const path = require('path');
const personalAgents = require('./personalAgents');

const { LIMITES, PRESETS, PRESET_PADRAO, MEMORIA_MODOS } = personalAgents;
const L = (nivel, texto) => ({ nivel, texto });

const USO = `Aliados — seus agentes pessoais: instruções, iniciadores, base de conhecimento, memória,
ferramentas e modelo próprios. Ficam em ~/.gemini-code/aliados/ (o modelo não grava ali).

  gemini-code aliados listar
  gemini-code aliados criar NOME [opções]          sem opções, num terminal, pergunta campo a campo
  gemini-code aliados criar NOME --ia "o que ele deve ser/fazer"   a IA escreve a configuração; você revisa e confirma
  gemini-code aliados ver NOME
  gemini-code aliados editar NOME [opções]
  gemini-code aliados remover NOME --sim
  gemini-code aliados chat NOME                    conversa (a conversa dele fica salva; /help lista os comandos)
  gemini-code aliados run NOME "mensagem"          uma pergunta, sem abrir o chat
  gemini-code aliados conhecimento NOME [listar | add ARQ|PASTA... [--forcar] | remover ARQ]
  gemini-code aliados memoria NOME [listar | esquecer ID | limpar --sim]
  gemini-code aliados exportar NOME [ARQUIVO] [--com-memoria]
  gemini-code aliados importar ARQUIVO [--nome NOVO] [--forcar] [--sim]   aceita também personas antigas (agents/*.json)

Opções de criar/editar:
  --descricao TEXTO          o que ele faz (até ${LIMITES.descricao} caracteres)
  --instrucoes TEXTO         o papel dele (até ${LIMITES.instrucoes} caracteres); ou --instrucoes-arquivo ARQ
  --iniciador TEXTO          sugestão de conversa (repita até ${LIMITES.iniciadores} vezes); --sem-iniciadores apaga
  --ferramentas PRESET|LISTA conversa | leitura | pesquisa (padrão) | completo, ou "read_file,web_fetch,..."
  --modelo NOME              modelo só dele (ex.: @local, openai:MODELO, gemini-...); "padrao" volta ao do config
  --memoria MODO             confirmar (padrão: pergunta antes de cada mudança) | auto | off

No chat: /aliados lista, /aliado NOME conversa com ele, /aliado off volta, @NOME mensagem pergunta só uma vez, /memoria.`;

const DESCRICAO_PRESETS = {
  conversa: 'sem ferramentas (só conversa, memória e conhecimento)',
  leitura: 'lê arquivos e pastas do computador',
  pesquisa: 'leitura + abre páginas web (pergunta antes de cada acesso, se confirmWeb)',
  completo: 'todas as ferramentas da sessão (grava arquivos e roda comandos, com as confirmações de sempre)',
};

// ---------------------------------------------------------------------------
// Opções de linha de comando
// ---------------------------------------------------------------------------

const COM_VALOR = {
  '--descricao': 'description', '--description': 'description',
  '--instrucoes': 'instructions', '--instructions': 'instructions',
  '--instrucoes-arquivo': 'instructionsFile', '--instructions-file': 'instructionsFile',
  '--iniciador': 'starter', '--starter': 'starter',
  '--ferramentas': 'tools', '--tools': 'tools',
  '--modelo': 'model', '--model': 'model',
  '--memoria': 'memory', '--memory': 'memory',
  '--ia': 'ia', '--ai': 'ia',
  '--nome': 'nome', '--name': 'nome',
};
const BOOLEANAS = {
  '--sim': 'sim', '--yes': 'sim', '-y': 'sim',
  '--forcar': 'forcar', '--force': 'forcar',
  '--com-memoria': 'comMemoria', '--with-memory': 'comMemoria',
  '--sem-iniciadores': 'semIniciadores', '--no-starters': 'semIniciadores',
};

/** Separa flags (`--x valor`, `--x=valor`, repetíveis) dos argumentos posicionais. */
function lerOpcoes(args) {
  const op = { starters: [] };
  const posicionais = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    const igual = arg.indexOf('=');
    const flag = arg.startsWith('--') && igual > 0 ? arg.slice(0, igual) : arg;
    if (COM_VALOR[flag]) {
      let valor;
      if (flag !== arg) valor = arg.slice(igual + 1);
      else {
        if (i + 1 >= args.length) throw new Error(`Falta o valor depois de ${flag}.`);
        valor = String(args[++i]);
      }
      if (COM_VALOR[flag] === 'starter') op.starters.push(valor);
      else op[COM_VALOR[flag]] = valor;
    } else if (BOOLEANAS[arg]) op[BOOLEANAS[arg]] = true;
    else if (arg.startsWith('--')) throw new Error(`Opção desconhecida: ${arg}. Veja: gemini-code aliados ajuda`);
    else posicionais.push(arg);
  }
  return { op, posicionais };
}

/** Campos de definição presentes nas opções (só o que foi passado). */
function mudancasDasOpcoes(op) {
  const m = {};
  if (op.description !== undefined) m.description = op.description;
  if (op.instructionsFile !== undefined) {
    if (op.instructions !== undefined) throw new Error('Use --instrucoes ou --instrucoes-arquivo, não os dois.');
    m.instructions = fs.readFileSync(path.resolve(op.instructionsFile), 'utf8');
  } else if (op.instructions !== undefined) m.instructions = op.instructions;
  if (op.semIniciadores) m.starters = [];
  if (op.starters.length) m.starters = [...(m.starters || []), ...op.starters];
  if (op.tools !== undefined) m.tools = op.tools;
  if (op.model !== undefined) m.model = /^(padr[aã]o|default)$/i.test(op.model) ? '' : op.model;
  if (op.memory !== undefined) m.memory = op.memory;
  return m;
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

function textoFerramentas(tools) {
  const preset = personalAgents.presetDe(tools);
  if (tools === null) return `completo — ${DESCRICAO_PRESETS.completo}`;
  if (preset !== 'personalizado') return `${preset} — ${DESCRICAO_PRESETS[preset]}${tools.length ? ` (${tools.join(', ')})` : ''}`;
  return tools.join(', ');
}

function textoMemoria(modo, itens) {
  const como = { confirmar: 'pergunta antes de guardar/apagar', auto: 'guarda sozinho e avisa', off: 'desligada' }[modo];
  return modo === 'off' ? como : `${modo} (${como}) — ${itens} item(ns)`;
}

/** Resumo de um agente em linhas. `completo` mostra as instruções inteiras. */
function descrever(agente, store, { completo = false } = {}) {
  const arquivos = store.listarConhecimento(agente.name);
  const kb = Math.ceil(arquivos.reduce((s, a) => s + a.bytes, 0) / 1024);
  const instr = completo || agente.instructions.length <= 300 ? agente.instructions : `${agente.instructions.slice(0, 300)}… (aliados ver ${agente.name} mostra tudo)`;
  const linhas = [
    `${agente.name}${agente.description ? ` — ${agente.description}` : ''}`,
    `  ferramentas: ${textoFerramentas(agente.tools)}`,
    `  modelo: ${agente.model || '(o do config)'}`,
    `  memória: ${textoMemoria(agente.memory, store.listarMemoria(agente.name).length)}`,
    `  conhecimento: ${arquivos.length ? `${arquivos.length} arquivo(s), ${kb} KB — ${arquivos.map((a) => a.arquivo).join(', ')}` : '(nenhum arquivo)'}`,
  ];
  if (agente.starters.length) linhas.push('  iniciadores:', ...agente.starters.map((s, i) => `    ${i + 1}. ${s}`));
  linhas.push('  instruções:', ...instr.split('\n').map((l) => `    ${l}`));
  return linhas.join('\n');
}

/** Cabeçalho ao abrir uma conversa com o agente (no chat e no aliados chat). */
function boasVindas(agente, store) {
  const linhas = [L('ok', `Aliado: ${agente.name}${agente.description ? ` — ${agente.description}` : ''}`)];
  const extras = [];
  if (agente.memory !== 'off') extras.push(`memória ${agente.memory} (${store.listarMemoria(agente.name).length} itens; /memoria)`);
  const arqs = store.listarConhecimento(agente.name).length;
  if (arqs) extras.push(`${arqs} arquivo(s) de conhecimento`);
  if (agente.model) extras.push(`modelo ${agente.model}`);
  if (extras.length) linhas.push(L('dim', extras.join(' · ')));
  if (agente.starters.length) {
    linhas.push(L('dim', 'Para começar, digite o número de uma sugestão (ou escreva o que quiser):'));
    agente.starters.forEach((s, i) => linhas.push(L('dim', `  ${i + 1}. ${s}`)));
  }
  return linhas;
}

/** Número digitado numa conversa ainda vazia vira o iniciador correspondente. */
function iniciadorEscolhido(agente, texto, conversaVazia) {
  if (!agente || !conversaVazia) return null;
  const m = /^\s*(\d)\s*$/.exec(String(texto));
  return m ? agente.starters[Number(m[1]) - 1] || null : null;
}

// ---------------------------------------------------------------------------
// Criação: assistente (perguntas) e pela IA
// ---------------------------------------------------------------------------

const INSTRUCAO_IA = (nome, pedido) => `Configure um AGENTE PESSOAL (um "aliado") chamado "${nome}" para este pedido do usuário:
"""${pedido}"""

Responda SÓ com um JSON, sem markdown e sem texto antes ou depois:
{"description":"o que ele faz, em 1 frase curta",
 "instructions":"instruções completas em segunda pessoa (\\"Você é...\\"): papel, tom, o que fazer e o que evitar, formato das respostas e quando perguntar antes de agir. Até 4000 caracteres.",
 "starters":["até 4 sugestões curtas de primeira mensagem, escritas como o usuário escreveria"],
 "tools":"conversa | leitura | pesquisa | completo"}

Ferramentas: "conversa" = nenhuma; "leitura" = lê arquivos do computador; "pesquisa" = leitura + abre páginas web; "completo" = também grava arquivos e roda comandos. Escolha a MENOR que atende ao pedido. Não invente fatos sobre o usuário.`;

/** Extrai o objeto JSON de uma resposta do modelo (tolera cerca de markdown e texto em volta). */
function extrairJson(texto) {
  return require('./workflowCommands').extrairJson(texto);
}

/** Converte a sugestão do modelo em campos válidos, cortando o que passa dos limites. */
function sanitizarSugestao(bruto) {
  const s = bruto && typeof bruto === 'object' ? bruto : {};
  const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const tools = typeof s.tools === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, s.tools.trim().toLowerCase()) ? s.tools.trim().toLowerCase() : PRESET_PADRAO;
  return {
    description: txt(s.description, LIMITES.descricao),
    instructions: txt(s.instructions, LIMITES.instrucoes),
    starters: (Array.isArray(s.starters) ? s.starters : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, LIMITES.iniciadores).map((x) => x.trim().slice(0, LIMITES.iniciador)),
    tools,
  };
}

/**
 * Pergunta que aceita texto colado com várias linhas (src/ui/prompt.js perguntarColando); com ask() só a
 * primeira linha ficava e as outras viravam respostas das perguntas seguintes. Entrada encerrada = ''.
 */
function perguntarVariasLinhas(pergunta) {
  const prompt = require('./ui/prompt');
  return new Promise((resolve) => {
    const rl = prompt.getShared();
    let feito = false;
    const fim = (texto) => { if (feito) return; feito = true; rl.removeListener('close', aoFechar); resolve(texto); };
    const aoFechar = () => fim('');
    rl.once('close', aoFechar);
    prompt.perguntarColando(rl, pergunta, fim);
  });
}

async function assistente(nome, perguntar, perguntarVarias) {
  const descricao = await perguntar('Descrição curta (o que ele faz): ');
  const instrucoes = await perguntarVarias('Instruções (o papel dele, tom, o que fazer e evitar — pode colar várias linhas; textos longos: --instrucoes-arquivo): ');
  const starters = [];
  for (let i = 1; i <= LIMITES.iniciadores; i++) {
    const s = await perguntar(`Sugestão de conversa ${i} (Enter para terminar): `);
    if (!s.trim()) break;
    starters.push(s);
  }
  const tools = (await perguntar(`Ferramentas [conversa | leitura | pesquisa | completo] (Enter = ${PRESET_PADRAO}): `)).trim() || PRESET_PADRAO;
  const memory = (await perguntar(`Memória [${MEMORIA_MODOS.join(' | ')}] (Enter = confirmar): `)).trim() || 'confirmar';
  return { name: nome, description: descricao, instructions: instrucoes, starters, tools, memory };
}

// ---------------------------------------------------------------------------
// CLI: gemini-code aliados ...
// ---------------------------------------------------------------------------

const SUB = {
  listar: 'listar', list: 'listar', ls: 'listar',
  criar: 'criar', create: 'criar', novo: 'criar', new: 'criar',
  ver: 'ver', show: 'ver', mostrar: 'ver',
  editar: 'editar', edit: 'editar',
  remover: 'remover', remove: 'remover', delete: 'remover', apagar: 'remover',
  chat: 'chat', conversar: 'chat',
  run: 'run', perguntar: 'run', ask: 'run',
  conhecimento: 'conhecimento', knowledge: 'conhecimento',
  memoria: 'memoria', memória: 'memoria', memory: 'memoria',
  exportar: 'exportar', export: 'exportar',
  importar: 'importar', import: 'importar',
  ajuda: 'ajuda', help: 'ajuda', '--help': 'ajuda',
};

/**
 * @param {string[]} args  argumentos depois de "aliados"
 * @param {object} deps    { store, perguntar(q), interativo, runOnce, cwd } — para teste; padrões reais
 * @returns {Promise<{ linhas, codigo, abrirChat?: string }>}
 */
async function cli(args = [], deps = {}) {
  const store = deps.store || personalAgents.defaultStore;
  const perguntar = deps.perguntar || require('./ui/prompt').ask;
  const interativo = deps.interativo !== undefined ? deps.interativo : Boolean(process.stdin.isTTY);
  const cwd = deps.cwd || process.cwd();
  const ok = (...linhas) => ({ linhas, codigo: 0 });
  const falha = (...linhas) => ({ linhas, codigo: 1 });
  const confirmado = async (pergunta, op) => op.sim || ['s', 'y'].includes(String(await perguntar(pergunta)).trim().toLowerCase());
  // O que o usuário precisa ler ANTES de uma confirmação sai já (deps.mostrar); sem mostrar (testes), volta no resultado.
  const antesDePerguntar = (linhas) => { if (!deps.mostrar) return linhas; deps.mostrar(linhas); return []; };

  const [subBruto, ...resto] = args;
  const sub = subBruto === undefined ? 'listar' : SUB[String(subBruto).toLowerCase()];
  if (!sub) return falha(L('erro', `Subcomando desconhecido: ${subBruto}`), L('dim', USO));
  let op; let pos;
  try { ({ op, posicionais: pos } = lerOpcoes(resto)); } catch (e) { return falha(L('erro', e.message)); }

  try {
    if (sub === 'ajuda') return ok(L('dim', USO));

    if (sub === 'listar') {
      const todos = store.listar();
      if (!todos.length) return ok(L('dim', 'Nenhum aliado ainda. Crie um com:\n  gemini-code aliados criar NOME --ia "o que ele deve ser/fazer"\n  gemini-code aliados criar NOME --instrucoes "Você é..."'));
      return ok(...todos.map((a) => (a.erro
        ? L('erro', `  ${a.name}: ${a.erro}`)
        : L('dim', `  ${a.name}${a.description ? ` — ${a.description}` : ''}  [${personalAgents.presetDe(a.tools)}; memória ${a.memory}${a.memory !== 'off' ? ` ${a.memorias}` : ''}; ${a.arquivos} arquivo(s)${a.model ? `; ${a.model}` : ''}]`))));
    }

    if (sub === 'importar') {
      const [arquivo] = pos;
      if (!arquivo) return falha(L('erro', 'Uso: gemini-code aliados importar ARQUIVO [--nome NOVO] [--forcar] [--sim]'));
      let dados;
      try { dados = JSON.parse(fs.readFileSync(path.resolve(cwd, arquivo), 'utf8')); } catch (e) { return falha(L('erro', `Não consegui ler ${arquivo}: ${e.message}`)); }
      let lido;
      try { lido = store.lerPacote(dados, { nome: op.nome }); } catch (e) { return falha(L('erro', `${e.message}${/Nome de agente/.test(e.message) ? ' Use --nome NOME.' : ''}`)); }
      if (store.existe(lido.agente.name) && !op.forcar) return falha(L('aviso', `Já existe o agente "${lido.agente.name}". Use --nome OUTRO ou --forcar para substituir (apaga o conhecimento e a memória dele).`));
      const resumo = antesDePerguntar([
        L('aviso', `Importando "${lido.agente.name}". Instruções de terceiros mandam no comportamento do agente: leia antes de confirmar.`),
        L('dim', `  ferramentas pedidas: ${textoFerramentas(lido.agente.tools)}`),
        L('dim', `  modelo: ${lido.agente.model || '(o do config)'} · memória: ${lido.agente.memory}${lido.memoria.length ? ` (${lido.memoria.length} item(ns) no pacote)` : ''} · conhecimento: ${lido.conhecimento.length} arquivo(s)`),
        L('dim', `  instruções:\n${lido.agente.instructions.split('\n').map((l) => `    ${l}`).join('\n')}`),
      ]);
      if (!(await confirmado(`Importar "${lido.agente.name}"? (s/n) `, op))) return falha(...resumo, L('dim', 'Nada foi importado (sem terminal, confirme com --sim).'));
      const agente = store.importar(lido, { sobrescrever: Boolean(op.forcar) });
      return ok(...resumo, L('ok', `Agente "${agente.name}" importado. Converse com: gemini-code aliados chat ${agente.name}`));
    }

    const [nomeBruto, ...outros] = pos;
    if (!nomeBruto) return falha(L('erro', `Informe o nome do agente. Uso: gemini-code aliados ${sub} NOME`), L('dim', 'Veja todos com: gemini-code aliados ajuda'));
    const nome = personalAgents.validarNome(nomeBruto);

    if (sub === 'criar') {
      if (store.existe(nome)) return falha(L('aviso', `Já existe o agente "${nome}". Use: gemini-code aliados editar ${nome} ...`));
      const mudancas = mudancasDasOpcoes(op);
      let dados;
      let previa = [];
      if (op.ia !== undefined) {
        const pedido = String(op.ia).trim();
        if (pedido.length < 10) return falha(L('aviso', 'Descreva um pouco mais o agente em --ia (mínimo 10 caracteres).'));
        // Sem como confirmar, nem gasta a chamada ao modelo.
        if (!op.sim && !interativo && !deps.perguntar) return falha(L('erro', 'Sem terminal não dá para revisar a sugestão: rode num terminal ou acrescente --sim para criar direto.'));
        const run = deps.runOnce || require('./agent').runOnce;
        let sugestao;
        try {
          const resp = await run(INSTRUCAO_IA(nome, pedido), { history: [], allowedTools: [] });
          sugestao = sanitizarSugestao(extrairJson(resp && resp.text));
        } catch (e) { return falha(L('erro', `Não consegui gerar a configuração: ${e.message}. Tente de novo, com um pedido mais específico.`)); }
        if (!sugestao.instructions) return falha(L('erro', 'O modelo não escreveu as instruções; nada foi criado. Tente de novo.'));
        dados = { name: nome, ...sugestao, ...mudancas };
        const sugerido = personalAgents.normalizarAgente(dados);
        previa = antesDePerguntar([L('ok', 'Configuração sugerida pela IA:'), L('dim', descrever(sugerido, store, { completo: true }))]);
        if (!(await confirmado(`Criar "${nome}" assim? (s/n) `, op))) return falha(...previa, L('dim', 'Nada foi criado (sem terminal, confirme com --sim). Ajuste o pedido ou passe --instrucoes.'));
      } else if (mudancas.instructions === undefined) {
        if (!interativo) return falha(L('erro', 'Informe --instrucoes "Você é..." (ou --instrucoes-arquivo ARQ, ou --ia "o que ele deve fazer"). Sem terminal não dá para perguntar.'));
        dados = { ...(await assistente(nome, perguntar, deps.perguntar || perguntarVariasLinhas)), ...mudancas };
      } else dados = { name: nome, ...mudancas };
      const agente = store.criar(dados);
      return ok(...(op.ia !== undefined ? previa : [L('dim', descrever(agente, store))]),
        L('ok', `Agente "${agente.name}" criado. Converse com: gemini-code aliados chat ${agente.name}`),
        L('dim', `Anexe arquivos à base dele com: gemini-code aliados conhecimento ${agente.name} add ARQUIVO`));
    }

    if (sub === 'ver') return ok(L('dim', descrever(store.obter(nome), store, { completo: true })));

    if (sub === 'editar') {
      const mudancas = mudancasDasOpcoes(op);
      if (!Object.keys(mudancas).length) return falha(L('erro', `Nada para mudar. Ex.: gemini-code aliados editar ${nome} --memoria auto`), L('dim', USO));
      const agente = store.atualizar(nome, mudancas);
      return ok(L('ok', `Agente "${nome}" atualizado.`), L('dim', descrever(agente, store)));
    }

    if (sub === 'remover') {
      store.obter(nome);
      if (!op.sim) return falha(L('aviso', `Isso apaga o agente "${nome}", a memória, a base de conhecimento e as conversas dele. Confirme com: gemini-code aliados remover ${nome} --sim`));
      store.remover(nome);
      return ok(L('ok', `Agente "${nome}" removido.`));
    }

    if (sub === 'chat') {
      store.obter(nome);
      return { linhas: [], codigo: 0, abrirChat: nome };
    }

    if (sub === 'run') {
      const mensagem = outros.join(' ').trim();
      if (!mensagem) return falha(L('erro', `Uso: gemini-code aliados run ${nome} "mensagem"`));
      const agente = store.obter(nome);
      const run = deps.runOnce || require('./agent').runOnce;
      const { opcoes, ctx } = personalAgents.prepararTurno(store, agente, mensagem, { perguntar: deps.perguntar });
      const r = await personalAgents.comAgente(ctx, () => run(mensagem, { history: [], ...opcoes }));
      return ok(L('texto', r.text));
    }

    if (sub === 'conhecimento') {
      const [acaoBruta = 'listar', ...arquivos] = outros;
      const acao = { listar: 'listar', list: 'listar', add: 'add', adicionar: 'add', remover: 'remover', remove: 'remover' }[acaoBruta.toLowerCase()];
      store.obter(nome);
      if (acao === 'listar') {
        const lista = store.listarConhecimento(nome);
        return ok(L('dim', lista.length
          ? lista.map((a) => `  ${a.arquivo} (${Math.ceil(a.bytes / 1024)} KB)`).join('\n')
          : `Nenhum arquivo. Anexe com: gemini-code aliados conhecimento ${nome} add ARQUIVO|PASTA (texto: .md, .txt, .csv, código...)`));
      }
      if (acao === 'add') {
        if (!arquivos.length) return falha(L('erro', `Uso: gemini-code aliados conhecimento ${nome} add ARQUIVO|PASTA... [--forcar]`));
        const r = store.adicionarConhecimento(nome, arquivos.map((a) => path.resolve(cwd, a)), { forcar: Boolean(op.forcar) });
        const linhas = [
          ...r.adicionados.map((a) => L('ok', `  ${a.substituiu ? 'atualizado' : 'adicionado'}: ${a.arquivo} (${Math.ceil(a.bytes / 1024)} KB)`)),
          ...r.ignorados.map((i) => L('aviso', `  ignorado: ${i.origem} — ${i.motivo}`)),
        ];
        return { linhas: linhas.length ? linhas : [L('aviso', 'Nenhum arquivo encontrado.')], codigo: r.adicionados.length ? 0 : 1 };
      }
      if (acao === 'remover') {
        if (!arquivos[0]) return falha(L('erro', `Uso: gemini-code aliados conhecimento ${nome} remover ARQUIVO`));
        return store.removerConhecimento(nome, arquivos[0]) ? ok(L('ok', `Removido: ${arquivos[0]}`)) : falha(L('aviso', `"${arquivos[0]}" não está na base de ${nome}.`));
      }
      return falha(L('erro', `Uso: gemini-code aliados conhecimento ${nome} [listar | add ARQ... | remover ARQ]`));
    }

    if (sub === 'memoria') {
      const [acaoBruta = 'listar', id] = outros;
      const acao = { listar: 'listar', list: 'listar', esquecer: 'esquecer', forget: 'esquecer', apagar: 'esquecer', limpar: 'limpar', clear: 'limpar' }[acaoBruta.toLowerCase()];
      const agente = store.obter(nome);
      if (acao === 'listar') {
        const itens = store.listarMemoria(nome);
        const modo = L('dim', `Memória: ${textoMemoria(agente.memory, itens.length)}. Mude com: gemini-code aliados editar ${nome} --memoria confirmar|auto|off`);
        return ok(L('dim', itens.length ? itens.map((i) => `  [${i.id}] ${i.texto}  (${i.criadoEm.slice(0, 10)})`).join('\n') : '  (vazia)'), modo);
      }
      if (acao === 'esquecer') {
        if (!id) return falha(L('erro', `Uso: gemini-code aliados memoria ${nome} esquecer ID`));
        return store.esquecer(nome, id) ? ok(L('ok', `Esquecido: [${id}]`)) : falha(L('aviso', `Não há memória com id "${id}".`));
      }
      if (acao === 'limpar') {
        if (!op.sim) return falha(L('aviso', `Isso apaga toda a memória de ${nome}. Confirme com: gemini-code aliados memoria ${nome} limpar --sim`));
        return ok(L('ok', `Memória de ${nome} apagada (${store.limparMemoria(nome)} item(ns)).`));
      }
      return falha(L('erro', `Uso: gemini-code aliados memoria ${nome} [listar | esquecer ID | limpar --sim]`));
    }

    if (sub === 'exportar') {
      const destino = path.resolve(cwd, outros[0] || `${nome}.aliado.json`);
      if (fs.existsSync(destino) && !op.forcar) return falha(L('aviso', `${destino} já existe. Use --forcar para sobrescrever.`));
      const pacote = store.exportar(nome, { comMemoria: Boolean(op.comMemoria) });
      fs.writeFileSync(destino, JSON.stringify(pacote, null, 2) + '\n', { mode: 0o600 });
      return ok(L('ok', `Exportado: ${destino}`), L('dim', op.comMemoria
        ? 'ATENÇÃO: o arquivo inclui a memória (fatos pessoais). Compartilhe com cuidado.'
        : 'A memória não foi incluída (é pessoal); use --com-memoria para levar junto. Importe com: gemini-code aliados importar ARQUIVO'));
    }
  } catch (e) {
    return falha(L('erro', e.message));
  }
  return falha(L('dim', USO));
}

// ---------------------------------------------------------------------------
// Chat: /aliados, /aliado NOME|off, /memoria e @nome
// ---------------------------------------------------------------------------

/**
 * @param {string} cmd
 * @param {{ agente: object|null, store?: object }} estado
 * @returns {null | { linhas, agente?: object|null }}  agente: undefined = não muda; null = volta ao comum
 */
function chat(cmd, { agente = null, store = personalAgents.defaultStore } = {}) {
  const c = String(cmd).trim();
  const m = /^\/(aliados|aliado|memoria|memória)(?:\s+([\s\S]*))?$/i.exec(c);
  if (!m) return null;
  const tipo = m[1].toLowerCase();
  const arg = (m[2] || '').trim();
  try {
    if (tipo === 'aliados') {
      const todos = store.listar();
      return { linhas: [L('dim', todos.length
        ? todos.map((a) => `  ${agente && a.name === agente.name ? '* ' : ''}${a.name}${a.erro ? ` (erro: ${a.erro})` : a.description ? ` — ${a.description}` : ''}`).join('\n') + '\nUse /aliado NOME para conversar com um deles ou @NOME mensagem para perguntar uma vez.'
        : 'Nenhum aliado. Crie fora do chat: gemini-code aliados criar NOME --ia "o que ele deve fazer"')] };
    }
    if (tipo === 'aliado') {
      if (!arg) return { linhas: [L('dim', agente ? `Conversando com o aliado "${agente.name}". /aliado off volta ao agente comum.` : 'Nenhum aliado ativo. Use /aliado NOME (veja /aliados).')] };
      if (/^(off|sair|nenhum)$/i.test(arg)) return { linhas: [L('dim', agente ? `Aliado "${agente.name}" desligado; de volta ao agente comum.` : 'Nenhum aliado estava ativo.')], agente: null };
      const novo = store.obter(arg);
      return { linhas: boasVindas(novo, store), agente: novo };
    }
    // /memoria [esquecer ID]
    if (!agente) return { linhas: [L('dim', 'A memória é de cada aliado: use /aliado NOME antes (ou gemini-code aliados memoria NOME).')] };
    const [acao, id] = arg.split(/\s+/);
    if (acao === 'esquecer') {
      if (!id) return { linhas: [L('dim', 'Uso: /memoria esquecer ID')] };
      return { linhas: [store.esquecer(agente.name, id) ? L('ok', `Esquecido: [${id}]`) : L('aviso', `Não há memória com id "${id}".`)] };
    }
    if (acao) return { linhas: [L('dim', 'Uso: /memoria | /memoria esquecer ID (apagar tudo: gemini-code aliados memoria NOME limpar --sim)')] };
    const itens = store.listarMemoria(agente.name);
    return { linhas: [L('dim', `Memória de ${agente.name} (${textoMemoria(agente.memory, itens.length)}):\n${itens.length ? itens.map((i) => `  [${i.id}] ${i.texto}`).join('\n') : '  (vazia)'}`)] };
  } catch (e) {
    return { linhas: [L('erro', e.message)] };
  }
}

/** "@nome mensagem" com um agente pessoal existente; qualquer outra coisa devolve null (vai como texto normal). */
function mencao(linha, store = personalAgents.defaultStore) {
  const m = /^@([a-z0-9][a-z0-9_-]{0,39})\s+(\S[\s\S]*)$/i.exec(String(linha).trim());
  if (!m) return null;
  let agente;
  try { agente = store.carregar(m[1]); } catch { return null; }
  return agente ? { agente, mensagem: m[2].trim() } : null;
}

module.exports = { USO, cli, chat, mencao, boasVindas, iniciadorEscolhido, descrever, lerOpcoes, sanitizarSugestao, INSTRUCAO_IA };
