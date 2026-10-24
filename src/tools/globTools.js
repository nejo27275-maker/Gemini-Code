// src/tools/globTools.js
// glob_files: acha arquivos pelo NOME (padrão glob), sem abrir nenhum. Antes o
// modelo só tinha list_dir (uma pasta por vez) e search_files (conteúdo), então
// "onde estão os testes?" virava dezenas de chamadas. Node puro, sem minimatch:
// o projeto não leva dependência além de "ws".
//
// globParaRegex e criarFiltroGitignore são exportados para o search_files
// reaproveitar o mesmo entendimento de padrão e de .gitignore.
'use strict';

const fs = require('fs');
const path = require('path');
const { isSecret, verificadorDeSegredos, MSG_SEGREDO } = require('./protectedPaths');

const SEMPRE_IGNORAR = new Set(['.git', 'node_modules']);
// Objeto mutável só para os testes exercitarem os limites sem criar 50 000 arquivos.
const LIMITES = { maxResultados: 300, maxVarredura: 50000 };
const MAX_PADRAO = 1000; // caracteres
const MAX_ALTERNATIVAS = 256; // {a,b}{c,d}... cresce em produto: 9 pares já dão 512
const MAX_GITIGNORE = 1024 * 1024; // .gitignore maior que isso não é de verdade
const GLOBSTAR = Symbol('**');
const QUALQUER_SEGMENTO = '[^/]+(?:/|$)';

const declarations = [
  {
    name: 'glob_files',
    description:
      'Acha arquivos pelo nome com um padrão glob (*, **, ?, [abc], {a,b}), ex.: "src/**/*.js", ' +
      '"**/*.test.js", "*.md" (este só na própria pasta). Não abre os arquivos. Ignora .git, ' +
      'node_modules e o que os .gitignore ignoram; não entra em pasta que é link simbólico. ' +
      'Devolve caminhos relativos à pasta atual, do mais recente para o mais antigo (até 300).',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Padrão glob relativo a "path". "*" não atravessa "/"; "**" casa qualquer número de pastas.',
        },
        path: { type: 'string', description: 'Pasta onde procurar (padrão: .)' },
        include_hidden: {
          type: 'boolean',
          description: 'Se true, inclui arquivos e pastas cujo nome começa com ponto (ex.: .github). .git continua de fora. Padrão: false.',
        },
      },
      required: ['pattern'],
    },
  },
];

// ---------------------------------------------------------------------------
// Padrão glob -> RegExp

// Lê uma classe [..] a partir de s[i] === '['. Devolve { fim, src } (fim = índice do
// ']') ou null quando não fecha: aí o '[' vale como caractere comum, como no git.
function lerClasse(s, i) {
  let j = i + 1;
  let negada = false;
  if (s[j] === '!' || s[j] === '^') { negada = true; j++; }
  let corpo = '';
  for (let primeiro = true; j < s.length; j++, primeiro = false) {
    let c = s[j];
    // ']' logo no início é literal ([]] casa "]").
    if (c === ']' && !primeiro) {
      // '/' separa pastas: nunca casa dentro de colchetes.
      // '-' no começo de classe negada é literal ([!-9] = "nem '-' nem '9'"); colado no '/' viraria o
      // intervalo '/'..'9' e excluiria os dígitos (revisão adversarial da v0.41.0).
      return { fim: j, src: negada ? `[^/${corpo.startsWith('-') ? '\\' + corpo : corpo}]` : `(?!/)[${corpo}]` };
    }
    if (c === '\\' && j + 1 < s.length) {
      c = s[++j];
      corpo += /[\\\][^-]/.test(c) ? '\\' + c : c;
    } else {
      corpo += /[\\\][^]/.test(c) ? '\\' + c : c; // '-' sem escape segue sendo intervalo
    }
  }
  return null;
}

function tokenizar(s) {
  const toks = [];
  let classe;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      toks.push({ t: 'lit', v: s[++i] });
    } else if (c === '*') {
      const ultimo = toks[toks.length - 1];
      if (ultimo && ultimo.t === 'star') ultimo.n++;
      else toks.push({ t: 'star', n: 1 });
    } else if (c === '?') {
      toks.push({ t: 'any' });
    } else if (c === '[' && (classe = lerClasse(s, i))) {
      toks.push({ t: 'class', v: classe.src });
      i = classe.fim;
    } else if (c === '/') {
      toks.push({ t: 'sep' });
    } else {
      toks.push({ t: 'lit', v: c });
    }
  }
  return toks;
}

// Divide em segmentos de pasta. Um segmento que é só "**" vira GLOBSTAR; "a**b"
// conta como "*" comum (mesma regra do git). "./" e "//" não significam nada.
function segmentos(toks) {
  const brutos = [[]];
  for (const tk of toks) {
    if (tk.t === 'sep') brutos.push([]);
    else brutos[brutos.length - 1].push(tk);
  }
  const segs = [];
  for (const s of brutos) {
    if (!s.length || (s.length === 1 && s[0].t === 'lit' && s[0].v === '.')) continue;
    if (s.length === 1 && s[0].t === 'star' && s[0].n >= 2) {
      if (segs[segs.length - 1] !== GLOBSTAR) segs.push(GLOBSTAR); // "**/**" = "**"
      continue;
    }
    segs.push(s);
  }
  return segs;
}

function fonteToken(tk) {
  if (tk.t === 'lit') return tk.v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  if (tk.t === 'any') return '[^/]';
  return tk.v;
}

// Um segmento (sem '/'). Traduzir cada '*' para [^/]* deixa "*a*a*a*a*b" contra um
// nome comprido em backtracking exponencial. Aqui cada pedaço fixo entre dois '*'
// vira um grupo atômico emulado, (?=([^/]*?X))\N: fixa a PRIMEIRA ocorrência de X
// e não volta atrás. Dentro de um segmento isso é exato (o '*' seguinte absorve o
// que sobrar), e o custo fica linear no tamanho do nome.
function fonteSegmento(seg, grupos) {
  const pedacos = [''];
  for (const tk of seg) {
    if (tk.t === 'star') pedacos.push('');
    else pedacos[pedacos.length - 1] += fonteToken(tk);
  }
  let src = pedacos[0];
  for (let i = 1; i < pedacos.length - 1; i++) {
    const g = ++grupos.n;
    src += `(?=([^/]*?${pedacos[i]}))(?:\\${g})`; // (?:\N): "\1" seguido de "0" viraria \10
  }
  if (pedacos.length > 1) src += '[^/]*' + pedacos[pedacos.length - 1];
  return src;
}

// Caminho inteiro: o mesmo truque, agora com "**" no papel do '*' e segmentos no
// lugar de caracteres. Blocos entre dois "**" ficam na primeira posição em que
// casam; o último bloco fica preso ao fim. Cada segmento termina em (?:/|$) e
// começa com (?=[^/]): sem isso "**/x/*" casava "a/x" com um '*' vazio depois do fim.
function fonteCaminho(segs, grupos) {
  const blocos = [[]];
  for (const s of segs) {
    if (s === GLOBSTAR) blocos.push([]);
    else blocos[blocos.length - 1].push(s);
  }
  const bloco = (b) => b.map((s) => '(?=[^/])' + fonteSegmento(s, grupos) + '(?:/|$)').join('');
  let src = bloco(blocos[0]);
  if (blocos.length === 1) return src;
  for (let i = 1; i < blocos.length - 1; i++) {
    const g = ++grupos.n; // numerado antes dos grupos de dentro: é a ordem dos '(' na regex
    src += `(?=((?:${QUALQUER_SEGMENTO})*?${bloco(blocos[i])}))(?:\\${g})`;
  }
  const ultimo = blocos[blocos.length - 1];
  // "**" no fim casa uma ou mais pastas/arquivos: "src/**" pega tudo dentro de src.
  src += ultimo.length ? `(?:${QUALQUER_SEGMENTO})*${bloco(ultimo)}` : `(?:${QUALQUER_SEGMENTO})+`;
  return src;
}

function compilar(padroes) {
  const grupos = { n: 0 };
  const alternativas = padroes.map((p) => fonteCaminho(segmentos(tokenizar(p)), grupos));
  return new RegExp(`^(?:${alternativas.join('|')})$`);
}

// Primeiro grupo {a,b} fechado e com vírgula (fora de escape e de [..]). "{abc}"
// sem vírgula e chave sem par ficam literais, como no bash.
function acharChaves(s) {
  const pilha = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') {
      const classe = lerClasse(s, i);
      if (classe) i = classe.fim;
      continue;
    }
    if (c === '{') {
      pilha.push({ inicio: i, virgulas: [] });
    } else if (pilha.length && c === ',') {
      pilha[pilha.length - 1].virgulas.push(i);
    } else if (pilha.length && c === '}') {
      const g = pilha.pop();
      if (!g.virgulas.length) continue;
      const cortes = [g.inicio, ...g.virgulas, i];
      return { inicio: g.inicio, fim: i, alternativas: cortes.slice(1).map((fim, k) => s.slice(cortes[k] + 1, fim)) };
    }
  }
  return null;
}

function expandirChaves(padrao) {
  const prontos = new Set();
  const pendentes = [padrao];
  while (pendentes.length) {
    const atual = pendentes.pop();
    const g = acharChaves(atual);
    if (!g) { prontos.add(atual); continue; }
    for (const alt of g.alternativas) pendentes.push(atual.slice(0, g.inicio) + alt + atual.slice(g.fim + 1));
    // Cada expansão só aumenta a contagem: dá para recusar antes de explodir a memória.
    if (pendentes.length + prontos.size > MAX_ALTERNATIVAS) {
      throw new Error(`chaves {..} demais: o padrão vira mais de ${MAX_ALTERNATIVAS} alternativas`);
    }
  }
  return [...prontos];
}

function validarTamanho(pattern) {
  if (typeof pattern !== 'string') throw new TypeError('o padrão glob precisa ser texto');
  if (pattern.length > MAX_PADRAO) throw new Error(`padrão longo demais (máximo de ${MAX_PADRAO} caracteres)`);
}

/**
 * Converte um glob (*, **, ?, [abc], [!abc], {a,b}, \ para escapar) numa RegExp que
 * testa caminhos relativos com "/" (ex.: "src/a/b.js"). "*" casa também nomes que
 * começam com ponto: quem decide sobre ocultos é quem varre. Lança Error se o
 * padrão for inválido (ex.: [z-a]) ou grande demais.
 */
function globParaRegex(pattern) {
  validarTamanho(pattern);
  return compilar(expandirChaves(pattern));
}

// ---------------------------------------------------------------------------
// .gitignore

// Uma linha -> { re, negada, soDir } ou null. Chaves não são especiais no gitignore.
function regraGitignore(linha) {
  if (linha.endsWith('\r')) linha = linha.slice(0, -1);
  if (!linha || linha[0] === '#') return null;
  // Espaços no fim são ignorados, a não ser que escapados ("a\ "). Laço em vez de
  // regex: uma linha com milhares de espaços no meio não pode travar a varredura.
  let fim = linha.length;
  while (fim > 0 && linha[fim - 1] === ' ' && linha[fim - 2] !== '\\') fim--;
  linha = linha.slice(0, fim);
  const negada = linha[0] === '!';
  if (negada) linha = linha.slice(1);
  let soDir = false;
  while (linha.endsWith('/')) { soDir = true; linha = linha.slice(0, -1); }
  if (!linha || linha.length > MAX_PADRAO) return null;
  // Com barra no início ou no meio, vale a partir da pasta do .gitignore; sem barra,
  // vale em qualquer nível abaixo dela (equivale a "**/nome").
  const corpo = linha.includes('/') ? linha.replace(/^\/+/, '') : '**/' + linha;
  try {
    return { re: compilar([corpo]), negada, soDir };
  } catch {
    return null; // ex.: [z-a]; o git também só deixa de casar
  }
}

/**
 * Cria um filtro que responde se um caminho (relativo a `raiz`, com "/") é ignorado
 * pelos .gitignore da raiz e das subpastas. Lê cada .gitignore uma vez, sob demanda.
 * Segue o git: a última regra que casa vence, o .gitignore mais fundo tem a palavra
 * final, e nada volta se uma pasta de cima foi ignorada.
 * @returns {(caminhoRelativo: string, ehDiretorio?: boolean) => boolean}
 */
function acharTopoGit(pasta) {
  for (let d = pasta; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

function criarFiltroGitignore(raiz) {
  const base = path.resolve(raiz);
  const ehSegredo = verificadorDeSegredos();
  const regrasPorPasta = new Map();
  const pastasIgnoradas = new Map();
  // v0.41.0: numa subpasta de um repositório, os .gitignore do topo até ela também valem (como no git);
  // antes "dist/" do .gitignore da raiz não valia com o agente aberto em packages/app.
  let topo = base;
  let prefixo = [];

  function regrasDe(pastaRel) {
    let regras = regrasPorPasta.get(pastaRel);
    if (regras) return regras;
    regras = [];
    const arquivo = path.join(topo, pastaRel, '.gitignore');
    try {
      const st = fs.statSync(arquivo);
      // Um repositório pode trazer .gitignore -> ~/.gemini-code/config.json: não lemos segredo.
      if (st.isFile() && st.size <= MAX_GITIGNORE && !ehSegredo(arquivo, st)) {
        // BOM (Bloco de Notas) no começo: o git descarta; sem tirar, a primeira regra não valia.
        for (const linha of fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
          const regra = regraGitignore(linha);
          if (regra) regras.push(regra);
        }
      }
    } catch { /* sem .gitignore ou ilegível: nenhuma regra */ }
    regrasPorPasta.set(pastaRel, regras);
    return regras;
  }

  // Só as regras, sem olhar as pastas de cima.
  function casaRegras(partes, ehDir) {
    let ignorado = false;
    for (let i = 0; i < partes.length; i++) {
      const regras = regrasDe(partes.slice(0, i).join('/'));
      if (!regras.length) continue;
      const resto = partes.slice(i).join('/');
      for (const r of regras) {
        // Ignorado, só uma negação muda algo; não ignorado, só uma regra comum.
        if (r.negada === ignorado && (!r.soDir || ehDir) && r.re.test(resto)) ignorado = !r.negada;
      }
    }
    return ignorado;
  }

  function pastaIgnorada(partes) {
    const chave = partes.join('/');
    let ignorada = pastasIgnoradas.get(chave);
    if (ignorada === undefined) {
      ignorada = (partes.length > 1 && pastaIgnorada(partes.slice(0, -1))) || casaRegras(partes, true);
      pastasIgnoradas.set(chave, ignorada);
    }
    return ignorada;
  }

  const topoGit = acharTopoGit(base);
  if (topoGit && topoGit !== base) {
    topo = topoGit;
    prefixo = path.relative(topoGit, base).split(path.sep).filter(Boolean);
    // Pasta pedida de propósito que o próprio repositório ignora (ex.: path "dist"): olhar dentro dela é a
    // intenção; aí valem só as regras dela para baixo, como antes.
    if (pastaIgnorada(prefixo)) { topo = base; prefixo = []; regrasPorPasta.clear(); pastasIgnoradas.clear(); }
  }

  return function ignorado(caminhoRelativo, ehDiretorio = false) {
    let rel = String(caminhoRelativo);
    if (path.isAbsolute(rel)) rel = path.relative(base, rel);
    if (path.sep === '\\') rel = rel.replace(/\\/g, '/');
    // normalize: "a/../../x" não pode fazer o filtro ler um .gitignore acima da raiz.
    const relativas = path.posix.normalize(rel).split('/').filter((p) => p && p !== '.');
    // A própria raiz ou algo fora dela: as regras daqui não se aplicam.
    if (!relativas.length || relativas[0] === '..') return false;
    const partes = [...prefixo, ...relativas];
    if (ehDiretorio) return pastaIgnorada(partes);
    return (partes.length > 1 && pastaIgnorada(partes.slice(0, -1))) || casaRegras(partes, false);
  };
}

// ---------------------------------------------------------------------------
// Varredura

// Poda: só desce numa pasta se algum padrão ainda pode casar algo lá dentro.
// Sem isso "src/**/*.js" num monorepo gastaria o limite de 50 000 arquivos fora de src.
function podeConter(alternativas, partes) {
  return alternativas.some((segs) => {
    for (let i = 0; i < partes.length; i++) {
      if (i >= segs.length) return false;
      if (segs[i] === GLOBSTAR) return true;
      if (!segs[i].test(partes[i])) return false;
    }
    return partes.length < segs.length; // ainda falta ao menos o nome do arquivo
  });
}

function varrer(raiz, alvo, alternativas, incluirOcultos) {
  const filtro = criarFiltroGitignore(raiz);
  const achados = [];
  let vistos = 0;
  let interrompido = false;
  const pilha = [[]]; // partes relativas das pastas a visitar
  while (pilha.length && !interrompido) {
    const partes = pilha.pop();
    const dir = path.join(raiz, ...partes);
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // pasta ilegível (permissão, sumiu no meio): segue com o resto
    }
    for (const e of entradas) {
      if (SEMPRE_IGNORAR.has(e.name) || (!incluirOcultos && e.name.startsWith('.'))) continue;
      const cheio = path.join(dir, e.name);
      let ehDir = e.isDirectory();
      let ehArquivo = e.isFile();
      if (e.isSymbolicLink()) {
        // Pasta-link fica de fora (proj/link -> proj seria laço infinito); link para arquivo vale.
        ehDir = false;
        try { ehArquivo = fs.statSync(cheio).isFile(); } catch { ehArquivo = false; }
      }
      const sub = partes.concat(e.name);
      const rel = sub.join('/');
      if (ehDir) {
        if (podeConter(alternativas, sub) && !filtro(rel, true)) pilha.push(sub);
      } else if (ehArquivo) {
        if (++vistos > LIMITES.maxVarredura) { interrompido = true; break; }
        if (alvo.test(rel) && !filtro(rel, false)) {
          let mtime = 0;
          try { mtime = fs.statSync(cheio).mtimeMs; } catch { /* sumiu durante a varredura */ }
          achados.push({ caminho: cheio, mtime });
        }
      }
    }
  }
  return { achados, interrompido };
}

async function execute(name, args) {
  if (name !== 'glob_files') throw new Error(`Ferramenta de glob desconhecida: ${name}`);
  args = args || {};
  const pattern = args.pattern;
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return 'Erro: glob_files precisa de "pattern" (texto não vazio), ex.: "src/**/*.js".';
  }
  if (args.path != null && typeof args.path !== 'string') return 'Erro: "path" precisa ser texto (a pasta onde procurar).';
  if (args.include_hidden != null && typeof args.include_hidden !== 'boolean') {
    return 'Erro: "include_hidden" precisa ser true ou false.';
  }
  if (path.isAbsolute(pattern) || pattern.startsWith('/')) {
    return 'Erro: "pattern" é relativo à pasta de "path" (ex.: "src/**/*.js"); para procurar em outra pasta, passe-a em "path".';
  }
  if (pattern.split(/[\\/]/).includes('..')) {
    return 'Erro: "pattern" não pode subir pastas com ".."; passe a pasta de cima em "path".';
  }

  const pasta = args.path || '.';
  const raiz = path.resolve(pasta);
  if (isSecret(raiz)) return MSG_SEGREDO;
  let st;
  try {
    st = fs.statSync(raiz);
  } catch {
    return `Erro: diretório não existe: ${pasta}`;
  }
  if (!st.isDirectory()) return `Erro: "${pasta}" não é um diretório (glob_files procura dentro de uma pasta).`;

  let alvo;
  let alternativas;
  try {
    validarTamanho(pattern);
    const padroes = expandirChaves(pattern);
    alvo = compilar(padroes);
    alternativas = padroes.map((p) =>
      segmentos(tokenizar(p)).map((s) => (s === GLOBSTAR ? s : new RegExp(`^${fonteSegmento(s, { n: 0 })}$`))));
  } catch (err) {
    return `Erro: padrão inválido (${err.message}).`;
  }

  const incluirOcultos = args.include_hidden === true;
  const { achados, interrompido } = varrer(raiz, alvo, alternativas, incluirOcultos);
  const avisoVarredura = interrompido
    ? `\n[aviso: a varredura parou depois de ${LIMITES.maxVarredura} arquivos; o resultado pode estar incompleto. ` +
      'Use um "path" mais específico ou um padrão com pasta fixa, ex.: "src/**/*.js".]'
    : '';

  if (!achados.length) {
    let dica = ' .git, node_modules e o que os .gitignore ignoram ficam de fora.';
    if (!incluirOcultos) dica += ' Nomes começando com ponto foram pulados (use include_hidden=true).';
    if (!pattern.includes('/') && !pattern.includes('**')) {
      dica += ` Sem "/" o padrão só olha a própria pasta; use "**/${pattern}" para descer nas subpastas.`;
    }
    return `Nenhum arquivo corresponde a "${pattern}" em "${pasta}".${dica}${avisoVarredura}`;
  }

  achados.sort((a, b) => b.mtime - a.mtime || (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  const lista = achados.slice(0, LIMITES.maxResultados).map((a) => path.relative(process.cwd(), a.caminho));
  const avisoCorte = achados.length > LIMITES.maxResultados
    ? `\n[... mostrando os ${LIMITES.maxResultados} mais recentes de ${achados.length} arquivos; refine o padrão]`
    : '';
  return lista.join('\n') + avisoCorte + avisoVarredura;
}

module.exports = { declarations, execute, globParaRegex, criarFiltroGitignore, LIMITES };
