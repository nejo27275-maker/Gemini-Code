// src/tools/workflowTools.js
// run_workflow (v0.17.0): o agente descobre e aciona SOZINHO os workflows salvos em ~/.gemini-code/workflows/*.json
// (os mesmos arquivos de `gemini-code agent run`: {"name","description","steps":[{"id","prompt"}]}).
//   run_workflow()                     -> lista os workflows (nome + descrição)
//   run_workflow({name, vars})         -> roda; `vars` preenche {{variavel}} nos prompts dos passos
// Travas: só a pasta GLOBAL (um repositório baixado não injeta workflows); nome só [a-z0-9_-]; até 10 passos;
// um workflow não chama outro (sem recursão); os passos herdam as ferramentas liberadas do agente que chamou.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const usage = require('../usage');
const { WORKFLOWS_DIR, HOME_DIR } = require('../config');

const MAX_PASSOS = 10;
const NENHUMA = ['__nenhuma_ferramenta__'];
const MAX_RESPOSTA = 6000;
let pasta = WORKFLOWS_DIR;
let pastaEstado = path.join(HOME_DIR, 'workflow-runs');
const VALIDADE_ESTADO_MS = 24 * 60 * 60 * 1000;
let rodando = false;

// (usada nos testes) trocar a pasta de workflows também isola o estado salvo, para não escrever no ~/.gemini-code real
function definirPasta(p) { pasta = p; pastaEstado = path.join(p, '.estado'); }
function definirPastaEstado(p) { pastaEstado = p; }

// v0.20.0: execução interrompida (um passo falhou) fica salva em ~/.gemini-code/workflow-runs/<nome>.json e pode
// ser retomada SEM refazer (nem pagar de novo) os passos que já deram certo. Só pasta global; vale 24h; o arquivo
// do workflow não pode ter mudado; workflows com keepHistory não são salvos (o histórico da conversa não é guardado).
function hashDe(w) { return crypto.createHash('sha1').update(JSON.stringify(w.steps)).digest('hex').slice(0, 16); }
function arqEstado(nome) { return path.join(pastaEstado, `${nome}.json`); }
function usaHistorico(w) { return Boolean(w.keepHistory) || w.steps.some((x) => x.keepHistory); }
function lerEstado(nome) {
  try {
    const e = JSON.parse(fs.readFileSync(arqEstado(nome), 'utf8'));
    if (!e || typeof e.indice !== 'number' || !e.ctx || !Array.isArray(e.results)) return null;
    if (Date.now() - Date.parse(e.em) > VALIDADE_ESTADO_MS) { apagarEstado(nome); return null; }
    return e;
  } catch { return null; }
}
function salvarEstado(nome, w, vars, erro) {
  try {
    if (usaHistorico(w) || typeof erro.indice !== 'number') return false;
    fs.mkdirSync(pastaEstado, { recursive: true });
    fs.writeFileSync(arqEstado(nome), JSON.stringify({ em: new Date().toISOString(), hash: hashDe(w), indice: erro.indice, passo: erro.step, vars, ctx: erro.ctx, results: erro.results, ...(erro.parcial ? { parcial: erro.parcial } : {}) }));
    return true;
  } catch { return false; }
}
function apagarEstado(nome) { try { fs.unlinkSync(arqEstado(nome)); } catch { /* não existia */ } }

// v0.23.0: histórico das execuções (nome, quando, resultado, passos, tokens, duração). NUNCA guarda saídas nem
// variáveis (podem ter segredos); só números e a mensagem de erro cortada. Fica ao lado do estado de retomada,
// mantém só as últimas 200 execuções.
const MAX_HISTORICO = 200;
function arqHistorico() { return path.join(pastaEstado, 'historico.jsonl'); }
function registrarExecucao(reg) {
  try {
    fs.mkdirSync(pastaEstado, { recursive: true });
    fs.appendFileSync(arqHistorico(), JSON.stringify(reg) + '\n');
    const linhas = fs.readFileSync(arqHistorico(), 'utf8').split('\n').filter(Boolean);
    if (linhas.length > MAX_HISTORICO) fs.writeFileSync(arqHistorico(), linhas.slice(-MAX_HISTORICO).join('\n') + '\n');
  } catch { /* histórico nunca derruba o workflow */ }
}
function lerTodos() {
  let linhas = [];
  try { linhas = fs.readFileSync(arqHistorico(), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const todos = [];
  for (const l of linhas) { try { const r = JSON.parse(l); if (r && r.nome) todos.push(r); } catch { /* linha estragada: ignora */ } }
  return todos;
}
function historico({ nome, limite = 10, status } = {}) {
  const todos = lerTodos();
  let filtrados = nome ? todos.filter((r) => r.nome === nome) : todos;
  if (status === 'erro') filtrados = filtrados.filter((r) => r.status !== 'ok'); // v0.25.0: só as que falharam
  return filtrados.slice(-Math.max(1, Math.min(50, Number(limite) || 10))).reverse();
}
// v0.24.0: resumo por workflow ("esse costuma falhar?", "quanto gasta?"): execuções, taxa de sucesso, média de
// tokens e duração, o passo que mais falha. Olha todo o histórico guardado (últimas 200), não só as 10 mostradas.
function estatisticas({ nome } = {}) {
  const grupos = new Map();
  for (const r of lerTodos()) {
    if (nome && r.nome !== nome) continue;
    if (!grupos.has(r.nome)) grupos.set(r.nome, []);
    grupos.get(r.nome).push(r);
  }
  const out = [];
  for (const [n, regs] of grupos) {
    const oks = regs.filter((r) => r.status === 'ok').length;
    const falhasPorPasso = {};
    for (const r of regs) if (r.status !== 'ok' && r.passo) falhasPorPasso[r.passo] = (falhasPorPasso[r.passo] || 0) + 1;
    const pior = Object.entries(falhasPorPasso).sort((a, b) => b[1] - a[1])[0];
    const tokens = regs.reduce((t, r) => t + (r.tokens || 0), 0);
    const ms = regs.reduce((t, r) => t + (r.ms || 0), 0);
    out.push({
      nome: n, execucoes: regs.length, ok: oks, erros: regs.length - oks, taxaOk: Math.round((oks / regs.length) * 100),
      tokensTotal: tokens, tokensMedio: Math.round(tokens / regs.length), msMedio: Math.round(ms / regs.length),
      retomadas: regs.filter((r) => r.retomado).length, ultimoEm: regs[regs.length - 1].em,
      ...(pior ? { passoQueMaisFalha: pior[0], falhasDoPasso: pior[1] } : {}),
    });
  }
  return out.sort((a, b) => b.execucoes - a.execucoes || a.nome.localeCompare(b.nome));
}
function formatarEstatisticas(lista) {
  if (!lista.length) return 'Nenhuma execução registrada ainda.';
  const dur = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}min ${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 100) / 10}s`);
  return lista.map((e) => `${e.nome}: ${e.execucoes} execução(ões), ${e.ok} OK e ${e.erros} com erro (${e.taxaOk}% OK) | média ${e.tokensMedio.toLocaleString('pt-BR')} tokens e ${dur(e.msMedio)} | total ${e.tokensTotal.toLocaleString('pt-BR')} tokens${e.retomadas ? ` | ${e.retomadas} retomada(s)` : ''}${e.passoQueMaisFalha ? ` | passo que mais falha: ${e.passoQueMaisFalha} (${e.falhasDoPasso}x)` : ''}`).join('\n');
}
// v0.24.0: o `gemini-code agent run` (terminal) também entra no histórico (marcado "terminal"). Mesmas regras de
// privacidade: só números; falha ao gravar nunca derruba nada; o erro original é repassado intacto.
async function rodarComHistorico(nome, fn, origem = 'terminal') {
  const n = String(nome || '').replace(/[^\w .-]/g, '').trim().slice(0, 60) || 'sem-nome';
  const t0 = Date.now(); const usoIni = usage.total();
  try {
    const r = await fn();
    const rs = (r && r.result && Array.isArray(r.result.results)) ? r.result.results : [];
    registrarExecucao({ em: new Date().toISOString(), nome: n, status: 'ok', passos: rs.filter((p) => !p.pulado).length, pulados: rs.filter((p) => p.pulado).length, tokens: usage.total() - usoIni, ms: Date.now() - t0, origem });
    return r;
  } catch (e) {
    const rs = Array.isArray(e && e.results) ? e.results : [];
    registrarExecucao({ em: new Date().toISOString(), nome: n, status: 'erro', passo: e && e.step, passos: rs.filter((p) => !p.pulado).length, pulados: rs.filter((p) => p.pulado).length, tokens: usage.total() - usoIni, ms: Date.now() - t0, erro: String(e && e.message).replace(/\s+/g, ' ').slice(0, 200), origem });
    throw e;
  }
}
// v0.25.0: limpeza manual (comando do usuário): apaga o histórico, ou descarta a execução interrompida de um workflow.
function limparHistorico() {
  const n = lerTodos().length;
  try { fs.unlinkSync(arqHistorico()); } catch { /* não existia */ }
  return n;
}
function descartarEstado(nome) {
  if (!/^[a-z0-9_-]{1,60}$/i.test(String(nome))) return false;
  const existia = fs.existsSync(arqEstado(nome));
  apagarEstado(nome);
  return existia;
}
function formatarHistorico(regs) {
  if (!regs.length) return 'Nenhuma execução registrada ainda.';
  const dur = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}min ${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 100) / 10}s`);
  return regs.map((r) => `${new Date(r.em).toLocaleString('pt-BR')}  ${r.nome}${r.retomado ? ' (retomado)' : ''}${r.origem === 'terminal' ? ' (terminal)' : ''}  ${r.status === 'ok' ? 'OK' : `ERRO${r.passo ? ` no passo ${r.passo}` : ''}`}  ${r.passos} passo(s)${r.pulados ? `, ${r.pulados} pulado(s)` : ''}  ${(r.tokens || 0).toLocaleString('pt-BR')} tokens  ${dur(r.ms || 0)}${r.erro ? `\n    ↳ ${r.erro}` : ''}`).join('\n');
}

const declarations = [{
  name: 'run_workflow',
  description:
    'Roda um WORKFLOW salvo (sequência fixa de passos, cada um alimentando o próximo). Chame SEM "name" para listar os ' +
    'disponíveis. Use quando o pedido do usuário combina com a descrição de um workflow; não use para tarefas comuns. ' +
    '"vars" preenche {{variavel}} dentro dos prompts do workflow.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome do workflow (omita para listar)' },
      vars: { type: 'object', description: 'Variáveis texto para {{variavel}} (opcional)' },
      historico: { type: 'boolean', description: 'true = mostra as últimas execuções (de "name", se informado) em vez de rodar' },
      resumo: { type: 'boolean', description: 'true = mostra estatísticas por workflow (execuções, % de sucesso, média de tokens/tempo, passo que mais falha) em vez de rodar' },
      retomar: { type: 'boolean', description: 'true = continua uma execução que falhou no meio, sem refazer os passos que já deram certo' },
    },
  },
}];

function paraleloSeguro(x) {
  const { FERRAMENTAS_LEITURA } = require('../agents/runner');
  return x.each !== undefined && Array.isArray(x.tools) && x.tools.every((n) => FERRAMENTAS_LEITURA.includes(n));
}

function lerWorkflow(nome) {
  if (!/^[a-z0-9_-]{1,60}$/i.test(nome)) throw new Error('nome inválido (use só letras, números, _ e -)');
  const arq = path.join(pasta, `${nome}.json`);
  if (!fs.existsSync(arq)) throw new Error(`workflow "${nome}" não existe`);
  const w = JSON.parse(fs.readFileSync(arq, 'utf8'));
  if (!Array.isArray(w.steps) || !w.steps.length) throw new Error('o arquivo não tem "steps"');
  if (w.steps.length > MAX_PASSOS) throw new Error(`mais de ${MAX_PASSOS} passos`);
  for (const s of w.steps) if (!s || !/^\w+$/.test(String(s.id)) || typeof s.prompt !== 'string' || !s.prompt.trim()) throw new Error('cada passo precisa de "id" (letras/números/_) e "prompt"');
  if (w.maxTokens !== undefined && !(Number.isInteger(w.maxTokens) && w.maxTokens > 0)) throw new Error('"maxTokens" precisa ser um número inteiro positivo');
  for (const x of w.steps) {
    if (x.tools !== undefined && !(Array.isArray(x.tools) && x.tools.every((t) => typeof t === 'string'))) throw new Error(`o passo "${x.id}" tem "tools" inválido (use uma lista de nomes)`);
    if (x.each !== undefined && !(typeof x.each === 'string' && x.each.trim())) throw new Error(`o passo "${x.id}" tem "each" inválido (texto, ex.: "{{lista}}")`);
    if (x.maxItens !== undefined && !(Number.isInteger(x.maxItens) && x.maxItens >= 1 && x.maxItens <= 10)) throw new Error(`o passo "${x.id}" tem "maxItens" inválido (1 a 10)`);
    if (x.paralelo !== undefined) {
      const { MAX_PARALELO } = require('../agents/runner');
      if (!(Number.isInteger(x.paralelo) && x.paralelo >= 1 && x.paralelo <= MAX_PARALELO)) throw new Error(`o passo "${x.id}" tem "paralelo" inválido (1 a ${MAX_PARALELO})`);
      if (x.paralelo > 1 && !paraleloSeguro(x)) throw new Error(`o passo "${x.id}" usa "paralelo" mas precisa de "each" e de "tools" só de leitura (read_file, list_dir, search_files) ou []`);
    }
    for (const k of ['when', 'unless']) {
      const c = x[k];
      if (c !== undefined && !(typeof c === 'string' || (c && typeof c === 'object' && /^\w+$/.test(String(c.var))))) throw new Error(`o passo "${x.id}" tem "${k}" inválido (texto ou {var, contains|equals|empty})`);
    }
    if (x.retry !== undefined && !(Number.isInteger(x.retry) && x.retry >= 0 && x.retry <= 2)) throw new Error(`o passo "${x.id}" tem "retry" inválido (0 a 2)`);
  }
  return w;
}

function listar() {
  let nomes = [];
  try { nomes = fs.readdirSync(pasta).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort(); } catch { return []; }
  const itens = [];
  for (const n of nomes) {
    try {
      const w = lerWorkflow(n);
      const { analisarVariaveis } = require('../agents/runner');
      const v = analisarVariaveis(w);
      const est = lerEstado(n);
      itens.push({ interrompido: est ? est.passo : undefined, nome: n, descricao: String(w.description || '').slice(0, 200), passos: w.steps.length, variaveis: v.obrigatorias, opcionais: Object.keys(v.opcionais) });
    } catch { /* inválido: ignora */ }
  }
  return itens;
}

/** Uma linha para o prompt do sistema (vazia se não houver workflows): custa quase nada e deixa o agente saber que existem. */
function resumoParaPrompt() {
  const l = listar();
  return l.length ? `Workflows salvos (rode com run_workflow): ${l.map((w) => w.nome).join(', ')}.` : '';
}

async function execute(name, args = {}, opts = {}) {
  if (name !== 'run_workflow') throw new Error(`Ferramenta de workflow desconhecida: ${name}`);
  if (args.resumo) return formatarEstatisticas(estatisticas({ nome: args.name ? String(args.name) : undefined }));
  if (args.historico) return formatarHistorico(historico({ nome: args.name ? String(args.name) : undefined }));
  if (!args.name) {
    const l = listar();
    return l.length ? 'Workflows disponíveis:\n' + l.map((w) => `- ${w.nome} (${w.passos} passos)${w.variaveis.length ? ` [vars obrigatórias: ${w.variaveis.join(', ')}]` : ''}${w.opcionais.length ? ` [opcionais: ${w.opcionais.join(', ')}]` : ''}${w.interrompido ? ` [INTERROMPIDO no passo ${w.interrompido}: retomar disponível]` : ''}${w.descricao ? `: ${w.descricao}` : ''}`).join('\n')
      : `Nenhum workflow salvo em ${pasta}. Copie um .json de workflows/exemplos/ para lá.`;
  }
  if (rodando) return 'Erro: um workflow não pode chamar outro workflow.';
  let w;
  try { w = lerWorkflow(String(args.name)); } catch (e) { return `Erro: ${e.message}.`; }
  let retomar = null; let estado = null;
  if (args.retomar) {
    estado = lerEstado(String(args.name));
    if (!estado) return `Erro: não há execução interrompida de "${args.name}" para retomar (ou passou de 24h). Rode sem retomar.`;
    if (estado.hash !== hashDe(w)) { apagarEstado(String(args.name)); return `Erro: o workflow "${args.name}" foi alterado depois da falha; a execução salva foi descartada. Rode do início.`; }
    retomar = { ctx: estado.ctx, results: estado.results, desde: estado.indice, ...(estado.parcial ? { parcial: estado.parcial } : {}) };
  }
  const vars = estado ? { ...estado.vars } : {};
  if (args.vars && typeof args.vars === 'object') for (const [k, v] of Object.entries(args.vars)) if (/^\w+$/.test(k)) vars[k] = String(v);

  const { runWorkflowData, analisarVariaveis } = require('../agents/runner');
  // v0.18.0: confere ANTES de gastar chamadas de IA. Variável obrigatória faltando ou passo que usa
  // resultado de um passo futuro viram erro claro (antes o {{var}} sumia em silêncio e o prompt saía furado).
  const an = analisarVariaveis(w);
  const faltam = an.obrigatorias.filter((v) => !(v in vars) || vars[v] === '');
  if (faltam.length) return `Erro: o workflow \"${args.name}\" precisa de: ${faltam.map((v) => `\"${v}\"`).join(', ')}. Chame de novo com vars: {${faltam.map((v) => `${v}: "..."`).join(', ')}}.`;
  if (an.futuras.length) return `Erro: workflow mal montado (${an.futuras.join('; ')}).`;
  const { runOnce } = require('../agent');
  // ATENÇÃO: na camada de ferramentas uma lista VAZIA significa "todas liberadas". Por isso "nenhuma ferramenta"
  // (passo com tools: [], ou interseção vazia) é expressa com um nome que não existe: NENHUMA.
  const pai = Array.isArray(opts.allowedPai) && opts.allowedPai.length ? opts.allowedPai.filter((n) => n !== 'run_workflow') : undefined;
  const ferramentasDoPasso = (o) => {
    const doPasso = Array.isArray(o && o.allowedTools) ? o.allowedTools.filter((n) => n !== 'run_workflow') : undefined;
    const r = doPasso && pai ? doPasso.filter((n) => pai.includes(n)) : (doPasso || pai);
    return Array.isArray(r) && r.length === 0 ? NENHUMA : r;
  };
  const runOnceFn = opts.runOnceFn || ((prompt, o) => runOnce(prompt, { ...o, allowedTools: ferramentasDoPasso(o) }));
  rodando = true;
  const t0 = Date.now(); const usoIni = usage.total();
  try {
    const r = await runWorkflowData(w, { runOnce: runOnceFn, vars, retomar });
    apagarEstado(String(args.name));
    registrarExecucao({ em: new Date().toISOString(), nome: String(args.name), status: 'ok', passos: r.results.filter((p) => !p.pulado).length, pulados: r.results.filter((p) => p.pulado).length, tokens: usage.total() - usoIni, ms: Date.now() - t0, ...(retomar ? { retomado: true } : {}) });
    const rodados = r.results.filter((p) => !p.pulado);
    const ultimo = rodados[rodados.length - 1] || { id: '(nenhum)', output: 'Nenhum passo rodou: todas as condições "when"/"unless" ficaram falsas.' };
    const passos = r.results.filter((p) => p !== ultimo).map((p) => p.pulado ? `- ${p.id}: (pulado)` :`- ${p.id}${p.falhou ? ' (FALHOU, opcional)' : ''}${p.tentativas > 1 ? ` (${p.tentativas} tentativas)` : ''}${p.itens ? ` (${p.itens} itens${p.falhasItens ? `, ${p.falhasItens} falharam` : ''})` : ''}: ${String(p.output).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
    const falhas = r.results.filter((p) => p.falhou).map((p) => p.id);
    const comTokens = r.results.filter((p) => p.tokens);
    const linhaTokens = comTokens.length ? `\n\nTokens do Gemini neste workflow: ${comTokens.reduce((t, p) => t + p.tokens, 0).toLocaleString('pt-BR')} (${comTokens.map((p) => `${p.id} ${p.tokens.toLocaleString('pt-BR')}`).join(', ')})` : '';
    const txt = `Workflow "${w.name || args.name}" concluído (${rodados.length} passos${r.results.length > rodados.length ? `, ${r.results.length - rodados.length} pulado(s)` : ''}${falhas.length ? `, ${falhas.length} opcional(is) falhou(aram): ${falhas.join(', ')}` : ''}).\n\nResultado final (${ultimo.id}):\n${ultimo.output}${passos ? `\n\nPassos anteriores:\n${passos}` : ''}${linhaTokens}`;
    return txt.length > MAX_RESPOSTA ? txt.slice(0, MAX_RESPOSTA) + `\n[... truncado: ${MAX_RESPOSTA} de ${txt.length} caracteres]` : txt;
  } catch (e) {
    registrarExecucao({ em: new Date().toISOString(), nome: String(args.name), status: 'erro', passo: e.step, passos: (e.results || []).filter((p) => !p.pulado).length, pulados: (e.results || []).filter((p) => p.pulado).length, tokens: usage.total() - usoIni, ms: Date.now() - t0, erro: String(e.message).replace(/\s+/g, ' ').slice(0, 200), ...(retomar ? { retomado: true } : {}) });
    const guardou = salvarEstado(String(args.name), w, vars, e);
    const dicaOrc = e.orcamento ? ' O limite vale por execução: ao retomar, o orçamento recomeça do zero (e você pode aumentar "maxTokens" no arquivo sem perder a retomada).' : '';
    return `Erro no workflow "${args.name}": ${e.message}${e.results && e.results.length ? ` (passos que já tinham rodado: ${e.results.filter((p) => !p.pulado).map((p) => p.id).join(', ') || 'nenhum'})` : ''}${guardou ? `. Progresso salvo: para continuar sem refazer o que já deu certo, chame run_workflow com retomar: true (ou use /workflows retomar ${args.name}).` : ''}${dicaOrc}`;
  }
  finally { rodando = false; }
}

// v0.19.0: validação completa SEM rodar nada (e sem gastar IA): junta TODOS os problemas, não só o primeiro.
const CAMPOS_PASSO = new Set(['id', 'prompt', 'retry', 'optional', 'model', 'tools', 'when', 'unless', 'keepHistory', 'each', 'maxItens', 'paralelo']);
const FERRAMENTAS_CONHECIDAS = new Set(['edit_file', 'list_dir', 'read_file', 'run_checks', 'run_shell', 'search_files', 'todo_write', 'write_file']);
function validarWorkflow(w) {
  const erros = []; const avisos = [];
  if (!w || typeof w !== 'object' || !Array.isArray(w.steps) || !w.steps.length) return { erros: ['o arquivo não tem "steps" (lista de passos)'], avisos };
  if (w.steps.length > MAX_PASSOS) erros.push(`mais de ${MAX_PASSOS} passos (${w.steps.length})`);
  if (w.maxTokens !== undefined && !(Number.isInteger(w.maxTokens) && w.maxTokens > 0)) erros.push('"maxTokens" precisa ser um número inteiro positivo');
  if (/^\s*DESCREVA AQUI/i.test(String(w.description || ''))) avisos.push('a "description" ainda é o texto de preenchimento do esqueleto: troque por quando o agente deve usar este workflow (ele o aciona sozinho pela descrição)');
  if (!String(w.description || '').trim()) avisos.push('sem "description": o agente escolhe o workflow pela descrição, então sem ela ele quase não vai acioná-lo');
  const vistos = new Set();
  for (const [i, x] of w.steps.entries()) {
    const nome = x && x.id !== undefined ? `"${x.id}"` : `#${i + 1}`;
    if (!x || typeof x !== 'object') { erros.push(`passo ${nome} não é um objeto`); continue; }
    if (!/^\w+$/.test(String(x.id))) erros.push(`passo ${nome}: "id" precisa de letras/números/_`);
    else if (vistos.has(String(x.id))) erros.push(`passo ${nome}: "id" repetido (o segundo sobrescreveria o primeiro em {{${x.id}}})`);
    else vistos.add(String(x.id));
    if (typeof x.prompt !== 'string' || !x.prompt.trim()) erros.push(`passo ${nome}: falta "prompt"`);
    for (const k of Object.keys(x)) if (!CAMPOS_PASSO.has(k)) avisos.push(`passo ${nome}: campo "${k}" não existe e será ignorado (você quis dizer ${[...CAMPOS_PASSO].find((c) => c.startsWith(k.slice(0, 3))) || 'outro nome'}?)`);
    if (x.each !== undefined) {
      if (!(typeof x.each === 'string' && x.each.trim())) erros.push(`passo ${nome}: "each" precisa ser um texto, ex.: "{{lista}}"`);
      else if (typeof x.prompt === 'string' && !/\{\{item\}\}/.test(x.prompt)) avisos.push(`passo ${nome}: tem "each" mas o prompt não usa {{item}} (todas as chamadas seriam iguais)`);
      if (x.keepHistory) avisos.push(`passo ${nome}: "keepHistory" é ignorado em passos com "each"`);
    }
    if (x.paralelo !== undefined) {
      const { MAX_PARALELO } = require('../agents/runner');
      if (!(Number.isInteger(x.paralelo) && x.paralelo >= 1 && x.paralelo <= MAX_PARALELO)) erros.push(`passo ${nome}: "paralelo" precisa ser de 1 a ${MAX_PARALELO}`);
      else if (x.paralelo > 1 && !paraleloSeguro(x)) erros.push(`passo ${nome}: "paralelo" exige "each" e "tools" só de leitura (read_file, list_dir, search_files) ou [] (itens em paralelo não podem gravar nem pedir confirmação)`);
      else if (x.paralelo > 1) avisos.push(`passo ${nome}: "paralelo": ${x.paralelo} manda ${x.paralelo} chamadas ao mesmo tempo; se a API reclamar de limite, volte para 1`);
    }
    if (x.maxItens !== undefined && !(Number.isInteger(x.maxItens) && x.maxItens >= 1 && x.maxItens <= 10)) erros.push(`passo ${nome}: "maxItens" precisa ser de 1 a 10`);
    if (x.retry !== undefined && !(Number.isInteger(x.retry) && x.retry >= 0 && x.retry <= 2)) erros.push(`passo ${nome}: "retry" precisa ser 0, 1 ou 2`);
    if (x.tools !== undefined) {
      if (!Array.isArray(x.tools) || !x.tools.every((t) => typeof t === 'string')) erros.push(`passo ${nome}: "tools" precisa ser uma lista de nomes`);
      else for (const t of x.tools) if (!FERRAMENTAS_CONHECIDAS.has(t) && !t.startsWith('mcp__')) avisos.push(`passo ${nome}: ferramenta "${t}" não existe (nomes: ${[...FERRAMENTAS_CONHECIDAS].join(', ')})`);
    }
    for (const k of ['when', 'unless']) {
      const c = x[k];
      if (c !== undefined && !(typeof c === 'string' || (c && typeof c === 'object' && /^\w+$/.test(String(c.var))))) erros.push(`passo ${nome}: "${k}" inválido (texto ou {var, contains|equals|empty})`);
    }
  }
  try { const { analisarVariaveis } = require('../agents/runner'); const an = analisarVariaveis(w); for (const f of an.futuras) erros.push(f); if (an.obrigatorias.length) avisos.push(`variáveis obrigatórias: ${an.obrigatorias.join(', ')} (o agente precisa passá-las em vars)`); } catch { /* ignora */ }
  const ultimo = w.steps[w.steps.length - 1];
  if (ultimo && (ultimo.optional || ultimo.when !== undefined || ultimo.unless !== undefined)) avisos.push('o ÚLTIMO passo é opcional/condicional: o resultado final pode vir de um passo anterior');
  return { erros, avisos };
}

// v0.27.0: workflow escrito por IA (/workflows criar). Mantém só campos que existem (descarta lixo/injeção de campo
// estranho) e aponta o que um humano deve olhar antes de aprovar: passo que HERDA todas as ferramentas (sem "tools")
// ou que pode gravar/rodar comando.
const CAMPOS_TOPO = new Set(['name', 'description', 'maxTokens', 'keepHistory', 'steps']);
function sanitizarWorkflow(w) {
  const out = {};
  for (const k of Object.keys(w || {})) if (CAMPOS_TOPO.has(k) && k !== 'steps') out[k] = w[k];
  out.steps = Array.isArray(w && w.steps) ? w.steps.map((x) => {
    if (!x || typeof x !== 'object') return x;
    const y = {};
    for (const k of Object.keys(x)) if (CAMPOS_PASSO.has(k)) y[k] = x[k];
    return y;
  }) : [];
  return out;
}
const FERRAMENTAS_PERIGOSAS = new Set(['write_file', 'edit_file', 'run_shell']);
function riscosDoWorkflow(w) {
  const r = [];
  for (const x of (w && w.steps) || []) {
    if (!x || typeof x !== 'object') continue;
    if (!Array.isArray(x.tools)) r.push(`passo "${x.id}": sem "tools" (herda TODAS as ferramentas do agente, inclusive gravar arquivo e rodar comando)`);
    else {
      const p = x.tools.filter((n) => FERRAMENTAS_PERIGOSAS.has(n));
      if (p.length) r.push(`passo "${x.id}": pode usar ${p.join(', ')} (grava arquivo ou roda comando)`);
    }
  }
  return r;
}

function validarArquivo(arq) {
  let w;
  try { w = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { return { erros: [`não consegui ler o JSON: ${e.message}`], avisos: [] }; }
  return validarWorkflow(w);
}

module.exports = { sanitizarWorkflow, riscosDoWorkflow, limparHistorico, descartarEstado, historico, formatarHistorico, estatisticas, formatarEstatisticas, rodarComHistorico, definirPastaEstado, validarWorkflow, validarArquivo, declarations, execute, listar, resumoParaPrompt, definirPasta, MAX_PASSOS, NENHUMA };
