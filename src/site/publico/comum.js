/* modo site do gemini-code (v0.49.0) — o que as duas páginas (a de voz e a de chat) usam: a chave da sessão, as
 * chamadas à API, os eventos da conversa e o Markdown seguro.
 * O Markdown é analisado por funções puras (testadas em tests/site.test.js) e montado elemento por elemento, com o
 * texto sempre em textContent/createTextNode: nada que vem do modelo vira HTML. Link só http/https, e um link com
 * texto próprio mostra o domínio de verdade ao lado (um "[seu banco](https://outro.site)" não engana ninguém). */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Chave: vem no fragmento (#t=...), que não vai para o servidor nem para log. Sai da barra de endereço e fica só
  // nesta aba (sessionStorage), valendo para as duas páginas do mesmo endereço.
  // ---------------------------------------------------------------------------
  function lerToken() {
    const m = /[#&]t=([A-Za-z0-9_-]{16,})/.exec(location.hash);
    let t = m ? m[1] : '';
    try {
      if (t) sessionStorage.setItem('gc-token', t);
      else t = sessionStorage.getItem('gc-token') || '';
    } catch { /* sem armazenamento: fica só em memória */ }
    if (m) history.replaceState(null, '', location.pathname);
    return t;
  }

  function criarApi(token) {
    return (caminho, corpo) => fetch(caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo || {}),
      cache: 'no-store',
    });
  }

  /** Os eventos da conversa, um JSON por linha, conforme chegam. */
  async function* eventos(res) {
    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (linha) { try { yield JSON.parse(linha); } catch { /* linha quebrada: ignora */ } }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Markdown: analisar (puro: texto -> blocos) e montar (blocos -> elementos)
  // ---------------------------------------------------------------------------
  const MAX_MD = 200000; // além disso, o resto entra como texto simples
  const MAX_PROF = 4; // ênfase dentro de ênfase, citação dentro de citação...
  const ESCAPAVEIS = /[\\`*_{}[\]()#+\-.!~|>]/;
  const LETRA = /[\p{L}\p{N}]/u;
  const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

  /** Endereço aceitável para um link: só http/https; '' se não for. */
  function linkSeguro(url) {
    const u = String(url || '').trim().replace(/^<(.*)>$/, '$1');
    if (u.length > 2048 || !/^https?:\/\/\S+$/i.test(u)) return '';
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '';
    } catch { return ''; }
  }
  function hostDe(href) {
    try { return new URL(href).host; } catch { return ''; }
  }

  /** Fecha uma ênfase: no máximo 64 candidatos, para um texto hostil não travar a página. */
  function fechamento(s, desde, marca) {
    let k = desde;
    for (let n = 0; n < 64; n++) {
      k = s.indexOf(marca, k);
      if (k < 0) return -1;
      const antes = s[k - 1];
      const depois = s[k + marca.length];
      const ok = k > desde && !/\s/.test(antes)
        && !(marca.length === 1 && (depois === marca || antes === marca)) // um "*" não fecha no meio de "**"
        && !(marca[0] === '_' && depois !== undefined && LETRA.test(depois)); // nome_com_sublinhado não é itálico
      if (ok) return k;
      k += marca.length;
    }
    return -1;
  }

  /** Texto de uma linha (ou parágrafo) -> nós: texto, quebra, codigo, negrito, italico, riscado, link. */
  function inline(s, prof = 0) {
    const out = [];
    let buf = '';
    const texto = () => { if (buf) { out.push({ t: 'texto', v: buf }); buf = ''; } };
    const filhos = (x) => (prof < MAX_PROF ? inline(x, prof + 1) : [{ t: 'texto', v: x }]);
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length && ESCAPAVEIS.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      if (c === '\n') { texto(); out.push({ t: 'quebra' }); i++; continue; }
      if (c === '`') {
        let n = 1;
        while (s[i + n] === '`') n++;
        const fim = s.indexOf('`'.repeat(n), i + n);
        if (fim > i + n) {
          texto();
          let v = s.slice(i + n, fim).replace(/\n/g, ' ');
          if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ')) v = v.slice(1, -1);
          out.push({ t: 'codigo', v });
          i = fim + n;
          continue;
        }
        buf += s.slice(i, i + n);
        i += n;
        continue;
      }
      if (c === '[' || (c === '!' && s[i + 1] === '[')) {
        const ini = c === '!' ? i + 1 : i;
        const m = /^\[((?:[^\]\\\n]|\\.){1,500})\]\(\s*(<[^>\n]{1,2048}>|(?:[^\s()]|\([^\s()]*\)){1,2048})(?:\s+"[^"\n]{0,300}")?\s*\)/.exec(s.slice(ini, ini + 3000));
        if (m) {
          texto();
          const href = linkSeguro(m[2]);
          const rotulo = m[1];
          if (href) out.push({ t: 'link', href, nu: rotulo.trim() === m[2].trim(), filhos: filhos(rotulo) });
          else out.push(...filhos(rotulo)); // link que não é http/https: fica só o texto
          i = ini + m[0].length;
          continue;
        }
      }
      if ((c === 'h' || c === 'H') && (i === 0 || /[\s(<"'*_~[]/.test(s[i - 1]))) {
        const m = /^https?:\/\/[^\s<>"`]+/i.exec(s.slice(i, i + 2100));
        if (m) {
          let url = m[0];
          // pontuação no fim fica fora do link ("veja https://x.com."); parêntese só sai se estiver sobrando
          while (/[.,;:!?'")\]*_~]$/.test(url)) {
            if (url.endsWith(')') && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
            url = url.slice(0, -1);
          }
          const href = linkSeguro(url);
          if (href) {
            texto();
            out.push({ t: 'link', href, nu: true, filhos: [{ t: 'texto', v: url }] });
            i += url.length;
            continue;
          }
        }
      }
      if (c === '*' || c === '_' || c === '~') {
        const tripla = c !== '~' && s[i + 1] === c && s[i + 2] === c;
        const dupla = s[i + 1] === c;
        if (c === '~' && !dupla) { buf += c; i++; continue; }
        const marca = tripla ? c + c + c : dupla ? c + c : c;
        const prox = s[i + marca.length];
        const antes = s[i - 1];
        const podeAbrir = prox !== undefined && !/\s/.test(prox) && !(c === '_' && antes !== undefined && LETRA.test(antes));
        if (podeAbrir) {
          const fim = fechamento(s, i + marca.length, marca);
          if (fim > 0) {
            texto();
            const dentro = filhos(s.slice(i + marca.length, fim));
            if (tripla) out.push({ t: 'negrito', filhos: [{ t: 'italico', filhos: dentro }] });
            else out.push({ t: marca === '~~' ? 'riscado' : dupla ? 'negrito' : 'italico', filhos: dentro });
            i = fim + marca.length;
            continue;
          }
        }
        buf += marca;
        i += marca.length;
        continue;
      }
      buf += c;
      i++;
    }
    texto();
    return out;
  }

  const largura = (recuo) => recuo.replace(/\t/g, '    ').length;

  function celulas(linha) {
    let l = linha.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
    const out = [];
    let atual = '';
    let crase = false;
    for (let k = 0; k < l.length; k++) {
      const ch = l[k];
      if (ch === '\\' && l[k + 1] === '|') { atual += '\\|'; k++; continue; }
      if (ch === '`') crase = !crase;
      if (ch === '|' && !crase) { out.push(atual.trim()); atual = ''; continue; }
      atual += ch;
    }
    out.push(atual.trim());
    return out.slice(0, 40);
  }
  const SEPARADOR = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

  /**
   * Texto em Markdown -> blocos: paragrafo, titulo, regua, codigo, citacao, lista, tabela.
   * Funciona com o texto pela metade (enquanto a resposta chega): um bloco de código ainda aberto vira código.
   */
  function analisarMarkdown(texto, prof = 0) {
    let s = String(texto == null ? '' : texto);
    let resto = '';
    if (s.length > MAX_MD) { resto = s.slice(MAX_MD); s = s.slice(0, MAX_MD); }
    const linhas = s.replace(/\r\n?/g, '\n').split('\n');
    const blocos = [];
    let para = [];
    const fecharPara = () => {
      if (para.length) { blocos.push({ tipo: 'paragrafo', inline: inline(para.join('\n')) }); para = []; }
    };
    let i = 0;
    while (i < linhas.length) {
      const l = linhas[i];
      const cerca = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(l);
      if (cerca) {
        fecharPara();
        const marca = cerca[1];
        const fimRe = new RegExp(`^ {0,3}${marca[0]}{${marca.length},}[ \\t]*$`);
        const corpo = [];
        i++;
        while (i < linhas.length && !fimRe.test(linhas[i])) corpo.push(linhas[i++]);
        const aberto = i >= linhas.length;
        if (!aberto) i++;
        blocos.push({ tipo: 'codigo', lingua: cerca[2].slice(0, 24), texto: corpo.join('\n'), aberto });
        continue;
      }
      if (!l.trim()) { fecharPara(); i++; continue; }
      const titulo = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(l);
      if (titulo) { fecharPara(); blocos.push({ tipo: 'titulo', nivel: titulo[1].length, inline: inline(titulo[2], prof) }); i++; continue; }
      if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(l)) { fecharPara(); blocos.push({ tipo: 'regua' }); i++; continue; }
      if (l.includes('|') && i + 1 < linhas.length && linhas[i + 1].includes('|') && SEPARADOR.test(linhas[i + 1])) {
        fecharPara();
        const cabecalho = celulas(l);
        const alinhamentos = celulas(linhas[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'centro' : /-+:$/.test(c) ? 'direita' : ''));
        const linhasTabela = [];
        i += 2;
        while (i < linhas.length && linhas[i].includes('|') && linhas[i].trim() && linhasTabela.length < 500) {
          const cs = celulas(linhas[i]);
          linhasTabela.push(cabecalho.map((_, k) => inline(cs[k] || '', prof)));
          i++;
        }
        blocos.push({ tipo: 'tabela', alinhamentos, cabecalho: cabecalho.map((c) => inline(c, prof)), linhas: linhasTabela });
        continue;
      }
      if (/^ {0,3}>/.test(l)) {
        fecharPara();
        const dentro = [];
        while (i < linhas.length && /^ {0,3}>/.test(linhas[i])) dentro.push(linhas[i++].replace(/^ {0,3}> ?/, ''));
        const conteudo = dentro.join('\n');
        blocos.push({ tipo: 'citacao', blocos: prof < 3 ? analisarMarkdown(conteudo, prof + 1) : [{ tipo: 'paragrafo', inline: inline(conteudo, prof) }] });
        continue;
      }
      const item = ITEM.exec(l);
      if (item) {
        fecharPara();
        const base = largura(item[1]);
        const tipoBase = /\d/.test(item[2]);
        const itens = [];
        while (i < linhas.length) {
          const li = ITEM.exec(linhas[i]);
          if (li && !/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(linhas[i])) {
            const ordenada = /\d/.test(li[2]);
            // no primeiro nível, trocar de numerada para marcadores (ou o contrário) começa outra lista
            if (itens.length && ordenada !== tipoBase && largura(li[1]) - base < 2) break;
            let conteudo = li[3];
            let marcado = null;
            const tarefa = /^\[([ xX])\][ \t]+(.*)$/.exec(conteudo);
            if (tarefa && !ordenada) { marcado = tarefa[1] !== ' '; conteudo = tarefa[2]; }
            itens.push({
              nivel: Math.max(0, Math.min(5, Math.floor((largura(li[1]) - base) / 2))),
              ordenada,
              numero: ordenada ? Math.min(999999999, parseInt(li[2], 10)) : 0,
              marcado,
              linhas: [conteudo],
            });
            i++;
            continue;
          }
          // continuação do item: linha recuada que não abre um bloco de código
          if (itens.length && /^[ \t]+\S/.test(linhas[i]) && !/^[ \t]*(`{3,}|~{3,})/.test(linhas[i])) {
            itens[itens.length - 1].linhas.push(linhas[i].trim());
            i++;
            continue;
          }
          // linha em branco entre dois itens: a mesma lista continua
          if (!linhas[i].trim() && i + 1 < linhas.length && ITEM.test(linhas[i + 1])) { i++; continue; }
          break;
        }
        blocos.push({
          tipo: 'lista',
          itens: itens.map((x) => ({ nivel: x.nivel, ordenada: x.ordenada, numero: x.numero, marcado: x.marcado, inline: inline(x.linhas.join('\n'), prof) })),
        });
        continue;
      }
      para.push(l);
      i++;
    }
    fecharPara();
    if (resto) blocos.push({ tipo: 'paragrafo', inline: [{ t: 'texto', v: resto }] });
    return blocos;
  }

  // ---------------------------------------------------------------------------
  // Montar: blocos -> elementos (sempre textContent/createTextNode)
  // ---------------------------------------------------------------------------
  async function copiarTexto(texto, botao) {
    let ok = false;
    try { await navigator.clipboard.writeText(String(texto)); ok = true; } catch { /* sem permissão para a área de transferência */ }
    if (botao) {
      if (!botao.dataset.rotulo) botao.dataset.rotulo = botao.textContent;
      botao.textContent = ok ? 'Copiado' : 'Não consegui copiar';
      clearTimeout(botao._gcTimer);
      botao._gcTimer = setTimeout(() => { botao.textContent = botao.dataset.rotulo; }, 1600);
    }
    return ok;
  }

  function montarInline(pai, nos, doc) {
    for (const n of nos) {
      if (n.t === 'texto') pai.append(doc.createTextNode(n.v));
      else if (n.t === 'quebra') pai.append(doc.createElement('br'));
      else if (n.t === 'codigo') { const c = doc.createElement('code'); c.textContent = n.v; pai.append(c); }
      else if (n.t === 'link') {
        const a = doc.createElement('a');
        a.href = n.href; // já conferido: só http/https
        a.title = n.href;
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        montarInline(a, n.filhos, doc);
        pai.append(a);
        if (!n.nu) {
          const h = doc.createElement('span');
          h.className = 'md-host';
          h.textContent = ` (${hostDe(n.href)})`;
          pai.append(h);
        }
      } else {
        const tag = { negrito: 'strong', italico: 'em', riscado: 'del' }[n.t];
        if (!tag) continue;
        const e = doc.createElement(tag);
        montarInline(e, n.filhos, doc);
        pai.append(e);
      }
    }
  }

  function montarLista(b, doc) {
    const nova = (it) => {
      const l = doc.createElement(it.ordenada ? 'ol' : 'ul');
      if (it.ordenada && it.numero !== 1) l.start = it.numero;
      return l;
    };
    const raiz = nova(b.itens[0]);
    const pilha = [{ lista: raiz, nivel: 0, ultimo: null }];
    for (const it of b.itens) {
      let topo = pilha[pilha.length - 1];
      while (it.nivel < topo.nivel && pilha.length > 1) { pilha.pop(); topo = pilha[pilha.length - 1]; }
      if (it.nivel > topo.nivel && topo.ultimo) {
        const sub = nova(it);
        topo.ultimo.append(sub);
        pilha.push({ lista: sub, nivel: it.nivel, ultimo: null });
        topo = pilha[pilha.length - 1];
      }
      const li = doc.createElement('li');
      if (it.marcado !== null) {
        li.className = 'md-tarefa';
        const caixa = doc.createElement('span');
        caixa.className = it.marcado ? 'md-caixa md-feito' : 'md-caixa';
        caixa.textContent = it.marcado ? '☑ ' : '☐ ';
        li.append(caixa);
      }
      montarInline(li, it.inline, doc);
      topo.lista.append(li);
      topo.ultimo = li;
    }
    return raiz;
  }

  function montarBloco(b, doc) {
    const el = (tag, classe) => { const e = doc.createElement(tag); if (classe) e.className = classe; return e; };
    if (b.tipo === 'paragrafo') { const p = el('p'); montarInline(p, b.inline, doc); return p; }
    if (b.tipo === 'titulo') { const h = el(`h${Math.min(6, b.nivel + 2)}`, 'md-titulo'); montarInline(h, b.inline, doc); return h; }
    if (b.tipo === 'regua') return el('hr');
    if (b.tipo === 'citacao') { const q = el('blockquote'); for (const x of b.blocos) q.append(montarBloco(x, doc)); return q; }
    if (b.tipo === 'lista') return montarLista(b, doc);
    if (b.tipo === 'codigo') {
      const caixa = el('div', 'md-codigo');
      const topo = el('div', 'md-codigo-topo');
      const lingua = el('span', 'md-lingua');
      lingua.textContent = b.lingua || 'texto';
      const copiar = el('button', 'md-copiar');
      copiar.type = 'button';
      copiar.textContent = 'Copiar';
      copiar.addEventListener('click', () => copiarTexto(b.texto, copiar));
      topo.append(lingua, copiar);
      const pre = el('pre');
      const code = el('code');
      code.textContent = b.texto;
      pre.append(code);
      caixa.append(topo, pre);
      return caixa;
    }
    if (b.tipo === 'tabela') {
      const caixa = el('div', 'md-tabela');
      const t = el('table');
      const cab = el('thead');
      const tr = el('tr');
      const classe = (k) => (b.alinhamentos[k] ? `md-${b.alinhamentos[k]}` : '');
      b.cabecalho.forEach((c, k) => { const th = el('th', classe(k)); th.scope = 'col'; montarInline(th, c, doc); tr.append(th); });
      cab.append(tr);
      const corpo = el('tbody');
      for (const linha of b.linhas) {
        const r = el('tr');
        linha.forEach((c, k) => { const td = el('td', classe(k)); montarInline(td, c, doc); r.append(td); });
        corpo.append(r);
      }
      t.append(cab, corpo);
      caixa.append(t);
      return caixa;
    }
    return doc.createTextNode('');
  }

  /** Blocos -> um fragmento pronto para entrar na página. */
  function montarMarkdown(blocos, doc = document) {
    const frag = doc.createDocumentFragment();
    for (const b of blocos) frag.append(montarBloco(b, doc));
    return frag;
  }

  window.GeminiSite = Object.freeze({ lerToken, criarApi, eventos, analisarMarkdown, montarMarkdown, copiarTexto, linkSeguro });
})();
