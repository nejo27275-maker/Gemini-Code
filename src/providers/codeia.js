// src/providers/codeia.js
// Provedor do code-ia (modelo próprio, local, sem rede). Mesmo formato dos outros provedores:
// chatWithTools -> { text(), functionCalls(), rawParts() }.
// Ferramentas: leitura (read_file, list_dir, search_files) e UMA escrita segura — criar arquivo NOVO
// (write_file) com código que ele já conhece ("crie server.js com servidor express", "salve isso em a.js").
// Só quando o pedido é claro e a ferramenta está liberada no perfil/sessão. Nunca sobrescreve arquivo que
// já existe, nunca escreve fora da pasta atual nem em .env, e não edita, apaga nem roda comandos.
'use strict';

const fs = require('fs');
const path = require('path');
const { respostaDePartes } = require('../gemini');
const { obterModelo } = require('../code-ia/install');
const { buscar, completar, extrairCodigo } = require('../code-ia/model');

const SCORE_MINIMO = 2.0;
const NOME = 'code-ia';

const PERGUNTA = /^\s*(como|qual|quais|quando|onde|por ?que|o que|que |how|what|why|when|where)\b/i;

function textoDe(turno) {
  return ((turno && turno.parts) || []).filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();
}

function ultimaFala(history, pular = 0) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.role !== 'user') continue;
    const texto = textoDe(t);
    if (!texto) continue;
    if (pular-- > 0) continue;
    return texto;
  }
  return '';
}

// ---------- acompanhamento: "outra resposta" e "só o código" ----------

const OUTRA = /^(?:outra|outro|proxim[oa]|mais uma|nao (?:era|e) (?:isso|essa|esse)|nao (?:ajudou|serve|funcionou)|tem (?:outra|outro)|another|next|something else)(?:\s+(?:resposta|opcao|exemplo))?$/;
const SO_CODIGO = /^(?:so|apenas|somente|mostra|mostre|me da|manda|quero)?\s*(?:so |apenas |somente )?(?:o |um |esse )?(?:codigo|code|exemplo)(?:\s+(?:so|apenas|puro|completo))?$|^(?:so|apenas|somente) (?:o )?codigo$/;

function normalizar(p) {
  return String(p || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[!?.,]+$/g, '').trim();
}

function pedidoOutra(p) { return OUTRA.test(normalizar(p)); }
function pedidoSoCodigo(p) { const t = normalizar(p); return t.length > 0 && t.length <= 40 && SO_CODIGO.test(t); }

/** Pergunta "de verdade" anterior (pula "outra" e "só o código") e quantas vezes pediram "outra" seguidas. */
function perguntaBase(history) {
  let outras = 0;
  for (let pular = 0; ; pular++) {
    const f = ultimaFala(history, pular);
    if (!f) return { pergunta: '', outras };
    if (pedidoOutra(f)) { outras++; continue; }
    if (pedidoSoCodigo(f)) continue;
    return { pergunta: f, outras };
  }
}

// ---------- conversa simples ----------

function conversa(p) {
  const t = p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[!?.,]+$/g, '').trim();
  if (/^(oi|ola|opa|eae|e ai|salve|bom dia|boa tarde|boa noite|hello|hi|hey)\b/.test(t) && t.split(/\s+/).length <= 4) {
    return 'Oi! Eu sou o code-ia, o modelo próprio do gemini-code — rodo todo no seu aparelho, sem internet. Pergunte como fazer algo em código (ex.: "como criar um servidor com express"), peça "leia package.json" ou "liste a pasta src", ou use "completa: seu código".';
  }
  if (/(quem (e|eh) voce|quem criou voce|o que (e|eh) (o )?code-?ia|voce e (o )?(qwen|deepseek|gemini|llama|chatgpt|gpt))/.test(t)) {
    return 'Eu sou o code-ia: um modelo pequeno feito do zero dentro do gemini-code (busca estatística no que aprendi + um gerador de código por contexto). Não uso Qwen, DeepSeek, Gemini nem outro modelo por trás. Sei o que está no meu corpus e no que você me ensinar com `gemini-code code-ia learn`.';
  }
  if (/^(obrigad[oa]|valeu|vlw|thanks|thx)\b/.test(t)) return 'De nada! Se faltar algo, ensina pra mim com `gemini-code code-ia learn arquivo.md`.';
  if (/^(ajuda|help|o que voce sabe|o que voce faz|comandos)$/.test(t)) {
    return 'Posso: (1) responder como fazer algo em JS/Node, Python, Termux/bash, HTML/CSS, extensão Chrome e bots; (2) completar código — `completa: const fs = require(`; (3) ler e buscar nos seus arquivos — "leia package.json", "liste a pasta src", "procure TODO em src"; (4) aprender com você — `gemini-code code-ia learn pasta-ou-arquivo`.';
  }
  return null;
}

// ---------- ferramentas somente-leitura por intenção ----------

const ARQ = String.raw`([^\s"'` + '`' + String.raw`]+\.[A-Za-z0-9]{1,8})`;

function decidirFerramenta(texto, disponiveis) {
  const tem = (n) => (disponiveis || []).some((d) => d.name === n);
  const t = texto.trim();
  if (!t || PERGUNTA.test(t)) return null;

  let m = t.match(new RegExp(String.raw`^(?:por favor,?\s*)?(?:le|leia|ler|abra|abre|mostre|mostra|exiba|ver|veja|cat|read|open|show)\s+(?:o\s+|me\s+o\s+)?(?:conteudo\s+d[oe]\s+)?(?:arquivo\s+)?` + ARQ + String.raw`\s*$`, 'i'));
  if (m && !/^https?:/i.test(m[1]) && tem('read_file')) return { name: 'read_file', args: { path: m[1] } };

  m = t.match(/^(?:por favor,?\s*)?(?:liste|lista|listar|ls|mostre|mostra|ver|veja|quais)\b.*?\b(?:arquivos|pasta|diretorio|diretório|dir)\b(?:\s+(?:da|de|do|em|na|no)?\s*(?:pasta|diretorio|diretório)?\s*([^\s"'`?]+))?\s*\??$/i);
  if (m && tem('list_dir')) return { name: 'list_dir', args: { path: (m[1] && !/^(da|de|do|em|na|no|pasta|projeto|atual)$/i.test(m[1]) ? m[1] : '.') } };
  // v0.39.0: verificações e git sem precisar de outra IA para interpretar o pedido.
  if (/^(?:por favor,?\s*)?(?:rode|roda|rodar|execute|executar|run)\s+(?:os\s+|as\s+)?(?:testes?|tests?|lint|checks?|verifica[cç](?:ao|ão|oes|ões))\s*$/i.test(t) && tem('run_checks')) return { name: 'run_checks', args: {} };
  if (/^(?:git\s+status|status\s+do\s+git|git\s+diff\s+--stat)\s*\??$/i.test(t) && tem('run_shell')) return { name: 'run_shell', args: { command: 'git status --short' } };
  if (/^(?:git\s+log|(?:[uú]ltimos\s+)?commits(?:\s+recentes)?|hist[oó]rico\s+do\s+git)\s*\??$/i.test(t) && tem('run_shell')) return { name: 'run_shell', args: { command: 'git log --oneline -10' } };
  m = t.match(/^ls(?:\s+(\S+))?$/i);
  if (m && tem('list_dir')) return { name: 'list_dir', args: { path: m[1] || '.' } };

  m = t.match(/^(?:procure|procura|busque|busca|ache|encontre|grep|search|find)\s+(?:por\s+)?(?:["'`](.+?)["'`]|(\S+))(?:\s+(?:em|in|na pasta|no diretorio)\s+(\S+))?\s*$/i);
  if (m && tem('search_files')) return { name: 'search_files', args: { pattern: m[1] || m[2], path: m[3] || '.', ignore_case: true } };
  return null;
}

// ---------- escrita segura: só arquivo NOVO, dentro da pasta atual ----------

function caminhoSeguro(cwd, pedido) {
  const raiz = path.resolve(cwd);
  const alvo = path.resolve(raiz, pedido);
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) return { erro: `Só crio arquivos dentro da pasta atual (${raiz}).` };
  if (/^\.env/i.test(path.basename(alvo)) || /(^|[-_.])(secret|credentials|id_rsa)/i.test(path.basename(alvo))) return { erro: 'Não crio arquivos de chaves/segredos (.env etc.).' };
  if (fs.existsSync(alvo)) return { erro: `\`${pedido}\` já existe e eu não sobrescrevo arquivo existente. Escolha outro nome.` };
  return { alvo };
}

function ultimoCodigoDoModelo(history) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    if (history[i].role !== 'model') continue;
    const blocos = extrairCodigo(textoDe(history[i]));
    if (blocos.length) return blocos[0].replace(/\n$/, '') + '\n';
  }
  return null;
}

/** { call } | { texto } | null. `obterModelo` só é chamado se o pedido for mesmo de criar arquivo. */
function decidirEscrita(texto, disponiveis, { history, obterModelo: getModelo, cwd = process.cwd() } = {}) {
  if (!(disponiveis || []).some((d) => d.name === 'write_file')) return null;
  const t = texto.trim();
  if (!t || PERGUNTA.test(t)) return null;
  const pre = String.raw`^(?:por favor,?\s*)?`;

  let m = t.match(new RegExp(pre + String.raw`(?:salv[ea]r?|grav[ea]r?)\s+(?:isso|esse\s+c[oó]digo|o\s+c[oó]digo|a[ií])?\s*(?:em|como|no\s+arquivo|num\s+arquivo|arquivo)\s+` + ARQ + String.raw`\s*$`, 'i'));
  let pedido = null, conteudo, titulo = null;
  if (m) {
    pedido = m[1];
    conteudo = ultimoCodigoDoModelo(history);
    if (!conteudo) return { texto: 'Não achei nenhum bloco de código na minha última resposta pra salvar. Peça um exemplo primeiro (ex.: "como criar um servidor com express").' };
  } else {
    m = t.match(new RegExp(pre + String.raw`(?:cri[ea]r?|gere|gera|monte|monta|escreva)\s+(?:o\s+|um\s+|uma\s+)?(?:arquivo\s+)?` + ARQ + String.raw`\s+(?:com|de|para|usando|que)\s+(.+?)\s*$`, 'i'));
    let assunto = null;
    if (m) { pedido = m[1]; assunto = m[2]; } else {
      m = t.match(new RegExp(pre + String.raw`(?:cri[ea]r?|gere|gera|monte|monta|escreva)\s+(.+?)\s+(?:em|no\s+arquivo|num\s+arquivo|como)\s+` + ARQ + String.raw`\s*$`, 'i'));
      if (m) { assunto = m[1]; pedido = m[2]; }
    }
    if (!pedido) return null;
    const achados = buscar(getModelo(), assunto, { limite: 1 });
    const bloco = achados.length && achados[0].score >= SCORE_MINIMO ? extrairCodigo(achados[0].doc.corpo)[0] : null;
    if (!bloco) return { texto: `Não conheço código pra "${assunto}" ainda, então não vou criar \`${pedido}\` vazio ou inventado. Ensine com: gemini-code code-ia learn seu-codigo.js` };
    conteudo = bloco.replace(/\n$/, '') + '\n';
    titulo = achados[0].doc.titulo;
  }
  const seguro = caminhoSeguro(cwd, pedido);
  if (seguro.erro) return { texto: seguro.erro };
  return { call: { name: 'write_file', args: { path: pedido, content: conteudo } }, titulo };
}

// ---------- edição segura: troca de um trecho EXATO e único, em arquivo que já existe ----------

/** { call } | { texto } | null. Ex.: troque "3000" por "8080" em server.js */
function decidirEdicao(texto, disponiveis, { cwd = process.cwd() } = {}) {
  if (!(disponiveis || []).some((d) => d.name === 'edit_file')) return null;
  const t = texto.trim();
  if (!t || PERGUNTA.test(t)) return null;
  const aspas = String.raw`(?:"([^"]+)"|'([^']+)'|\x60([^\x60]+)\x60)`;
  const m = t.match(new RegExp(String.raw`^(?:por favor,?\s*)?(?:troque|troca|trocar|substitua|substitui|substituir|mude|muda|mudar|replace)\s+(?:o\s+texto\s+)?` + aspas + String.raw`\s+(?:por|para|with|->)\s+` + aspas + String.raw`\s+(?:em|no\s+arquivo|no|in)\s+([^\s"'\x60]+)\s*$`, 'i'));
  if (!m) return null;
  const antigo = m[1] ?? m[2] ?? m[3];
  const novo = m[4] ?? m[5] ?? m[6];
  const pedido = m[7];
  const raiz = path.resolve(cwd);
  const alvo = path.resolve(raiz, pedido);
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) return { texto: `Só edito arquivos dentro da pasta atual (${raiz}).` };
  const base = path.basename(alvo);
  if (/^\.env/i.test(base) || /(^|[-_.])(secret|credentials|id_rsa)/i.test(base)) return { texto: 'Não edito arquivos de chaves/segredos (.env etc.).' };
  let conteudo;
  try { conteudo = fs.readFileSync(alvo, 'utf8'); } catch { return { texto: `Não achei \`${pedido}\` pra editar. Se for um arquivo novo, peça "crie ${pedido} com …".` }; }
  const vezes = conteudo.split(antigo).length - 1;
  if (vezes === 0) return { texto: `Não encontrei \`${antigo}\` em \`${pedido}\`, então não mudei nada.` };
  if (vezes > 1) return { texto: `\`${antigo}\` aparece ${vezes} vezes em \`${pedido}\`. Só troco quando o trecho é único — inclua mais contexto (ex.: a linha toda).` };
  return { call: { name: 'edit_file', args: { path: pedido, old_text: antigo, new_text: novo } } };
}

function resultadoDasFerramentas(history) {
  const ult = (history || [])[history.length - 1];
  if (!ult || ult.role !== 'user') return null;
  const resps = (ult.parts || []).filter((p) => p.functionResponse);
  if (!resps.length) return null;
  const anterior = history[history.length - 2];
  const chamadas = ((anterior && anterior.parts) || []).filter((p) => p.functionCall).map((p) => p.functionCall);
  return resps.map((r) => {
    const nome = r.functionResponse.name;
    const args = (chamadas.find((c) => c.name === nome) || {}).args || {};
    const res = r.functionResponse.response && r.functionResponse.response.result;
    const texto = typeof res === 'string' ? res : JSON.stringify(res);
    if (/^Erro/i.test(texto)) return `Não consegui: ${texto}`;
    if (nome === 'read_file') return `Aqui está \`${args.path}\`:\n\n\`\`\`\n${texto}\n\`\`\``;
    if (nome === 'list_dir') return `Conteúdo de \`${args.path || '.'}\`:\n\n${texto}`;
    if (nome === 'edit_file') return `${texto}\nConfira o arquivo — a troca foi exata, mas o resto do código continua como estava.`;
    if (nome === 'write_file') return `${texto}\nConfira o conteúdo antes de rodar — veio do que o code-ia aprendeu.`;
    if (nome === 'search_files') return `Resultado da busca por \`${args.pattern}\` em \`${args.path || '.'}\`:\n\n${texto}`;
    return texto;
  }).join('\n\n');
}

// ---------- conhecimento ----------

function citarFonte(doc) {
  return doc.fonte && !String(doc.fonte).startsWith('seed/') ? `\n\n_(fonte: ${doc.fonte})_` : '';
}

function respostaAlternativa(modelo, base, n) {
  const achados = buscar(modelo, base, { limite: n + 1 }).filter((a) => a.score >= SCORE_MINIMO);
  if (achados.length <= n) {
    return achados.length
      ? 'Não tenho mais outra resposta boa pra essa pergunta — a última foi a melhor que achei. Ensina uma melhor com `/ensinar pergunta :: resposta`.'
      : 'Ainda não tenho resposta pra essa pergunta pra poder dar outra. Faça a pergunta primeiro (ex.: "como criar um servidor com express").';
  }
  const a = achados[n];
  return `**${a.doc.titulo}**\n\n${a.doc.corpo}${citarFonte(a.doc)}`;
}

function soOCodigo(modelo, base, n, history) {
  // 1º: código do que o modelo respondeu por último; 2º: refaz a busca
  let blocos = [];
  for (let i = (history || []).length - 1; i >= 0 && !blocos.length; i--) {
    if (history[i].role === 'model') blocos = extrairCodigo(textoDe(history[i]));
  }
  if (!blocos.length && base) {
    const a = buscar(modelo, base, { limite: n + 1 }).filter((x) => x.score >= SCORE_MINIMO)[n];
    if (a) blocos = extrairCodigo(a.doc.corpo);
  }
  if (!blocos.length) return 'Não tenho código pra mostrar ainda. Pergunte como fazer algo primeiro (ex.: "como ler um arquivo em node").';
  return blocos.map((b) => `\`\`\`\n${b.replace(/\n$/, '')}\n\`\`\``).join('\n\n');
}

/** Erro colado (stack trace, Traceback): fica só com as linhas que dizem o erro, sem "at ..." e caminhos. */
function limparErroColado(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (linhas.length < 3) return texto;
  const ehTrace = linhas.some((l) => /^at\s/.test(l) || /^Traceback \(most recent/i.test(l) || /^File "/.test(l));
  if (!ehTrace) return texto;
  const erros = linhas.filter((l) => /(Error|Exception|ENOENT|EACCES|EADDRINUSE|ECONN\w+|ETIMEDOUT|ENOTFOUND|RESOURCE_EXHAUSTED|not found|denied|undefined)/i.test(l) && !/^at\s/.test(l) && !/^File "/.test(l));
  const util = erros.slice(-2).join(' ').replace(/(?:\/|[A-Za-z]:\\)[^\s:'"]+/g, ' ');
  return util.trim() || texto;
}

function responder(modelo, pergunta, { anterior, history } = {}) {
  pergunta = limparErroColado(pergunta);
  const papo = conversa(pergunta);
  if (papo) return papo;

  if (history && (pedidoOutra(pergunta) || pedidoSoCodigo(pergunta))) {
    const { pergunta: base, outras } = perguntaBase(history);
    if (pedidoOutra(pergunta)) return respostaAlternativa(modelo, base, outras);
    return soOCodigo(modelo, base, outras, history);
  }

  const m = pergunta.match(/^\s*(?:completa|complete|completar)\s*:\s*([\s\S]+)$/i);
  if (m) {
    const trecho = m[1];
    const cont = completar(modelo, trecho);
    return cont
      ? `Continuação sugerida pelo code-ia (gerador próprio, copia o que aprendeu — confira antes de usar):\n\n\`\`\`\n${trecho}${cont}\n\`\`\``
      : 'Não reconheço esse trecho no que aprendi, então prefiro não inventar. Ensine com: gemini-code code-ia learn seu-codigo.js';
  }

  let achados = buscar(modelo, pergunta, { limite: 3 });
  // pergunta curta de acompanhamento ("e em python?") → junta com a anterior
  if ((!achados.length || achados[0].score < SCORE_MINIMO) && anterior && pergunta.trim().split(/\s+/).length <= 4) {
    achados = buscar(modelo, `${anterior} ${pergunta}`, { limite: 3 });
  }
  if (!achados.length || achados[0].score < SCORE_MINIMO) {
    const perto = achados.slice(0, 2).map((a) => `- ${a.doc.titulo}`);
    return 'Ainda não sei responder isso: o code-ia só sabe o que aprendeu (é um modelo pequeno, próprio, sem internet).' +
      (perto.length ? `\n\nO mais perto que achei:\n${perto.join('\n')}` : '') +
      '\n\nPra ensinar: escreva um .md com "# pergunta" + resposta/código (ou aponte pra seu código) e rode `gemini-code code-ia learn arquivo`.' +
      (require('../solo').ativo() ? '' : ' Ou use a nuvem com /cloud (precisa da chave do Gemini).');
  }
  const [melhor, ...outros] = achados;
  let texto = `**${melhor.doc.titulo}**\n\n${melhor.doc.corpo}${citarFonte(melhor.doc)}`;
  const parecidos = outros.filter((o) => o.score >= melhor.score * 0.6).map((o) => `- ${o.doc.titulo}`);
  if (parecidos.length) texto += `\n\nTambém pode te ajudar:\n${parecidos.join('\n')}`;
  return texto;
}

async function chatWithTools({ history, tools, onText }) {
  // 1) acabou de rodar uma ferramenta: devolve o resultado em texto
  const pronto = resultadoDasFerramentas(history);
  let parts;
  if (pronto) {
    parts = [{ text: pronto }];
  } else {
    const pergunta = ultimaFala(history);
    // 2) pedido claro de leitura/busca: chama a ferramenta (se liberada)
    const call = decidirFerramenta(pergunta, tools);
    if (call) return respostaDePartes([{ functionCall: call }]);
    const escrita = decidirEscrita(pergunta, tools, { history, obterModelo: () => obterModelo({ log: (m) => console.error(m) }) });
    if (escrita && escrita.call) return respostaDePartes([{ functionCall: escrita.call }]);
    if (escrita && escrita.texto) {
      if (onText) for (let i = 0; i < escrita.texto.length; i += 80) onText(escrita.texto.slice(i, i + 80));
      return respostaDePartes([{ text: escrita.texto }]);
    }
    const edicao = decidirEdicao(pergunta, tools);
    if (edicao && edicao.call) return respostaDePartes([{ functionCall: edicao.call }]);
    if (edicao && edicao.texto) {
      if (onText) for (let i = 0; i < edicao.texto.length; i += 80) onText(edicao.texto.slice(i, i + 80));
      return respostaDePartes([{ text: edicao.texto }]);
    }
    // 3) conhecimento
    const modelo = obterModelo({ log: (m) => console.error(m) });
    parts = [{ text: responder(modelo, pergunta, { anterior: ultimaFala(history, 1), history }) }];
  }
  const texto = parts[0].text;
  if (onText) for (let i = 0; i < texto.length; i += 80) onText(texto.slice(i, i + 80));
  return respostaDePartes(parts);
}

module.exports = { chatWithTools, responder, limparErroColado, pedidoOutra, pedidoSoCodigo, perguntaBase, ultimaFala, decidirFerramenta, decidirEscrita, decidirEdicao, caminhoSeguro, resultadoDasFerramentas, NOME };
