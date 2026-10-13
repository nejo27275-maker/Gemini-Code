// src/workflowCommands.js (v0.25.0)
// Comandos /workflows do chat, fora do bin/gemini-code.js para poderem ser testados sem abrir o terminal.
// tratar(cmd) devolve null se não for um comando /workflows; senão { async } com linhas { nivel, texto }
// (nivel: 'dim' | 'erro' | 'aviso' | 'ok'); quem chama só imprime (ver bin/gemini-code.js).
'use strict';

const fs = require('fs');
const path = require('path');
const workflowTools = require('./tools/workflowTools');
const { WORKFLOWS_DIR } = require('./config');

const EXEMPLOS_DIR = path.join(__dirname, '..', 'workflows', 'exemplos');
const NOME_OK = /^[a-z0-9_-]{1,60}$/i;

const L = (nivel, texto) => ({ nivel, texto });

/** Separa `nome chave=valor "outra=valor com espaço"` em { nome, vars }. */
function lerArgs(texto) {
  const partes = String(texto).trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const nome = partes.shift();
  const vars = {};
  for (const p of partes) {
    const m = p.replace(/"/g, '').match(/^(\w+)=([\s\S]*)$/);
    if (m) vars[m[1]] = m[2];
  }
  return { nome, vars };
}

// v0.26.0: instalar exemplos / criar esqueleto / ver, sem editar JSON na mão no celular.
function listarExemplos(dir) {
  let nomes = [];
  try { nomes = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort(); } catch { return []; }
  const out = [];
  for (const n of nomes) {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8'));
      out.push({ nome: n, passos: Array.isArray(w.steps) ? w.steps.length : 0, descricao: String(w.description || '').slice(0, 160) });
    } catch { /* exemplo estragado: ignora */ }
  }
  return out;
}

const ESQUELETO = (nome) => ({
  name: nome,
  description: 'DESCREVA AQUI quando o agente deve usar este workflow (ele escolhe pela descrição).',
  maxTokens: 30000,
  steps: [
    { id: 'levantar', prompt: 'Descreva aqui o primeiro passo. Use {{alvo}} para um valor que o agente passa.', tools: ['read_file', 'list_dir', 'search_files'] },
    { id: 'resumir', prompt: 'Resuma o resultado do passo anterior:\n{{levantar}}', tools: [] },
  ],
});

/** Resumo de um workflow em linhas legíveis (passos, opções e variáveis). */
function descrever(w) {
  const { analisarVariaveis } = require('./agents/runner');
  const an = analisarVariaveis(w);
  const linhas = [`${w.name || '(sem nome)'}${w.description ? ` — ${w.description}` : ''}`];
  if (w.maxTokens) linhas.push(`  teto: ${Number(w.maxTokens).toLocaleString('pt-BR')} tokens por execução`);
  if (an.obrigatorias.length) linhas.push(`  precisa de: ${an.obrigatorias.join(', ')}`);
  for (const [i, x] of w.steps.entries()) {
    const ops = [];
    if (x.each !== undefined) ops.push(`para cada item de ${x.each}${x.paralelo > 1 ? ` (${x.paralelo} ao mesmo tempo)` : ''}`);
    if (Array.isArray(x.tools)) ops.push(x.tools.length ? `ferramentas: ${x.tools.join(', ')}` : 'sem ferramentas');
    if (x.when !== undefined || x.unless !== undefined) ops.push('condicional');
    if (x.optional) ops.push('opcional');
    if (x.retry) ops.push(`retry ${x.retry}`);
    if (x.model) ops.push(`modelo ${x.model}`);
    linhas.push(`  ${i + 1}. ${x.id}${ops.length ? ` [${ops.join('; ')}]` : ''}`);
  }
  return linhas.join('\n');
}

// v0.27.0: /workflows criar — a IA escreve um RASCUNHO a partir da sua descrição. O rascunho fica numa pasta à parte
// (o agente não enxerga nem aciona), você lê o resumo e os avisos e só /workflows aprovar o coloca em uso.
const INSTRUCAO_CRIAR = (nome, pedido) => `Escreva um WORKFLOW do gemini-code em JSON, para este pedido do usuário:
"""${pedido}"""

Responda SÓ com o JSON (sem texto antes ou depois, sem markdown). Formato:
{"name":"${nome}","description":"quando usar (1-2 frases, o agente escolhe pela descrição)","maxTokens":30000,
 "steps":[{"id":"passo1","prompt":"...","tools":["read_file","list_dir","search_files"]}, ...]}

Regras:
- De 2 a 6 passos. "id" só com letras, números e _. Cada passo precisa de "prompt".
- {{nome}} num prompt pede uma variável ao usuário (ex.: {{alvo}}); {{id_de_um_passo_anterior}} usa o resultado dele. Nunca use o resultado de um passo que roda depois. {{var|padrão}} dá valor padrão.
- SEMPRE ponha "tools" em cada passo, com o mínimo necessário. Nomes: read_file, list_dir, search_files (só leitura), run_checks, todo_write, write_file, edit_file, run_shell. Use [] para passo só de texto (resumos). Prefira só leitura; só use write_file/edit_file/run_shell se o pedido exigir gravar ou rodar comando.
- Opcionais por passo: "retry" (0-2), "optional": true, "when"/"unless" (ex.: "{{achados}}"), "each": "{{lista}}" (repete o passo para cada linha de uma lista, máx. 10; use {{item}} no prompt) e "paralelo" (1-3, só com "each" e tools de leitura).
- "maxTokens" é o teto de tokens por execução.`;

function extrairJson(texto) {
  const t = String(texto || '');
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('o modelo não devolveu um JSON');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error(`o modelo devolveu um JSON inválido (${e.message})`); }
}

async function tratar(cmd, { pasta = WORKFLOWS_DIR, exemplos = EXEMPLOS_DIR, rascunhos = path.join(path.dirname(pasta), 'workflow-rascunhos'), runOnceFn } = {}) {
  const c = String(cmd).trim();
  if (c !== '/workflows' && !c.startsWith('/workflows ')) return null;
  const resto = c.slice('/workflows'.length).trim();
  const [sub] = resto.split(/\s+/);
  const arg = resto.slice((sub || '').length).trim();

  if (!resto) {
    const l = workflowTools.listar();
    return [L('dim', l.length
      ? l.map((w) => `  ${w.nome} (${w.passos} passos)${w.variaveis && w.variaveis.length ? ` [precisa: ${w.variaveis.join(', ')}]` : ''}${w.interrompido ? ` [INTERROMPIDO no passo ${w.interrompido}: /workflows retomar ${w.nome}]` : ''}${w.descricao ? ` — ${w.descricao}` : ''}`).join('\n')
      : `Nenhum workflow em ${pasta}. Copie um .json de workflows/exemplos/ para lá; o agente passa a poder acioná-lo sozinho.`)];
  }

  if (sub === 'resumo') return [L('dim', workflowTools.formatarEstatisticas(workflowTools.estatisticas({ nome: arg || undefined })))];

  if (sub === 'historico') {
    // /workflows historico [nome] [--erros]
    const palavras = arg.split(/\s+/).filter(Boolean);
    const soErros = palavras.includes('--erros');
    const nome = palavras.find((p) => p !== '--erros');
    const regs = workflowTools.historico({ nome, status: soErros ? 'erro' : undefined });
    return [L('dim', regs.length || !soErros ? workflowTools.formatarHistorico(regs) : 'Nenhuma execução com erro registrada.')];
  }

  if (sub === 'validar') {
    const nome = arg.replace(/\.json$/, '');
    const arq = /^[a-z0-9_-]{1,60}$/i.test(nome) ? path.join(pasta, `${nome}.json`) : '';
    if (!arq || !fs.existsSync(arq)) return [L('dim', `Workflow "${nome}" não encontrado em ${pasta}.`)];
    const { erros, avisos } = workflowTools.validarArquivo(arq);
    return [
      ...erros.map((e) => L('erro', 'ERRO  ' + e)),
      ...avisos.map((a) => L('aviso', 'AVISO ' + a)),
      erros.length ? L('erro', `${erros.length} erro(s).`) : L('ok', 'OK.'),
    ];
  }

  if (sub === 'rodar' || sub === 'retomar') {
    const { nome, vars } = lerArgs(arg);
    if (!nome) return [L('dim', `Uso: /workflows ${sub} <nome> [variavel=valor ...]`)];
    try { return [L('dim', await workflowTools.execute('run_workflow', { name: nome, vars, retomar: sub === 'retomar' }))]; } catch (e) { return [L('erro', 'Erro: ' + e.message)]; }
  }

  if (sub === 'exemplos') {
    const l = listarExemplos(exemplos);
    return [L('dim', l.length ? l.map((e) => `  ${e.nome} (${e.passos} passos)${e.descricao ? ` — ${e.descricao}` : ''}`).join('\n') + '\n\nInstale com: /workflows instalar <nome>' : `Nenhum exemplo em ${exemplos}.`)];
  }

  if (sub === 'instalar') {
    // /workflows instalar <exemplo> [--forcar]
    const palavras = arg.split(/\s+/).filter(Boolean);
    const forcar = palavras.includes('--forcar');
    const nome = (palavras.find((p) => p !== '--forcar') || '').replace(/\.json$/, '');
    if (!nome) return [L('dim', 'Uso: /workflows instalar <exemplo> [--forcar]   (veja os nomes em /workflows exemplos)')];
    const origem = NOME_OK.test(nome) ? path.join(exemplos, `${nome}.json`) : '';
    if (!origem || !fs.existsSync(origem)) return [L('erro', `Exemplo "${nome}" não existe. Veja /workflows exemplos.`)];
    const destino = path.join(pasta, `${nome}.json`);
    if (fs.existsSync(destino) && !forcar) return [L('aviso', `Já existe ${destino}. Use /workflows instalar ${nome} --forcar para sobrescrever.`)];
    const { erros } = workflowTools.validarArquivo(origem);
    if (erros.length) return [L('erro', `O exemplo "${nome}" tem erro e não foi instalado: ${erros[0]}`)];
    try { fs.mkdirSync(pasta, { recursive: true }); fs.copyFileSync(origem, destino); } catch (e) { return [L('erro', `Não consegui copiar: ${e.message}`)]; }
    return [L('ok', `Instalado em ${destino}. O agente já pode acioná-lo; veja com /workflows ver ${nome}.`)];
  }

  if (sub === 'novo') {
    if (!arg || !NOME_OK.test(arg)) return [L('dim', 'Uso: /workflows novo <nome>   (só letras, números, _ e -; cria um esqueleto para você editar)')];
    const destino = path.join(pasta, `${arg}.json`);
    if (fs.existsSync(destino)) return [L('aviso', `Já existe ${destino}; não sobrescrevi.`)];
    try { fs.mkdirSync(pasta, { recursive: true }); fs.writeFileSync(destino, JSON.stringify(ESQUELETO(arg), null, 2) + '\n'); } catch (e) { return [L('erro', `Não consegui criar: ${e.message}`)]; }
    return [L('ok', `Esqueleto criado em ${destino}. Edite a "description" e os prompts, depois confira com /workflows validar ${arg}.`)];
  }

  if (sub === 'ver') {
    const nome = arg.replace(/\.json$/, '');
    const arq = NOME_OK.test(nome) ? path.join(pasta, `${nome}.json`) : '';
    if (!arq || !fs.existsSync(arq)) return [L('dim', `Workflow "${nome}" não encontrado em ${pasta}.`)];
    try { return [L('dim', descrever(JSON.parse(fs.readFileSync(arq, 'utf8'))))]; } catch (e) { return [L('erro', `Não consegui ler o JSON: ${e.message}`)]; }
  }

  if (sub === 'criar') {
    // /workflows criar <nome> <o que o workflow deve fazer>
    const m = arg.match(/^(\S+)\s+([\s\S]+)$/);
    if (!m || !NOME_OK.test(m[1])) return [L('dim', 'Uso: /workflows criar <nome> <o que ele deve fazer>\n  ex.: /workflows criar revisar-pasta revisar cada arquivo .js de uma pasta e resumir os bugs\n  (nome só com letras, números, _ e -; a IA escreve um rascunho que você aprova depois)')];
    const [, nome, pedido] = m;
    if (pedido.trim().length < 10) return [L('aviso', 'Descreva um pouco mais o que o workflow deve fazer (mínimo 10 caracteres).')];
    if (fs.existsSync(path.join(pasta, `${nome}.json`))) return [L('aviso', `Já existe o workflow "${nome}" em uso. Escolha outro nome (ou apague o atual).`)];
    let bruto;
    try {
      const run = runOnceFn || require('./agent').runOnce;
      const resp = await run(INSTRUCAO_CRIAR(nome, pedido.trim()), { history: [], allowedTools: workflowTools.NENHUMA });
      bruto = extrairJson(resp && resp.text);
    } catch (e) { return [L('erro', `Não consegui gerar o rascunho: ${e.message}. Tente de novo (ou descreva com mais detalhes).`)]; }
    const w = workflowTools.sanitizarWorkflow(bruto);
    w.name = nome;
    const { erros, avisos } = workflowTools.validarWorkflow(w);
    if (erros.length) return [L('erro', 'O modelo gerou um workflow inválido, então NÃO salvei o rascunho:'), ...erros.map((e) => L('erro', '  ' + e)), L('dim', 'Tente de novo; costuma funcionar com um pedido mais específico.')];
    try { fs.mkdirSync(rascunhos, { recursive: true }); fs.writeFileSync(path.join(rascunhos, `${nome}.json`), JSON.stringify(w, null, 2) + '\n'); } catch (e) { return [L('erro', `Não consegui salvar o rascunho: ${e.message}`)]; }
    const riscos = workflowTools.riscosDoWorkflow(w);
    return [
      L('ok', `Rascunho "${nome}" criado (ainda NÃO está em uso; o agente não o enxerga):`),
      L('dim', descrever(w)),
      ...avisos.map((a) => L('aviso', 'AVISO ' + a)),
      ...riscos.map((r) => L('aviso', 'ATENÇÃO ' + r)),
      L('dim', `Leia os prompts em ${path.join(rascunhos, `${nome}.json`)} se quiser. Para usar: /workflows aprovar ${nome}   |   para jogar fora: /workflows descartar ${nome}`),
    ];
  }

  if (sub === 'rascunhos') {
    let nomes = [];
    try { nomes = fs.readdirSync(rascunhos).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort(); } catch { /* sem pasta */ }
    return [L('dim', nomes.length ? nomes.map((n) => `  ${n}  (/workflows aprovar ${n} | /workflows descartar ${n})`).join('\n') : 'Nenhum rascunho. Crie com /workflows criar <nome> <o que fazer>.')];
  }

  if (sub === 'aprovar' || sub === 'descartar') {
    const palavras = arg.split(/\s+/).filter(Boolean);
    const forcar = palavras.includes('--forcar');
    const nome = palavras.find((p) => p !== '--forcar') || '';
    const arq = NOME_OK.test(nome) ? path.join(rascunhos, `${nome}.json`) : '';
    if (!arq || !fs.existsSync(arq)) return [L('dim', `Rascunho "${nome}" não encontrado. Veja /workflows rascunhos.`)];
    if (sub === 'descartar') { try { fs.unlinkSync(arq); } catch { /* já sumiu */ } return [L('ok', `Rascunho "${nome}" descartado.`)]; }
    const destino = path.join(pasta, `${nome}.json`);
    if (fs.existsSync(destino) && !forcar) return [L('aviso', `Já existe ${destino}. Use /workflows aprovar ${nome} --forcar para sobrescrever.`)];
    const { erros } = workflowTools.validarArquivo(arq);
    if (erros.length) return [L('erro', `O rascunho tem erro (talvez editado à mão): ${erros[0]}`)];
    try { fs.mkdirSync(pasta, { recursive: true }); fs.copyFileSync(arq, destino); fs.unlinkSync(arq); } catch (e) { return [L('erro', `Não consegui aprovar: ${e.message}`)]; }
    return [L('ok', `Aprovado: ${destino}. O agente já pode acioná-lo. Teste com /workflows rodar ${nome}.`)];
  }

  // v0.25.0: /workflows limpar historico  |  /workflows limpar <nome>  (descarta a execução interrompida)
  if (sub === 'limpar') {
    if (!arg) return [L('dim', 'Uso: /workflows limpar historico   (apaga o histórico de execuções)\n     /workflows limpar <nome>      (descarta a execução interrompida desse workflow)')];
    if (arg === 'historico') return [L('ok', `Histórico apagado (${workflowTools.limparHistorico()} execução(ões)).`)];
    return [workflowTools.descartarEstado(arg) ? L('ok', `Execução interrompida de "${arg}" descartada.`) : L('dim', `Não há execução interrompida de "${arg}".`)];
  }

  return [L('dim', 'Uso: /workflows [rodar|retomar|validar|ver|novo|criar|rascunhos|aprovar|descartar|exemplos|instalar|historico|resumo|limpar] ...')];
}

module.exports = { tratar, lerArgs, listarExemplos, descrever, ESQUELETO, extrairJson, INSTRUCAO_CRIAR };
