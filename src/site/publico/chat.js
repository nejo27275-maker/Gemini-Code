/* versão chat do modo site (v0.49.0): uma conversa por texto, comum — sem esfera nem voz. A mesma API e a mesma
 * segurança da página de voz (src/site/servidor.js); o que vem do modelo entra como texto (Markdown de comum.js).
 * v0.51.0: foto, vídeo e áudio — pelo clipe, arrastando ou colando; o arquivo sobe na hora (com o progresso), aparece
 * na sua mensagem, e o que o agente criar (a foto editada, o vídeo) aparece na resposta, com o botão de baixar.
 * v0.52.0: o pedido da chave do Gemini quando falta (o site só precisa dela) e o modo até terminar (botão no topo):
 * o agente continua sozinho, a página fechada não o para e, ao voltar, a página mostra o andamento.
 * v0.53.0: um site só — o microfone dita a mensagem (e a resposta vem falada), cada resposta tem "Ouvir", o seletor
 * troca de aliado (treinador, central...) sem sair da página, e "Modo voz" abre a esfera com a mesma conversa. */
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
  const elAte = $('btn-ate');
  const elMic = $('btn-mic');
  const elModoVoz = $('btn-modo-voz');
  const elAliadoCaixa = $('aliado-caixa');
  const elSelAliado = $('sel-aliado');
  // as sugestões da página (voltam quando a conversa é com o agente geral)
  const SUGESTOES_PADRAO = Array.from(document.querySelectorAll('.sugestao'), (b) => b.textContent);
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
    const seguindo = criar('p', 'seguindo'); // v0.52.0: "continuando sozinho (2)"
    seguindo.hidden = true;
    const acoes = criar('div', 'acoes-msg');
    acoes.hidden = true;
    const copiar = criar('button', 'acao', 'Copiar resposta');
    copiar.type = 'button';
    acoes.append(copiar);
    // v0.53.0: ouvir a resposta em voz alta (a síntese do navegador)
    const ouvir = G.podeFalar() ? criar('button', 'acao acao-ouvir', 'Ouvir') : null;
    if (ouvir) {
      ouvir.type = 'button';
      ouvir.setAttribute('aria-pressed', 'false');
      acoes.append(ouvir);
    }
    corpo.append(ferramentas, digitando, conteudo, midias, seguindo, acoes);
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
    if (ouvir) ouvir.addEventListener('click', () => falarResposta(texto, ouvir));
    return {
      li,
      /** v0.53.0: lê em voz alta (a resposta inteira, quando ela veio em mais de um pedaço). */
      falar(inteiro) { falarResposta(inteiro || texto, ouvir); },
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
      /** v0.52.0: o texto inteiro de uma vez (o andamento visto ao voltar para a página). */
      substituir(t) {
        if (t === texto) return;
        texto = String(t || '');
        digitando.hidden = Boolean(texto);
        if (!agendado) { agendado = true; requestAnimationFrame(desenhar); }
      },
      /** v0.52.0: modo até terminar — ele parou sem terminar e segue sozinho. */
      continuando(n) {
        seguindo.hidden = false;
        seguindo.textContent = `Ainda não terminou: continuando sozinho (${n})…`;
        rolar();
      },
      /** Fim: o texto final (quando nada chegou aos pedaços), uma nota (parada), um erro ou o selo do modo até terminar. */
      fim({ final = '', nota = '', erro = '', selo = '' } = {}) {
        if (!texto && final) texto = final;
        digitando.hidden = true;
        seguindo.hidden = true;
        desenhar();
        if (selo) corpo.insertBefore(criar('p', selo.startsWith('✓') ? 'selo selo-ok' : 'selo', selo), acoes);
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
    elMic.disabled = sim;
    elSelAliado.disabled = sim; // trocar de aliado no meio de uma resposta, não
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
    if (cartaoDaChave) { anunciar('Cole a chave da API do Gemini primeiro.'); focarChave(); return; }
    // v0.53.0: a mensagem que veio do microfone ganha a resposta falada
    const responderFalando = falarProxima;
    falarProxima = false;
    pararDeFalar();
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
    let selo = '';
    try {
      const res = await api('/api/conversa', { texto, ...(prontos.length ? { anexos: prontos.map((a) => a.id) } : {}), ...(ateTerminar ? { ateTerminar: true } : {}) });
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
        } else if (ev.tipo === 'continuando') {
          segmento().continuando(ev.n);
          if (!parando) anunciar(`Continuando sozinho (${ev.n})…`);
        } else if (ev.tipo === 'resposta') {
          final = ev.texto || '';
          interrompida = Boolean(ev.interrompido);
          selo = G.seloDoFim(ev.fim);
        } else if (ev.tipo === 'erro') {
          erro = ev.texto || 'Erro.';
          if (ev.chave) pedirChave('O Gemini recusou a chave (ou ela falta): cole a sua');
        }
      }
    } catch (e) {
      erro = `Não consegui falar com o agente: ${e.message}`;
    }
    fecharPerguntas(interrompida ? 'Parado: contou como "não".' : 'A conversa terminou: contou como "não".');
    const nota = interrompida ? 'Você parou a resposta.' : '';
    const m = atual || ((final && !interrompida) || nota || erro ? msgAgente() : null);
    if (m) m.fim({ final: interrompida ? '' : final, nota, erro, selo: interrompida ? '' : selo });
    if (m && responderFalando && final && !interrompida && !erro) m.falar(final);
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
    elAte.disabled = true;
    elMic.disabled = true;
    elSelAliado.disabled = true;
  }

  // ---------------------------------------------------------------------------
  // v0.52.0: a chave da API do Gemini (o site só precisa dela)
  // ---------------------------------------------------------------------------
  let cartaoDaChave = null;
  const focarChave = () => { const c = cartaoDaChave && cartaoDaChave.querySelector('input'); if (c) c.focus(); };
  function pedirChave(motivo) {
    if (cartaoDaChave) { focarChave(); return; }
    const li = criar('li', 'msg msg-chave');
    li.append(G.cartaoChave(api, {
      motivo,
      aoSalvar: () => {
        anunciar('Chave salva. Pode conversar.');
        setTimeout(() => { li.remove(); atualizarVazio(); }, 2500);
        cartaoDaChave = null;
        if (ponteiroFino) elTexto.focus({ preventScroll: true });
      },
    }));
    cartaoDaChave = li;
    adicionar(li, true);
    focarChave();
  }

  // ---------------------------------------------------------------------------
  // v0.52.0: modo até terminar (o botão do topo; fica lembrado nesta aba)
  // ---------------------------------------------------------------------------
  let ateTerminar = false;
  function marcarAte(ligado, { lembrar = true } = {}) {
    ateTerminar = Boolean(ligado);
    elAte.setAttribute('aria-pressed', String(ateTerminar));
    if (lembrar) { try { sessionStorage.setItem('gc-ate-terminar', ateTerminar ? '1' : '0'); } catch { /* sem armazenamento */ } }
  }
  elAte.addEventListener('click', () => {
    marcarAte(!ateTerminar);
    anunciar(ateTerminar ? 'Modo até terminar ligado: o agente continua sozinho até a tarefa estar feita (você ainda pode parar).' : 'Modo até terminar desligado.');
  });

  // ---------------------------------------------------------------------------
  // v0.53.0: voz no chat — ditar a mensagem (o reconhecimento do navegador) e ouvir as respostas
  // ---------------------------------------------------------------------------
  const Reconhecimento = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let falarProxima = false;
  let botaoFalando = null;

  function soltarBotaoDaFala() {
    if (!botaoFalando) return;
    botaoFalando.setAttribute('aria-pressed', 'false');
    botaoFalando.textContent = 'Ouvir';
    botaoFalando = null;
  }
  function pararDeFalar() { soltarBotaoDaFala(); G.pararFala(); }
  /** Lê a resposta em voz alta; tocar de novo no mesmo "Ouvir" para. */
  function falarResposta(texto, botao) {
    const mesmo = Boolean(botao) && botao === botaoFalando;
    pararDeFalar();
    if (mesmo) return;
    if (botao) {
      botao.setAttribute('aria-pressed', 'true');
      botao.textContent = 'Parar de ouvir';
      botaoFalando = botao;
    }
    G.falar(texto, { aoTerminar: () => { if (botao && botaoFalando === botao) soltarBotaoDaFala(); } });
  }

  function ditar() {
    if (rec) { try { rec.stop(); } catch { /* já parou */ } return; } // tocar de novo: manda o que já ouviu
    const R = Reconhecimento();
    if (!R) { anunciar('Este navegador não ouve voz: use o Chrome ou o Edge (ou digite).'); return; }
    if (ocupado || !token) return;
    pararDeFalar();
    const antes = elTexto.value.trim();
    let final = '';
    rec = new R();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      elMic.setAttribute('aria-pressed', 'true');
      app.dataset.ouvindo = 'true';
      anunciar('Ouvindo… fale; quando você parar, a mensagem vai.');
    };
    rec.onresult = (ev) => {
      let parcial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const tr = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final += tr; else parcial += tr;
      }
      elTexto.value = [antes, (final + parcial).trim()].filter(Boolean).join(' ');
      ajustarAltura();
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') anunciar('Microfone bloqueado: permita o microfone para esta página (no ícone ao lado do endereço).');
      else if (ev.error === 'network') anunciar('O reconhecimento de voz do navegador precisa de internet. Você pode digitar.');
      else if (ev.error === 'no-speech') anunciar('Não ouvi nada. Toque no microfone e fale.');
    };
    rec.onend = () => {
      rec = null;
      elMic.setAttribute('aria-pressed', 'false');
      delete app.dataset.ouvindo;
      if (!final.trim()) { elTexto.value = antes; ajustarAltura(); return; }
      falarProxima = true;
      if (!mandar(elTexto.value)) falarProxima = false;
    };
    try { rec.start(); } catch { rec = null; }
  }
  if (Reconhecimento()) elMic.hidden = false;
  elMic.addEventListener('click', ditar);

  // ---------------------------------------------------------------------------
  // v0.53.0: um site só — o modo voz (a esfera) e a troca de aliado
  // ---------------------------------------------------------------------------
  // a esfera é a mesma conversa: a chave vai pelo fragmento do endereço (nunca para o servidor nem para o histórico)
  elModoVoz.addEventListener('click', (ev) => {
    if (!token) return;
    ev.preventDefault();
    pararDeFalar();
    location.href = `/#t=${encodeURIComponent(token)}`;
  });

  let aliadoAtual = null;
  function montarAliados(lista, atual) {
    aliadoAtual = atual || null;
    if (!Array.isArray(lista)) return;
    const opcoes = [{ nome: '', rotulo: 'Agente geral', descricao: 'o Gemini Code de sempre, com as ferramentas do dia a dia' }]
      .concat(lista.map((a) => ({ nome: a.nome, rotulo: a.nome, descricao: a.descricao })));
    elSelAliado.replaceChildren(...opcoes.map((o) => {
      const op = criar('option', '', o.rotulo);
      op.value = o.nome;
      if (o.descricao) op.title = o.descricao;
      return op;
    }));
    elSelAliado.value = aliadoAtual || '';
    elAliadoCaixa.hidden = false;
    elSubtitulo.hidden = true;
  }
  elSelAliado.addEventListener('change', async () => {
    const nome = elSelAliado.value || null;
    const voltar = () => { elSelAliado.value = aliadoAtual || ''; };
    if (nome === aliadoAtual) return;
    if (ocupado) { anunciar('Espere a resposta terminar para trocar.'); voltar(); return; }
    if (elLista.childElementCount && !window.confirm(`Trocar para ${nome ? `o aliado "${nome}"` : 'o agente geral'} começa uma conversa nova. Trocar?`)) { voltar(); return; }
    let d;
    try {
      const r = await api('/api/aliado', { nome });
      d = await r.json().catch(() => ({}));
      if (!r.ok) { aviso(d.erro || 'Não consegui trocar agora.'); voltar(); return; }
    } catch { aviso('Sem conexão com o agente.'); voltar(); return; }
    aliadoAtual = d.aliado || null;
    limparTela();
    trocarSugestoes(d.sugestoes && d.sugestoes.length ? d.sugestoes : SUGESTOES_PADRAO);
    anunciar(aliadoAtual ? `Agora você conversa com o aliado "${aliadoAtual}".` : 'Agora você conversa com o agente geral.');
    if (ponteiroFino) elTexto.focus({ preventScroll: true });
  });

  /** v0.52.0: as sugestões do aliado no lugar das da página (como texto, cada uma um botão). */
  function trocarSugestoes(lista) {
    const caixa = document.querySelector('.sugestoes');
    if (!caixa) return;
    caixa.replaceChildren(...lista.slice(0, 4).map((t) => {
      const b = criar('button', 'sugestao', String(t));
      b.type = 'button';
      b.addEventListener('click', () => enviar(b.textContent));
      return b;
    }));
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
    if (Array.isArray(d.aliados)) montarAliados(d.aliados, d.aliado); // v0.53.0: o seletor no lugar do subtítulo
    else if (d.aliado) elSubtitulo.textContent = `Chat com o aliado "${d.aliado}"`;
    trocarSugestoes(Array.isArray(d.sugestoes) && d.sugestoes.length ? d.sugestoes : SUGESTOES_PADRAO);
    let lembrado = null;
    try { lembrado = sessionStorage.getItem('gc-ate-terminar'); } catch { /* sem armazenamento */ }
    marcarAte(lembrado === null ? d.ateTerminarPadrao === true : lembrado === '1', { lembrar: false });
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
    if (d.chave && d.chave.precisa) pedirChave();
    // ocupada com outra resposta (de outra aba, ou de antes de recarregar): espera terminar. A nossa, não.
    if (d.ocupado && !esperando && !ocupado) esperarLivre();
  }

  // A página recarregou no meio de uma resposta. Normalmente o servidor já mandou parar: espera terminar e mostra a
  // conversa. v0.52.0: no modo até terminar ele segue — aqui aparece o andamento (texto, ferramentas, mídias) e as
  // perguntas que esperavam por você; sem limite de tempo (a pessoa pode parar pelo botão).
  async function esperarLivre() {
    esperando = true;
    marcarOcupado(true);
    const nota = aviso('Terminando a resposta anterior…');
    let vivo = null;
    const vistas = new Set();
    const perguntasVistas = new Set();
    for (let n = 0; ; n++) {
      await new Promise((r) => setTimeout(r, 1500));
      let d = null;
      try {
        const r = await api('/api/historico', {});
        if (r.ok) d = await r.json();
      } catch { /* tenta de novo */ }
      if (d && !d.ocupado) break;
      if (!d) { if (n > 400) break; continue; }
      if (d.andamento && d.andamento.ateTerminar) {
        nota.textContent = 'O agente continua trabalhando (modo até terminar)…';
        if (!vivo) vivo = msgAgente();
        vivo.substituir(d.andamento.texto || '');
        for (const f of d.andamento.ferramentas || []) vivo.ferramenta(f);
        for (const m of d.andamento.midias || []) if (!vistas.has(m.id)) { vistas.add(m.id); vivo.midia(m); }
        if (d.andamento.continuacoes) vivo.continuando(d.andamento.continuacoes);
      } else if (n > 120) break; // fora do modo até terminar, a resposta antiga já foi parada
      for (const p of d.perguntas || []) if (!perguntasVistas.has(p.id)) { perguntasVistas.add(p.id); cartaoPergunta(p); }
    }
    nota.remove();
    if (vivo) vivo.li.remove();
    parando = false;
    marcarOcupado(false);
    esperando = false;
    await carregar({ substituir: true });
  }

  /** A tela de uma conversa nova (o servidor já começou outra: /api/limpar ou a troca de aliado). */
  function limparTela() {
    pararDeFalar();
    elLista.replaceChildren();
    pendentes.clear();
    cartaoDaChave = null;
    for (const a of [...anexos]) tirarAnexo(a);
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    atualizarVazio();
  }

  elNova.addEventListener('click', async () => {
    if (ocupado) return;
    try {
      const r = await api('/api/limpar', {});
      if (!r.ok) { const e = await r.json().catch(() => ({})); aviso(e.erro || 'Não consegui começar outra agora.'); return; }
    } catch { aviso('Sem conexão com o agente.'); return; }
    limparTela();
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
  /** Manda o que está na caixa (texto e/ou os arquivos prontos). @returns {boolean} se foi */
  function mandar(t) {
    if (ocupado) return false;
    if (anexos.some((a) => a.estado === 'fila' || a.estado === 'enviando')) { anunciar('Espere o arquivo terminar de subir.'); avisarNaBandeja('Espere o arquivo terminar de subir para mandar.'); return false; }
    if (!String(t || '').trim() && !anexos.some((a) => a.estado === 'pronto')) return false;
    elTexto.value = '';
    ajustarAltura();
    enviar(t);
    return true;
  }
  elForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (ocupado) { parar(); return; } // enquanto responde, o botão de enviar é o "Parar"
    mandar(elTexto.value);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (ocupado) { ev.preventDefault(); parar(); } else if (botaoFalando || (G.podeFalar() && window.speechSynthesis.speaking)) pararDeFalar();
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
