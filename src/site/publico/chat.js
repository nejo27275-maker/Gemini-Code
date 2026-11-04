/* versão chat do modo site (v0.49.0): uma conversa por texto, comum — sem esfera nem voz. A mesma API e a mesma
 * segurança da página de voz (src/site/servidor.js); o que vem do modelo entra como texto (Markdown de comum.js).
 * v0.51.0: foto, vídeo e áudio — pelo clipe, arrastando ou colando; o arquivo sobe na hora (com o progresso), aparece
 * na sua mensagem, e o que o agente criar (a foto editada, o vídeo) aparece na resposta, com o botão de baixar. */
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
  const elAnexos = $('anexos');
  const elArquivo = $('arquivo');
  const elAnexar = $('btn-anexar');
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

  const urls = new Set(); // v0.51.0: os blob: das prévias (liberados na conversa nova)
  function cartoes(lista) {
    const caixa = criar('div', 'midias');
    for (const item of lista) caixa.append(G.cartaoMidia(api, item, { urls }));
    return caixa;
  }

  /** A sua mensagem; `midias`: o que você mandou junto (prévia local) ou, ao recarregar, o que o servidor guardou. */
  function msgVoce(texto, midias = []) {
    const li = criar('li', 'msg msg-voce');
    if (midias.length) li.append(cartoes(midias));
    if (texto) li.append(criar('div', 'balao', texto));
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
    const midias = criar('div', 'midias');
    midias.hidden = true;
    const acoes = criar('div', 'acoes-msg');
    acoes.hidden = true;
    const copiar = criar('button', 'acao', 'Copiar resposta');
    copiar.type = 'button';
    acoes.append(copiar);
    corpo.append(ferramentas, digitando, conteudo, midias, acoes);
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
      /** v0.51.0: um arquivo que o agente criou (foto editada, vídeo, capa, áudio). */
      midia(item) {
        midias.hidden = false;
        midias.append(G.cartaoMidia(api, item, { urls }));
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
        if (!texto && !nota && !erro && !usadas.size && midias.hidden) li.remove();
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
    const prontos = anexos.filter((a) => a.estado === 'pronto');
    if ((!texto && !prontos.length) || ocupado) return;
    if (!token) { semChave(); return; }
    marcarOcupado(true);
    // o histórico entra primeiro: se a mensagem fosse antes, ela voltaria junto com o histórico e apareceria duas vezes
    await pronto;
    msgVoce(texto, prontos.map((a) => ({ nome: a.arquivo.name, midia: a.midia, tamanho: a.arquivo.size, url: a.url })));
    for (const a of prontos) tirarAnexo(a, { manterPrevia: true }); // a prévia agora é da mensagem
    let atual = msgAgente();
    const segmento = () => { if (!atual) atual = msgAgente(); return atual; };
    anunciar('Pensando…');
    let final = '';
    let interrompida = false;
    let erro = '';
    try {
      const res = await api('/api/conversa', { texto, ...(prontos.length ? { anexos: prontos.map((a) => a.id) } : {}) });
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
        } else if (ev.tipo === 'midia') {
          segmento().midia(ev);
          anunciar(`Pronto: ${ev.nome}`);
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
    elAnexar.disabled = true;
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
      if (m.quem === 'voce') msgVoce(m.texto, m.midias || []);
      else if (m.quem === 'agente') {
        const a = msgAgente();
        for (const f of m.ferramentas || []) a.ferramenta(f);
        for (const x of m.midias || []) a.midia(x);
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
    for (const a of [...anexos]) tirarAnexo(a);
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
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
    if (anexos.some((a) => a.estado === 'fila' || a.estado === 'enviando')) { anunciar('Espere o arquivo terminar de subir.'); avisarNaBandeja('Espere o arquivo terminar de subir para mandar.'); return; }
    if (!t.trim() && !anexos.some((a) => a.estado === 'pronto')) return;
    elTexto.value = '';
    ajustarAltura();
    enviar(t);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ocupado) { ev.preventDefault(); parar(); }
  });
  for (const b of document.querySelectorAll('.sugestao')) b.addEventListener('click', () => enviar(b.textContent));

  // ---------------------------------------------------------------------------
  // v0.51.0: arquivos para mandar (a bandeja acima da caixa de mensagem)
  // ---------------------------------------------------------------------------
  const MAX_ANEXOS = 10;
  const anexos = []; // { arquivo, tipo, midia, url, estado: fila|enviando|pronto|erro, id, envio, li }
  let subindo = false;

  function avisarNaBandeja(texto) {
    let n = elAnexos.querySelector('.anexos-aviso');
    if (!n) { n = criar('li', 'anexos-aviso'); elAnexos.prepend(n); }
    n.textContent = texto;
    elAnexos.hidden = false;
    clearTimeout(n._gcTimer);
    n._gcTimer = setTimeout(() => { n.remove(); elAnexos.hidden = !anexos.length; }, 4000);
  }

  function desenharAnexo(a) {
    a.li.dataset.estado = a.estado;
    const pct = Math.round((a.progresso || 0) * 100);
    a.estadoEl.textContent = a.estado === 'fila' ? 'Na fila…' : a.estado === 'enviando' ? `Enviando… ${pct}%`
      : a.estado === 'pronto' ? `${G.tamanhoLegivel(a.arquivo.size)} · pronto` : (a.erro || 'Não foi.');
    a.barra.hidden = a.estado !== 'enviando';
    a.barra.value = a.progresso || 0;
  }

  function tirarAnexo(a, { manterPrevia = false } = {}) {
    const i = anexos.indexOf(a);
    if (i >= 0) anexos.splice(i, 1);
    if (a.envio) a.envio.cancelar();
    a.li.remove();
    if (!manterPrevia && a.url) { URL.revokeObjectURL(a.url); urls.delete(a.url); }
    elAnexos.hidden = !anexos.length;
  }

  function adicionarArquivos(lista) {
    for (const arquivo of Array.from(lista || [])) {
      if (anexos.length >= MAX_ANEXOS) { avisarNaBandeja(`No máximo ${MAX_ANEXOS} arquivos por mensagem.`); break; }
      const { tipo, midia } = G.tipoDoArquivo(arquivo);
      const a = { arquivo, tipo, midia, estado: 'fila', id: null, envio: null, progresso: 0 };
      if (/^image\/hei[cf]$/.test(tipo)) { a.estado = 'erro'; a.erro = 'foto HEIC ainda não dá: no iPhone, Ajustes > Câmera > Formatos > "Mais Compatível"'; }
      else if (!midia) { a.estado = 'erro'; a.erro = 'mande foto, vídeo ou áudio'; }
      else if (!arquivo.size) { a.estado = 'erro'; a.erro = 'arquivo vazio'; }
      else if (arquivo.size > G.MAX_ENVIO) { a.estado = 'erro'; a.erro = `passa de ${G.tamanhoLegivel(G.MAX_ENVIO)}`; }
      a.li = criar('li', 'anexo');
      const previa = criar('div', 'anexo-previa');
      if (a.estado !== 'erro' && (midia === 'imagem' || midia === 'video')) {
        a.url = URL.createObjectURL(arquivo);
        urls.add(a.url);
        const el = criar(midia === 'imagem' ? 'img' : 'video');
        if (midia === 'video') { el.muted = true; el.playsInline = true; el.preload = 'metadata'; G.mostrarQuadro(el); } else el.alt = '';
        el.src = a.url;
        previa.append(el);
      } else {
        previa.append(criar('span', 'anexo-icone', midia === 'audio' ? '♪' : '!'));
        if (a.estado !== 'erro') { a.url = URL.createObjectURL(arquivo); urls.add(a.url); }
      }
      const info = criar('div', 'anexo-info');
      const nome = criar('span', 'anexo-nome', arquivo.name || 'arquivo');
      nome.title = arquivo.name || '';
      a.estadoEl = criar('span', 'anexo-estado');
      a.barra = criar('progress', 'anexo-barra');
      a.barra.max = 1;
      info.append(nome, a.estadoEl, a.barra);
      const tirar = criar('button', 'anexo-tirar', '×');
      tirar.type = 'button';
      tirar.setAttribute('aria-label', `Tirar ${arquivo.name || 'o arquivo'}`);
      tirar.addEventListener('click', () => tirarAnexo(a));
      a.li.append(previa, info, tirar);
      anexos.push(a);
      elAnexos.append(a.li);
      desenharAnexo(a);
    }
    elAnexos.hidden = !anexos.length;
    subirFila();
  }

  // um envio por vez (o servidor também só aceita um)
  async function subirFila() {
    if (subindo || !token) return;
    subindo = true;
    try {
      for (;;) {
        const a = anexos.find((x) => x.estado === 'fila');
        if (!a) break;
        a.estado = 'enviando';
        desenharAnexo(a);
        a.envio = G.enviarArquivo(token, a.arquivo, a.tipo, { aoProgresso: (f) => { a.progresso = f; desenharAnexo(a); } });
        try {
          const r = await a.envio.promessa;
          a.id = r.id;
          a.estado = 'pronto';
          anunciar(`${a.arquivo.name} pronto para mandar.`);
        } catch (e) {
          if (e.cancelado) continue;
          a.estado = 'erro';
          a.erro = e.message;
        }
        a.envio = null;
        if (anexos.includes(a)) desenharAnexo(a);
      }
    } finally { subindo = false; }
  }

  elAnexar.addEventListener('click', () => elArquivo.click());
  elArquivo.addEventListener('change', () => { adicionarArquivos(elArquivo.files); elArquivo.value = ''; });
  // colar uma foto (Ctrl+V) na caixa de mensagem
  elTexto.addEventListener('paste', (ev) => {
    const arquivos = ev.clipboardData && ev.clipboardData.files;
    if (arquivos && arquivos.length) { ev.preventDefault(); adicionarArquivos(arquivos); }
  });
  // arrastar para qualquer lugar da página
  const temArquivos = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
  let arrastos = 0;
  document.addEventListener('dragenter', (ev) => { if (!temArquivos(ev)) return; arrastos++; app.dataset.arrastando = 'true'; });
  document.addEventListener('dragleave', () => { if (--arrastos <= 0) { arrastos = 0; delete app.dataset.arrastando; } });
  document.addEventListener('dragover', (ev) => { if (temArquivos(ev)) ev.preventDefault(); });
  document.addEventListener('drop', (ev) => {
    if (!temArquivos(ev)) return;
    ev.preventDefault();
    arrastos = 0;
    delete app.dataset.arrastando;
    if (!elAnexar.disabled) adicionarArquivos(ev.dataTransfer.files);
  });

  marcarOcupado(false);
  const pronto = carregar().catch(() => {});
  if (ponteiroFino) elTexto.focus();
})();
