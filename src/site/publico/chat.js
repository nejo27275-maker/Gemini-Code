/* versão chat do modo site (v0.49.0): uma conversa por texto, comum — sem esfera nem voz. A mesma API e a mesma
 * segurança da página de voz (src/site/servidor.js); o que vem do modelo entra como texto (Markdown de comum.js). */
(function () {
  'use strict';

  const G = window.GeminiSite;
  const token = G.lerToken();
  const api = G.criarApi(token);
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const elConversa = $('conversa');
  const elLista = $('mensagens');
  const elVazio = $('vazio');
  const elForm = $('form');
  const elTexto = $('texto');
  const elEnviar = $('btn-enviar');
  const elNova = $('btn-nova');
  const elStatus = $('status');
  const elSubtitulo = $('subtitulo');
  // no PC, Enter envia; no celular, Enter quebra a linha e quem envia é o botão
  const ponteiroFino = Boolean(window.matchMedia && window.matchMedia('(pointer: fine)').matches);

  let ocupado = false;
  let parando = false;
  let esperando = false;
  const pendentes = new Map(); // perguntas abertas: id -> fechar(texto)

  function criar(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  const anunciar = (texto) => { elStatus.textContent = texto; };

  // rolagem: acompanha o fim só se a pessoa já estiver lá embaixo (lendo algo mais acima, não puxa a tela)
  let noFim = true;
  elConversa.addEventListener('scroll', () => {
    noFim = elConversa.scrollHeight - elConversa.scrollTop - elConversa.clientHeight < 80;
  }, { passive: true });
  function rolar(forcar) {
    if (forcar || noFim) { elConversa.scrollTop = elConversa.scrollHeight; noFim = true; }
  }

  const atualizarVazio = () => { elVazio.hidden = elLista.childElementCount > 0; };
  function adicionar(li, forcar) {
    elLista.append(li);
    atualizarVazio();
    rolar(forcar);
    return li;
  }

  function msgVoce(texto) {
    const li = criar('li', 'msg msg-voce');
    li.append(criar('div', 'balao', texto));
    return adicionar(li, true);
  }
  const aviso = (texto, classe = 'msg-aviso') => adicionar(criar('li', `msg ${classe}`, texto));

  /** Uma resposta do agente, escrita conforme chega. */
  function msgAgente() {
    const li = criar('li', 'msg msg-agente');
    const avatar = criar('div', 'avatar', 'G');
    avatar.setAttribute('aria-hidden', 'true');
    const corpo = criar('div', 'corpo');
    const ferramentas = criar('div', 'ferramentas');
    ferramentas.hidden = true;
    const digitando = criar('div', 'digitando');
    digitando.setAttribute('aria-hidden', 'true');
    digitando.append(criar('span'), criar('span'), criar('span'));
    const conteudo = criar('div', 'conteudo md');
    const acoes = criar('div', 'acoes-msg');
    acoes.hidden = true;
    const copiar = criar('button', 'acao', 'Copiar resposta');
    copiar.type = 'button';
    acoes.append(copiar);
    corpo.append(ferramentas, digitando, conteudo, acoes);
    li.append(avatar, corpo);
    li.setAttribute('aria-busy', 'true');
    adicionar(li, true);

    let texto = '';
    let separar = false;
    let agendado = false;
    const usadas = new Set();
    const desenhar = () => {
      agendado = false;
      conteudo.replaceChildren(G.montarMarkdown(G.analisarMarkdown(texto), document));
      rolar();
    };
    copiar.addEventListener('click', () => G.copiarTexto(texto, copiar));
    return {
      li,
      ferramenta(nome) {
        if (texto) separar = true; // o que o agente escrever depois da ferramenta é outro parágrafo
        const n = String(nome);
        if (usadas.has(n)) return;
        usadas.add(n);
        ferramentas.hidden = false;
        ferramentas.append(criar('span', 'ferramenta', n));
        rolar();
      },
      parcial(t) {
        if (!t) return;
        if (separar) { texto += '\n\n'; separar = false; }
        texto += t;
        digitando.hidden = true;
        if (!agendado) { agendado = true; requestAnimationFrame(desenhar); }
      },
      /** Fim: o texto final (quando nada chegou aos pedaços), uma nota (parada) ou um erro. */
      fim({ final = '', nota = '', erro = '' } = {}) {
        if (!texto && final) texto = final;
        digitando.hidden = true;
        desenhar();
        if (nota) corpo.insertBefore(criar('p', 'nota-msg', nota), acoes);
        if (erro) corpo.insertBefore(criar('p', 'erro-msg', erro), acoes);
        acoes.hidden = !texto;
        li.setAttribute('aria-busy', 'false');
        if (!texto && !nota && !erro && !usadas.size) li.remove();
        atualizarVazio();
      },
    };
  }

  /** Pedido de permissão de uma ferramenta, no meio da conversa. Sem resposta em 2 min, o agente conta "não". */
  function cartaoPergunta(ev) {
    const li = criar('li', 'msg msg-pergunta');
    const cartao = criar('div', 'cartao');
    cartao.setAttribute('role', 'group');
    cartao.setAttribute('aria-label', 'Pedido de permissão');
    const botoes = criar('div', 'cartao-botoes');
    const sim = criar('button', 'botao botao-primario', 'Permitir');
    const nao = criar('button', 'botao', 'Não permitir');
    sim.type = 'button';
    nao.type = 'button';
    botoes.append(sim, nao);
    const outra = criar('form', 'cartao-outra');
    const campo = criar('input');
    campo.type = 'text';
    campo.maxLength = 200;
    campo.placeholder = 'Outra resposta (ex.: sempre)';
    campo.setAttribute('aria-label', 'Outra resposta');
    const botaoOutra = criar('button', 'botao', 'Responder');
    botaoOutra.type = 'submit';
    outra.append(campo, botaoOutra);
    const estado = criar('p', 'cartao-estado');
    estado.hidden = true;
    cartao.append(criar('p', 'cartao-titulo', 'O agente pede a sua permissão'), criar('pre', 'cartao-texto', ev.texto), botoes, outra, estado);
    li.append(cartao);
    adicionar(li, true);

    const fechar = (texto) => {
      if (!pendentes.delete(ev.id)) return;
      botoes.remove();
      outra.remove();
      estado.textContent = texto;
      estado.hidden = false;
    };
    const responder = async (resposta, texto) => {
      fechar(texto);
      try {
        const r = await api('/api/confirmar', { id: ev.id, resposta });
        if (!r.ok) estado.textContent = 'Essa pergunta já tinha expirado: contou como "não".';
      } catch { estado.textContent = 'Sem conexão com o agente: contou como "não".'; }
      if (ponteiroFino) elTexto.focus({ preventScroll: true });
    };
    sim.addEventListener('click', () => responder('s', 'Você permitiu.'));
    nao.addEventListener('click', () => responder('n', 'Você não permitiu.'));
    outra.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = campo.value.trim() || 'n';
      responder(r, `Você respondeu: ${r}`);
    });
    pendentes.set(ev.id, fechar);
    anunciar('O agente pede a sua permissão.');
    if (ponteiroFino) sim.focus({ preventScroll: true });
  }
  const fecharPerguntas = (texto) => { for (const fechar of [...pendentes.values()]) fechar(texto); };

  // ---------------------------------------------------------------------------
  // Enviar, parar, conversa nova
  // ---------------------------------------------------------------------------
  function marcarOcupado(sim) {
    ocupado = sim;
    if (sim) app.dataset.ocupado = 'true'; else delete app.dataset.ocupado;
    elEnviar.setAttribute('aria-label', sim ? 'Parar a resposta (Esc)' : 'Enviar');
    elEnviar.title = sim ? 'Parar a resposta (Esc)' : 'Enviar';
    elNova.disabled = sim;
  }

  // Parar de verdade: o servidor para o agente no próximo ponto seguro e conta a pergunta aberta como "não".
  async function parar() {
    if (!ocupado || parando) return;
    parando = true;
    anunciar('Parando…');
    fecharPerguntas('Parado: contou como "não".');
    try { await api('/api/parar', {}); } catch { /* a conversa termina do mesmo jeito */ }
  }

  async function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || ocupado) return;
    if (!token) { semChave(); return; }
    marcarOcupado(true);
    // o histórico entra primeiro: se a mensagem fosse antes, ela voltaria junto com o histórico e apareceria duas vezes
    await pronto;
    msgVoce(texto);
    let atual = msgAgente();
    const segmento = () => { if (!atual) atual = msgAgente(); return atual; };
    anunciar('Pensando…');
    let final = '';
    let interrompida = false;
    let erro = '';
    try {
      const res = await api('/api/conversa', { texto });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.erro || `HTTP ${res.status}`);
      }
      for await (const ev of G.eventos(res)) {
        if (ev.tipo === 'parcial') segmento().parcial(ev.texto);
        else if (ev.tipo === 'ferramenta') {
          segmento().ferramenta(ev.nome);
          if (!parando) anunciar(`Usando: ${ev.nome}`);
        } else if (ev.tipo === 'alerta') {
          elLista.insertBefore(criar('li', 'msg msg-alerta', ev.texto), segmento().li);
          anunciar(ev.texto);
        } else if (ev.tipo === 'pergunta') {
          if (parando) continue;
          // o que o agente escreveu até aqui fica acima do pedido; o que vier depois, numa mensagem abaixo
          if (atual) { atual.fim(); atual = null; }
          cartaoPergunta(ev);
        } else if (ev.tipo === 'pergunta-expirou') {
          const f = pendentes.get(ev.id);
          if (f) f('Sem resposta em 2 minutos: contou como "não".');
        } else if (ev.tipo === 'resposta') {
          final = ev.texto || '';
          interrompida = Boolean(ev.interrompido);
        } else if (ev.tipo === 'erro') erro = ev.texto || 'Erro.';
      }
    } catch (e) {
      erro = `Não consegui falar com o agente: ${e.message}`;
    }
    fecharPerguntas(interrompida ? 'Parado: contou como "não".' : 'A conversa terminou: contou como "não".');
    const nota = interrompida ? 'Você parou a resposta.' : '';
    const m = atual || ((final && !interrompida) || nota || erro ? msgAgente() : null);
    if (m) m.fim({ final: interrompida ? '' : final, nota, erro });
    parando = false;
    marcarOcupado(false);
    anunciar(erro ? 'Algo deu errado.' : interrompida ? 'Resposta parada.' : 'Resposta pronta.');
    if (ponteiroFino) elTexto.focus({ preventScroll: true });
  }

  function semChave() {
    elLista.replaceChildren();
    aviso('Abra o endereço completo que o terminal mostrou (com #t=...). A chave muda a cada vez que o modo site é aberto.', 'msg-alerta');
    elTexto.disabled = true;
    elEnviar.disabled = true;
    elNova.disabled = true;
  }

  /**
   * A conversa que já existe (ao abrir ou recarregar a página). Se a pessoa mandou algo enquanto o histórico chegava,
   * o histórico entra ACIMA do que já está na tela (nada some); `substituir` refaz a tela inteira.
   */
  async function carregar({ substituir = false } = {}) {
    if (!token) { semChave(); return; }
    let d;
    try {
      const r = await api('/api/historico', {});
      if (!r.ok) { if (r.status === 401) semChave(); return; }
      d = await r.json();
    } catch { return; /* sem conexão: a página segue vazia */ }
    if (d.aliado) elSubtitulo.textContent = `Chat com o aliado "${d.aliado}"`;
    if (substituir) elLista.replaceChildren();
    const depois = elLista.firstChild;
    const inicio = elLista.childElementCount;
    for (const m of d.mensagens || []) {
      if (m.quem === 'voce') msgVoce(m.texto);
      else if (m.quem === 'agente') {
        const a = msgAgente();
        for (const f of m.ferramentas || []) a.ferramenta(f);
        a.fim({ final: m.texto, nota: m.interrompido ? 'Você parou esta resposta.' : '' });
      } else aviso(m.texto);
    }
    if (depois) for (const n of [...elLista.children].slice(inicio)) elLista.insertBefore(n, depois);
    atualizarVazio();
    rolar(true);
    // ocupada com outra resposta (de outra aba, ou de antes de recarregar): espera terminar. A nossa, não.
    if (d.ocupado && !esperando && !ocupado) esperarLivre();
  }

  // a página recarregou no meio de uma resposta: o servidor já mandou parar; espera terminar e mostra a conversa
  async function esperarLivre() {
    esperando = true;
    marcarOcupado(true);
    const nota = aviso('Terminando a resposta anterior…');
    for (let n = 0; n < 120; n++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const r = await api('/api/historico', {});
        if (r.ok && !(await r.json()).ocupado) break;
      } catch { /* tenta de novo */ }
    }
    nota.remove();
    parando = false;
    marcarOcupado(false);
    esperando = false;
    await carregar({ substituir: true });
  }

  elNova.addEventListener('click', async () => {
    if (ocupado) return;
    try {
      const r = await api('/api/limpar', {});
      if (!r.ok) { const e = await r.json().catch(() => ({})); aviso(e.erro || 'Não consegui começar outra agora.'); return; }
    } catch { aviso('Sem conexão com o agente.'); return; }
    elLista.replaceChildren();
    pendentes.clear();
    atualizarVazio();
    anunciar('Conversa nova.');
    elTexto.focus();
  });

  function ajustarAltura() {
    elTexto.style.height = 'auto';
    elTexto.style.height = `${Math.min(elTexto.scrollHeight, 200)}px`;
  }
  elTexto.addEventListener('input', ajustarAltura);
  elTexto.enterKeyHint = ponteiroFino ? 'send' : 'enter';
  elTexto.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ev.keyCode === 229 || !ponteiroFino) return;
    ev.preventDefault();
    if (!ocupado) {
      if (elForm.requestSubmit) elForm.requestSubmit();
      else elForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  elForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (ocupado) { parar(); return; } // enquanto responde, o botão de enviar é o "Parar"
    const t = elTexto.value;
    if (!t.trim()) return;
    elTexto.value = '';
    ajustarAltura();
    enviar(t);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ocupado) { ev.preventDefault(); parar(); }
  });
  for (const b of document.querySelectorAll('.sugestao')) b.addEventListener('click', () => enviar(b.textContent));

  marcarOcupado(false);
  const pronto = carregar().catch(() => {});
  if (ponteiroFino) elTexto.focus();
})();
